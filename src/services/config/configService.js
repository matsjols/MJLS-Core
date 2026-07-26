import { logger } from '../../utils/logger.js';
import { getGuildConfig, setGuildConfig } from './guildConfig.js';
import { PermissionFlagsBits } from 'discord.js';
import { createError, ErrorTypes } from '../../utils/errorHandler.js';
import { wrapServiceClassMethods } from '../../utils/serviceErrorBoundary.js';
import { z } from 'zod';
import { LogIgnoreSchema, LoggingConfigSchema } from '../../utils/schemas.js';

const configChangeHistory = new Map();
const CONFIG_HISTORY_LIMIT = 100;

const CONFIG_VALIDATION_RULES = {
    logChannelId: { type: 'channel', required: false },
    reportChannelId: { type: 'channel', required: false },
    premiumRoleId: { type: 'role', required: false },
    autoRole: { type: 'role', required: false },
    modRole: { type: 'role', required: false },
    adminRole: { type: 'role', required: false },
    prefix: { type: 'string', required: false, maxLength: 10, minLength: 1 },
    dmOnClose: { type: 'boolean', required: false },
    maxTicketsPerUser: { type: 'number', required: false, min: 1, max: 50 },
    birthdayChannelId: { type: 'channel', required: false },
    logIgnore: { type: 'object', required: false },
    logging: { type: 'object', required: false }
};

const SETTING_CONFLICTS = {
    'birthdayChannelId': [],
    'logging': [],
};

const LEGACY_LOGGING_KEY_MAP = {
    logChannelId: 'audit',
    reportChannelId: 'reports',
};

const ConfigValueSchemas = Object.freeze({
    logChannelId: z.union([z.string().min(1), z.object({ id: z.string().min(1) }), z.null()]),
    reportChannelId: z.union([z.string().min(1), z.object({ id: z.string().min(1) }), z.null()]),
    premiumRoleId: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
    autoRole: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
    modRole: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
    adminRole: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
    prefix: z.string().min(1).max(10),
    dmOnClose: z.boolean(),
    maxTicketsPerUser: z.number().int().min(1).max(50),
    birthdayChannelId: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
    logIgnore: LogIgnoreSchema,
    logging: LoggingConfigSchema,
});

class ConfigService {

    static MAX_CHANNEL_IDS = 10;
    static MAX_ROLE_IDS = 20;
    static MAX_PREFIX_LENGTH = 10;
    static PROTECTED_SETTINGS = ['_id', 'guildId', 'createdAt']; 
    static UNSAFE_KEYS = ['__proto__', 'prototype', 'constructor'];

    static applyLoggingLegacyKey(config, key, value, previousConfig = {}) {
        if (key === 'logIgnore') {
            const logging = {
                ...(previousConfig.logging || config.logging || {}),
                ignore: value,
            };
            const next = { ...config, logging };
            delete next.logIgnore;
            return next;
        }

        const destination = LEGACY_LOGGING_KEY_MAP[key];
        if (!destination) {
            return config;
        }

        const channelId = value && typeof value === 'object' ? value.id : value;
        const logging = {
            ...(previousConfig.logging || config.logging || {}),
            channels: {
                ...((previousConfig.logging || config.logging || {}).channels || {}),
                [destination]: channelId ?? null,
            },
            enabled: channelId ? true : (previousConfig.logging?.enabled ?? config.logging?.enabled ?? false),
        };

        const next = { ...config, logging };
        delete next[key];
        if (key === 'logChannelId') {
            delete next.enableLogging;
        }
        if (key === 'reportChannelId') {
            delete next.reportChannelId;
        }
        return next;
    }

    static validateConfigKeySafety(key) {
        if (typeof key !== 'string' || key.trim().length === 0) {
            throw createError(
                'Ugyldig innstillingsnøkkel',
                ErrorTypes.VALIDATION,
                'Innstillingsnøkkelen må være en tekststreng som ikke er tom.',
                { key }
            );
        }

        if (this.UNSAFE_KEYS.includes(key)) {
            throw createError(
                'Utrygg innstillingsnøkkel',
                ErrorTypes.VALIDATION,
                'Denne innstillingsnøkkelen er ikke tillatt av sikkerhetsmessige årsaker.',
                { key }
            );
        }
    }

    static async validateConfigValue(key, value, guild) {
        logger.debug(`[CONFIG_SERVICE] Validerer konfigurasjonsverdi`, { key, type: typeof value });

        const rule = CONFIG_VALIDATION_RULES[key];
        
        if (!rule) {
            logger.warn(`[CONFIG_SERVICE] Ingen valideringsregel for nøkkel: ${key}`);
            return true; 
        }

        if (rule.required === false && (value === null || value === undefined)) {
            return true;
        }

        const zodSchema = ConfigValueSchemas[key];
        if (zodSchema) {
            const parsed = zodSchema.safeParse(value);
            if (!parsed.success) {
                throw createError(
                    'Ugyldig konfigurasjonsverdi',
                    ErrorTypes.VALIDATION,
                    'Den oppgitte konfigurasjonsverdien er ugyldig.',
                    {
                        key,
                        errorCode: 'VALIDATION_FAILED',
                        issues: parsed.error.issues.map((issue) => ({
                            path: issue.path.join('.'),
                            message: issue.message,
                            code: issue.code
                        }))
                    }
                );
            }
        }

        if (rule.type === 'channel') {
            if (typeof value !== 'string' && typeof value !== 'object') {
                throw createError(
                    'Ugyldig kanal',
                    ErrorTypes.VALIDATION,
                    'Kanal-ID må være en tekststreng.',
                    { key, provided: typeof value }
                );
            }

            const channelId = typeof value === 'string' ? value : value.id;
            const channel = guild.channels.cache.get(channelId);

            if (!channel) {
                throw createError(
                    'Kanal ikke funnet',
                    ErrorTypes.VALIDATION,
                    'Den spesifiserte kanalen eksisterer ikke.',
                    { key, channelId }
                );
            }

            if (!channel.isTextBased?.()) {
                throw createError(
                    'Ugyldig kanaltype',
                    ErrorTypes.VALIDATION,
                    'Kun tekstkanaler er tillatt.',
                    { key, channelId, channelType: channel.type }
                );
            }

            return true;
        }

        if (rule.type === 'role') {
            if (typeof value !== 'string' && typeof value !== 'object') {
                throw createError(
                    'Ugyldig rolle',
                    ErrorTypes.VALIDATION,
                    'Rolle-ID må være en tekststreng.',
                    { key, provided: typeof value }
                );
            }

            const roleId = typeof value === 'string' ? value : value.id;
            const role = guild.roles.cache.get(roleId);

            if (!role) {
                throw createError(
                    'Rolle ikke funnet',
                    ErrorTypes.VALIDATION,
                    'Den spesifiserte rollen eksisterer ikke.',
                    { key, roleId }
                );
            }

            const botHighestRole = guild.members.me?.roles.highest;
            if (role.position >= botHighestRole?.position) {
                throw createError(
                    'For høy rolle',
                    ErrorTypes.VALIDATION,
                    'Kan ikke angi roller som er høyere enn min høyeste rolle.',
                    { key, roleId, rolePosition: role.position }
                );
            }

            return true;
        }

        if (rule.type === 'string') {
            if (typeof value !== 'string') {
                throw createError(
                    'Ugyldig verditype',
                    ErrorTypes.VALIDATION,
                    'Verdien må være en tekststreng.',
                    { key, provided: typeof value }
                );
            }

            const length = value.length;
            if (rule.maxLength && length > rule.maxLength) {
                throw createError(
                    'Verdien er for lang',
                    ErrorTypes.VALIDATION,
                    `Verdien kan ikke overskride **${rule.maxLength}** tegn.`,
                    { key, current: length, max: rule.maxLength }
                );
            }

            if (rule.minLength && length < rule.minLength) {
                throw createError(
                    'Verdien er for kort',
                    ErrorTypes.VALIDATION,
                    `Verdien må være på minst **${rule.minLength}** tegn.`,
                    { key, current: length, min: rule.minLength }
                );
            }

            return true;
        }

        if (rule.type === 'number') {
            if (typeof value !== 'number') {
                throw createError(
                    'Ugyldig verditype',
                    ErrorTypes.VALIDATION,
                    'Verdien må være et tall.',
                    { key, provided: typeof value }
                );
            }

            if (rule.min !== undefined && value < rule.min) {
                throw createError(
                    'Verdien er for lav',
                    ErrorTypes.VALIDATION,
                    `Verdien må være minst **${rule.min}**.`,
                    { key, value, min: rule.min }
                );
            }

            if (rule.max !== undefined && value > rule.max) {
                throw createError(
                    'Verdien er for høy',
                    ErrorTypes.VALIDATION,
                    `Verdien kan ikke overskride **${rule.max}**.`,
                    { key, value, max: rule.max }
                );
            }

            return true;
        }

        if (rule.type === 'boolean') {
            if (typeof value !== 'boolean') {
                throw createError(
                    'Ugyldig verditype',
                    ErrorTypes.VALIDATION,
                    'Verdien må være enten sant (true) eller usant (false).',
                    { key, provided: typeof value }
                );
            }

            return true;
        }

        if (rule.type === 'object') {
            if (typeof value !== 'object' || value === null) {
                throw createError(
                    'Ugyldig verditype',
                    ErrorTypes.VALIDATION,
                    'Verdien må være et objekt.',
                    { key, provided: typeof value }
                );
            }

            return true;
        }

        return true;
    }

    static detectConflicts(currentConfig, key, value) {
        logger.debug(`[CONFIG_SERVICE] Sjekker etter konfigurasjonskonflikter`, { key });

        const conflicts = [];
        const relatedSettings = SETTING_CONFLICTS[key] || [];

        for (const related of relatedSettings) {
            if (related === 'logging' && value === null) {
                
                if (currentConfig.logging?.enabled) {
                    conflicts.push(
                        `Deaktiverer loggkanal, men loggingssystemet er fortsatt aktivert. Vurder å deaktivere logging først.`
                    );
                }
            }
        }

        return conflicts;
    }

    static async updateSetting(client, guildId, key, value, adminId) {
        logger.info(`[CONFIG_SERVICE] Oppdaterer innstilling`, {
            guildId,
            key,
            adminId,
            valueType: typeof value
        });

        this.validateConfigKeySafety(key);

        if (this.PROTECTED_SETTINGS.includes(key)) {
            logger.warn(`[CONFIG_SERVICE] Forsøkte å endre beskyttet innstilling`, {
                key,
                guildId,
                adminId
            });
            throw createError(
                'Beskyttet innstilling',
                ErrorTypes.VALIDATION,
                `Innstillingen **${key}** kan ikke endres.`,
                { key }
            );
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            throw createError(
                'Server ikke funnet',
                ErrorTypes.VALIDATION,
                'Serveren eksisterer ikke.',
                { guildId }
            );
        }

        await this.validateConfigValue(key, value, guild);

        const currentConfig = await getGuildConfig(client, guildId);

        const conflicts = this.detectConflicts(currentConfig, key, value);
        if (conflicts.length > 0) {
            logger.warn(`[CONFIG_SERVICE] Konfigurasjonskonflikter oppdaget`, {
                guildId,
                key,
                conflicts
            });
            
        }

        const oldValue = currentConfig[key];

        let updatedConfig = { ...currentConfig, [key]: value };
        updatedConfig = this.applyLoggingLegacyKey(updatedConfig, key, value, currentConfig);

        await setGuildConfig(client, guildId, updatedConfig);

        this.recordChange(guildId, {
            key,
            oldValue,
            newValue: value,
            changedBy: adminId,
            timestamp: new Date().toISOString(),
            conflicts
        });

        logger.info(`[CONFIG_SERVICE] Innstilling oppdatert`, {
            guildId,
            key,
            adminId,
            oldValue: typeof oldValue === 'string' ? oldValue.substring(0, 50) : oldValue,
            newValue: typeof value === 'string' ? value.substring(0, 50) : value,
            hasConflicts: conflicts.length > 0,
            timestamp: new Date().toISOString()
        });

        return {
            key,
            oldValue,
            newValue: value,
            conflicts
        };
    }

    static async bulkUpdate(client, guildId, updates, adminId) {
        logger.info(`[CONFIG_SERVICE] Masseoppdaterer innstillinger`, {
            guildId,
            updateCount: Object.keys(updates).length,
            adminId
        });

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            throw createError(
                'Server ikke funnet',
                ErrorTypes.VALIDATION,
                'Serveren eksisterer ikke.',
                { guildId }
            );
        }

        const validatedUpdates = {};
        const validationErrors = [];

        for (const [key, value] of Object.entries(updates)) {
            try {
                this.validateConfigKeySafety(key);

                if (this.PROTECTED_SETTINGS.includes(key)) {
                    validationErrors.push(`${key}: Beskyttet innstilling kan ikke endres`);
                    continue;
                }

                await this.validateConfigValue(key, value, guild);
                validatedUpdates[key] = value;
            } catch (error) {
                validationErrors.push(`${key}:${error.details?.message || error.message}`);
            }
        }

        if (validationErrors.length > 0) {
            logger.warn(`[CONFIG_SERVICE] Masseoppdatering feilet validering`, {
                guildId,
                errors: validationErrors
            });
            throw createError(
                'Validering feilet',
                ErrorTypes.VALIDATION,
                `Noen innstillinger feilet valideringen:\n• ${validationErrors.join('\n• ')}`,
                { errors: validationErrors }
            );
        }

        const currentConfig = await getGuildConfig(client, guildId);

        const updatedConfig = { ...currentConfig, ...validatedUpdates };
        await setGuildConfig(client, guildId, updatedConfig);

        for (const [key, value] of Object.entries(validatedUpdates)) {
            this.recordChange(guildId, {
                key,
                oldValue: currentConfig[key],
                newValue: value,
                changedBy: adminId,
                isBulkUpdate: true,
                timestamp: new Date().toISOString()
            });
        }

        logger.info(`[CONFIG_SERVICE] Masseoppdatering fullført`, {
            guildId,
            adminId,
            appliedCount: Object.keys(validatedUpdates).length,
            failedCount: validationErrors.length,
            timestamp: new Date().toISOString()
        });

        return {
            applied: Object.keys(validatedUpdates),
            failed: validationErrors,
            appliedCount: Object.keys(validatedUpdates).length,
            failedCount: validationErrors.length
        };
    }

    static recordChange(guildId, changeData) {
        if (!configChangeHistory.has(guildId)) {
            configChangeHistory.set(guildId, []);
        }

        const history = configChangeHistory.get(guildId);
        history.push(changeData);

        if (history.length > CONFIG_HISTORY_LIMIT) {
            history.shift();
        }

        logger.debug(`[CONFIG_SERVICE] Endring registrert for revisjonslogg`, {
            guildId,
            key: changeData.key,
            historySize: history.length
        });
    }

    static getChangeHistory(guildId, limit = 20) {
        const history = configChangeHistory.get(guildId) || [];
        return history.slice(-limit).reverse();
    }

    static async resetSetting(client, guildId, key, adminId) {
        logger.info(`[CONFIG_SERVICE] Tilbakestiller innstilling`, {
            guildId,
            key,
            adminId
        });

        const currentConfig = await getGuildConfig(client, guildId);
        const oldValue = currentConfig[key];

        const defaultValue = null;

        const updatedConfig = { ...currentConfig, [key]: defaultValue };
        await setGuildConfig(client, guildId, updatedConfig);

        this.recordChange(guildId, {
            key,
            oldValue,
            newValue: defaultValue,
            changedBy: adminId,
            isReset: true,
            timestamp: new Date().toISOString()
        });

        logger.info(`[CONFIG_SERVICE] Innstilling tilbakestilt`, {
            guildId,
            key,
            adminId,
            oldValue,
            timestamp: new Date().toISOString()
        });

        return {
            key,
            oldValue,
            newValue: defaultValue
        };
    }

    static async getConfigSummary(client, guildId) {
        logger.debug(`[CONFIG_SERVICE] Henter konfigurasjonssammendrag`, { guildId });

        const config = await getGuildConfig(client, guildId);
        const guild = client.guilds.cache.get(guildId);

        if (!guild) {
            throw createError(
                'Server ikke funnet',
                ErrorTypes.VALIDATION,
                'Serveren eksisterer ikke.',
                { guildId }
            );
        }

        const summary = {};

        for (const [key, value] of Object.entries(config)) {
            if (this.PROTECTED_SETTINGS.includes(key)) continue;

            const rule = CONFIG_VALIDATION_RULES[key];
            if (!rule) continue;

            if (rule.type === 'channel' && value) {
                const channel = guild.channels.cache.get(value);
                summary[key] = {
                    id: value,
                    name: channel?.name || 'Ukjent',
                    status: channel ? 'Gyldig' : 'Mangler'
                };
            } else if (rule.type === 'role' && value) {
                const role = guild.roles.cache.get(value);
                summary[key] = {
                    id: value,
                    name: role?.name || 'Ukjent',
                    status: role ? 'Gyldig' : 'Mangler'
                };
            } else {
                summary[key] = value;
            }
        }

        return {
            guildId,
            settings: summary,
            recordedAt: new Date().toISOString()
        };
    }

    static verifyPermission(member) {
        return member.permissions.has([
            PermissionFlagsBits.Administrator,
            PermissionFlagsBits.ManageGuild
        ]);
    }
}

wrapServiceClassMethods(ConfigService, (methodName) => ({
    service: 'ConfigService',
    operation: methodName,
    message: `Konfigurasjonstjeneste-operasjon feilet: ${methodName}`,
    userMessage: 'En konfigurasjonsoperasjon feilet. Vennligst prøv igjen om et øyeblikk.'
}));

export default ConfigService;