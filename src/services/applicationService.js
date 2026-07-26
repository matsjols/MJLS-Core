import { logger } from '../utils/logger.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { PermissionFlagsBits } from 'discord.js';
import { sanitizeInput, sanitizeMarkdown } from '../utils/validation.js';
import {
    getApplicationSettings,
    saveApplicationSettings,
    getApplication,
    getApplications,
    createApplication,
    updateApplication,
    getUserApplications,
    getApplicationRoles,
    saveApplicationRoles
} from '../utils/database.js';
import botConfig from '../config/bot.js';

const applicationCooldowns = new Map();
const APPLICATION_SUBMIT_COOLDOWN = (botConfig.applications?.applicationCooldown ?? 24) * 60 * 60 * 1000;

class ApplicationService {
    static sanitizeApplicationText(value, maxLength) {
        return sanitizeMarkdown(sanitizeInput(String(value ?? ''), maxLength));
    }

    static validateApplicationSubmission(data) {
        if (!data.guildId || !data.userId || !data.roleId) {
            throw createError(
                'Mangler obligatoriske felt for å sende inn søknad',
                ErrorTypes.VALIDATION,
                'Ugyldige søknadsdata. Vennligst prøv igjen.',
                { data }
            );
        }

        if (!data.answers || !Array.isArray(data.answers) || data.answers.length === 0) {
            throw createError(
                'Søknaden må ha svar',
                ErrorTypes.VALIDATION,
                'Du må svare på alle søknadsspørsmålene.',
                { data }
            );
        }

        for (const answer of data.answers) {
            const sanitizedQuestion = this.sanitizeApplicationText(answer.question, 200);
            const sanitizedAnswer = this.sanitizeApplicationText(answer.answer, 1000);

            if (!sanitizedQuestion || !sanitizedAnswer) {
                throw createError(
                    'Ugyldig svarformat',
                    ErrorTypes.VALIDATION,
                    'Alle spørsmål må besvares.',
                    { answer }
                );
            }

            if (sanitizedAnswer.length > 1000) {
                throw createError(
                    'Svaret er for langt',
                    ErrorTypes.VALIDATION,
                    'Hvert svar må inneholde mindre enn 1000 tegn.',
                    { length: sanitizedAnswer.length }
                );
            }

            if (sanitizedAnswer.trim().length < 10) {
                throw createError(
                    'Svaret er for kort',
                    ErrorTypes.VALIDATION,
                    'Vennligst oppgi mer utfyllende svar (minst 10 tegn).',
                    { length: sanitizedAnswer.length }
                );
            }
        }

        return true;
    }

    static checkApplicationCooldown(userId) {
        const now = Date.now();
        const cooldownKey = `submit_${userId}`;
        const lastSubmit = applicationCooldowns.get(cooldownKey);

        if (lastSubmit && now - lastSubmit < APPLICATION_SUBMIT_COOLDOWN) {
            const remainingTime = Math.ceil((APPLICATION_SUBMIT_COOLDOWN - (now - lastSubmit)) / 1000);
            throw createError(
                'Søknadinnsending har cooldown',
                ErrorTypes.RATE_LIMIT,
                `Vennligst vent ${Math.ceil(remainingTime / 60)} minutt(er) før du sender inn en ny søknad.`,
                { remainingTime, userId }
            );
        }

        applicationCooldowns.set(cooldownKey, now);
        return true;
    }

    static async checkManagerPermission(client, guildId, member) {
        const settings = await getApplicationSettings(client, guildId);
        
        const isManager = 
            member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            (settings.managerRoles && 
             settings.managerRoles.some(roleId => member.roles.cache.has(roleId)));

        if (!isManager) {
            throw createError(
                'Bruker mangler rettigheter til å administrere søknader',
                ErrorTypes.PERMISSION,
                'Du har ikke tillatelse til å behandle søknader.',
                { userId: member.id, guildId }
            );
        }

        return true;
    }

    static async submitApplication(client, data) {
        try {
            this.validateApplicationSubmission(data);
            this.checkApplicationCooldown(data.userId);

            const settings = await getApplicationSettings(client, data.guildId);
            if (!settings.enabled) {
                throw createError(
                    'Søknader er deaktivert',
                    ErrorTypes.CONFIGURATION,
                    'Søknadssystemet er for øyeblikket deaktivert på denne serveren.',
                    { guildId: data.guildId }
                );
            }

            const userApps = await getUserApplications(client, data.guildId, data.userId);
            const pendingApp = userApps.find(app => app.status === 'pending');

            if (pendingApp) {
                throw createError(
                    'Brukeren har allerede en ventende søknad',
                    ErrorTypes.VALIDATION,
                    'Du har allerede en søknad under behandling. Vennligst vent til den er behandlet.',
                    { userId: data.userId, pendingAppId: pendingApp.id }
                );
            }

            const sanitizedData = {
                ...data,
                answers: data.answers.map(answer => ({
                    question: this.sanitizeApplicationText(answer.question, 200),
                    answer: this.sanitizeApplicationText(answer.answer, 1000)
                }))
            };

            const application = await createApplication(client, sanitizedData);

            logger.info('Søknad levert', {
                applicationId: application.id,
                userId: data.userId,
                guildId: data.guildId,
                roleId: data.roleId,
                roleName: data.roleName
            });

            return application;
        } catch (error) {
            logger.error('Feil ved innsending av søknad', {
                error: error.message,
                userId: data.userId,
                guildId: data.guildId,
                stack: error.stack
            });
            throw error;
        }
    }

    static async reviewApplication(client, guildId, applicationId, reviewData) {
        try {
            const { action, reason, reviewerId } = reviewData;

            if (!['approve', 'deny'].includes(action)) {
                throw createError(
                    'Ugyldig behandlingshandling',
                    ErrorTypes.VALIDATION,
                    'Behandling må enten være godkjenn eller avslå.',
                    { action }
                );
            }

            const application = await getApplication(client, guildId, applicationId);
            if (!application) {
                throw createError(
                    'Søknaden ble ikke funnet',
                    ErrorTypes.CONFIGURATION,
                    'Søknaden du prøver å behandle eksisterer ikke.',
                    { applicationId, guildId }
                );
            }

            if (application.status !== 'pending') {
                throw createError(
                    'Søknaden er allerede behandlet',
                    ErrorTypes.VALIDATION,
                    'Denne søknaden har allerede blitt behandlet.',
                    { applicationId, status: application.status }
                );
            }

            const status = action === 'approve' ? 'approved' : 'denied';
            const sanitizedReason = reason ? reason.trim().substring(0, 500) : 'Ingen begrunnelse oppgitt.';

            const updatedApplication = await updateApplication(client, guildId, applicationId, {
                status,
                reviewer: reviewerId,
                reviewMessage: sanitizedReason,
                reviewedAt: new Date().toISOString()
            });

            logger.info('Søknad behandlet', {
                applicationId,
                guildId,
                status,
                reviewerId,
                userId: application.userId
            });

            return updatedApplication;
        } catch (error) {
            logger.error('Feil ved behandling av søknad', {
                error: error.message,
                applicationId,
                guildId,
                stack: error.stack
            });
            throw error;
        }
    }

    static async getApplicationsList(client, guildId, filters = {}) {
        try {
            const applications = await getApplications(client, guildId, filters);

            logger.debug('Søknadsliste hentet', {
                guildId,
                count: applications.length,
                filters
            });

            return applications;
        } catch (error) {
            logger.error('Feil ved henting av søknadsliste', {
                error: error.message,
                guildId,
                filters,
                stack: error.stack
            });
            throw createError(
                'Klarte ikke å hente søknader',
                ErrorTypes.DATABASE,
                'Det oppstod en feil under henting av søknadene.',
                { guildId, filters }
            );
        }
    }

    static async updateSettings(client, guildId, updates) {
        try {
            if (updates.logChannelId && typeof updates.logChannelId !== 'string') {
                throw createError(
                    'Ugyldig ID for loggkanal',
                    ErrorTypes.VALIDATION,
                    'Ugyldig kanal-ID oppgitt.',
                    { logChannelId: updates.logChannelId }
                );
            }

            if (updates.managerRoles && !Array.isArray(updates.managerRoles)) {
                throw createError(
                    'Ugyldig format for administratorroller',
                    ErrorTypes.VALIDATION,
                    'Administratorroller må oppgis som en liste.',
                    { managerRoles: updates.managerRoles }
                );
            }

            if (updates.questions) {
                if (!Array.isArray(updates.questions) || updates.questions.length === 0) {
                    throw createError(
                        'Ugyldig spørsmålsformat',
                        ErrorTypes.VALIDATION,
                        'Spørsmål må oppgis som en liste og kan ikke være tom.',
                        { questions: updates.questions }
                    );
                }

                updates.questions = updates.questions.map(q => 
                    typeof q === 'string' ? q.trim().substring(0, 100) : q
                );
            }

            await saveApplicationSettings(client, guildId, updates);
            const updatedSettings = await getApplicationSettings(client, guildId);

            logger.info('Søknadsinnstillinger oppdatert', {
                guildId,
                updates: Object.keys(updates)
            });

            return updatedSettings;
        } catch (error) {
            logger.error('Feil ved oppdatering av søknadsinnstillinger', {
                error: error.message,
                guildId,
                updates,
                stack: error.stack
            });
            throw error;
        }
    }

    static async manageApplicationRoles(client, guildId, data) {
        try {
            const { action, roleId, name } = data;

            const currentRoles = await getApplicationRoles(client, guildId);

            if (action === 'add') {
                if (!roleId) {
                    throw createError(
                        'Mangler rolle-ID',
                        ErrorTypes.VALIDATION,
                        'Du må spesifisere en rolle som skal legges til.',
                        { action }
                    );
                }

                if (currentRoles.some(appRole => appRole.roleId === roleId)) {
                    throw createError(
                        'Rollen er allerede konfigurert',
                        ErrorTypes.VALIDATION,
                        'Denne rollen er allerede konfigurert for søknader.',
                        { roleId }
                    );
                }

                currentRoles.push({
                    roleId,
                    name: name ? name.trim().substring(0, 50) : 'Søknadsrolle'
                });

                await saveApplicationRoles(client, guildId, currentRoles);

                logger.info('Søknadsrolle lagt til', {
                    guildId,
                    roleId,
                    name
                });
            } else if (action === 'remove') {
                if (!roleId) {
                    throw createError(
                        'Mangler rolle-ID',
                        ErrorTypes.VALIDATION,
                        'Du må spesifisere en rolle som skal fjernes.',
                        { action }
                    );
                }

                const roleIndex = currentRoles.findIndex(appRole => appRole.roleId === roleId);
                if (roleIndex === -1) {
                    throw createError(
                        'Rollen er ikke konfigurert',
                        ErrorTypes.VALIDATION,
                        'Denne rollen er ikke konfigurert for søknader.',
                        { roleId }
                    );
                }

                currentRoles.splice(roleIndex, 1);
                await saveApplicationRoles(client, guildId, currentRoles);

                logger.info('Søknadsrolle fjernet', {
                    guildId,
                    roleId
                });
            }

            return currentRoles;
        } catch (error) {
            logger.error('Feil ved administrering av søknadsroller', {
                error: error.message,
                guildId,
                data,
                stack: error.stack
            });
            throw error;
        }
    }

    static async getUserApplications(client, guildId, userId) {
        try {
            const applications = await getUserApplications(client, guildId, userId);

            logger.debug('Brukers søknader hentet', {
                guildId,
                userId,
                count: applications.length
            });

            return applications;
        } catch (error) {
            logger.error('Feil ved henting av brukers søknader', {
                error: error.message,
                guildId,
                userId,
                stack: error.stack
            });
            throw createError(
                'Klarte ikke å hente dine søknader',
                ErrorTypes.DATABASE,
                'Det oppstod en feil under henting av dine søknader.',
                { guildId, userId }
            );
        }
    }

    static async getSingleApplication(client, guildId, applicationId) {
        try {
            const application = await getApplication(client, guildId, applicationId);

            if (!application) {
                throw createError(
                    'Søknaden ble ikke funnet',
                    ErrorTypes.CONFIGURATION,
                    'Søknaden du leter etter eksisterer ikke.',
                    { applicationId, guildId }
                );
            }

            return application;
        } catch (error) {
            logger.error('Feil ved henting av søknad', {
                error: error.message,
                applicationId,
                guildId,
                stack: error.stack
            });
            throw error;
        }
    }
}

export default ApplicationService;