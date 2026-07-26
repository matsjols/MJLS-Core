import { logger } from '../utils/logger.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { getReactionRoleKey, getReactionRolesPrefix } from '../utils/database/keys.js';

const MAX_ROLES_PER_MESSAGE = 25;

const DANGEROUS_PERMISSIONS = [
    'Administrator',
    'ManageGuild',
    'ManageRoles',
    'ManageChannels',
    'ManageWebhooks',
    'BanMembers',
    'KickMembers'
];

function validateGuildId(guildId) {
    if (!guildId || typeof guildId !== 'string' || !/^\d{17,19}$/.test(guildId)) {
        throw createError(
            `Ugyldig server-ID: ${guildId}`,
            ErrorTypes.VALIDATION,
            'Ugyldig server-ID oppgitt.',
            { guildId }
        );
    }
}

function validateMessageId(messageId) {
    if (!messageId || typeof messageId !== 'string' || !/^\d{17,19}$/.test(messageId)) {
        throw createError(
            `Ugyldig meldings-ID: ${messageId}`,
            ErrorTypes.VALIDATION,
            'Ugyldig meldings-ID oppgitt.',
            { messageId }
        );
    }
}

function validateRoleId(roleId) {
    if (!roleId || typeof roleId !== 'string' || !/^\d{17,19}$/.test(roleId)) {
        throw createError(
            `Ugyldig rolle-ID: ${roleId}`,
            ErrorTypes.VALIDATION,
            'Ugyldig rolle-ID oppgitt.',
            { roleId }
        );
    }
}

export function hasDangerousPermissions(role) {
    if (!role || !role.permissions) return false;
    
    for (const permission of DANGEROUS_PERMISSIONS) {
        if (role.permissions.has(permission)) {
            return true;
        }
    }
    return false;
}

async function validateRoleSafety(client, guildId, roleId) {
    const guild = client.guilds?.cache?.get(guildId) || await client.guilds?.fetch?.(guildId).catch(() => null);
    if (!guild) {
        throw createError(
            `Finner ikke server for validering av rolle: ${guildId}`,
            ErrorTypes.VALIDATION,
            'Fant ikke serveren under validering av reaksjonsroller.',
            { guildId, roleId }
        );
    }

    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
        throw createError(
            `Finner ikke rolle: ${roleId}`,
            ErrorTypes.VALIDATION,
            'En eller flere valgte roller eksisterer ikke lenger.',
            { guildId, roleId }
        );
    }

    if (hasDangerousPermissions(role)) {
        throw createError(
            `Farlig tilgangsnivå oppdaget for rolle: ${roleId}`,
            ErrorTypes.PERMISSION,
            'Av sikkerhetsgrunner kan ikke roller med høye rettigheter tildeles via reaksjonsroller.',
            { guildId, roleId, roleName: role.name, dangerousPermissions: DANGEROUS_PERMISSIONS }
        );
    }

    const botHighestRole = guild.members.me?.roles?.highest;
    if (!botHighestRole || role.position >= botHighestRole.position) {
        throw createError(
            `Rolle ligger over botens hierarki: ${roleId}`,
            ErrorTypes.PERMISSION,
            'Jeg kan ikke tildele denne rollen fordi den er lik eller høyere enn min høyeste rolle.',
            { guildId, roleId, rolePosition: role.position, botRolePosition: botHighestRole?.position }
        );
    }
}

export async function getReactionRoleMessage(client, guildId, messageId) {
    try {
        validateGuildId(guildId);
        validateMessageId(messageId);
        
        const key = getReactionRoleKey(guildId, messageId);
        const data = await client.db.get(key);
        return data || null;
    } catch (error) {
        if (error.name === 'TitanBotError') {
            throw error;
        }
        logger.error(`Feil ved henting av reaksjonsrolle-melding ${messageId} i server ${guildId}:`, error);
        throw createError(
            `Databasefeil ved henting av reaksjonsrolle-melding`,
            ErrorTypes.DATABASE,
            'Kunne ikke hente reaksjonsrolledata. Vennligst prøv igjen.',
            { guildId, messageId, originalError: error.message }
        );
    }
}

export async function createReactionRoleMessage(client, guildId, channelId, messageId, roleIds) {
    try {
        validateGuildId(guildId);
        validateMessageId(messageId);
        
        if (!channelId || typeof channelId !== 'string' || !/^\d{17,19}$/.test(channelId)) {
            throw createError(
                `Ugyldig kanal-ID: ${channelId}`,
                ErrorTypes.VALIDATION,
                'Ugyldig kanal-ID oppgitt.',
                { channelId }
            );
        }
        
        if (!Array.isArray(roleIds) || roleIds.length === 0) {
            throw createError(
                'Ingen roller oppgitt',
                ErrorTypes.VALIDATION,
                'Du må oppgi minst én rolle.',
                { roleIds }
            );
        }
        
        if (roleIds.length > MAX_ROLES_PER_MESSAGE) {
            throw createError(
                `For mange roller: ${roleIds.length}`,
                ErrorTypes.VALIDATION,
                `Du kan bare legge til opptil ${MAX_ROLES_PER_MESSAGE} roller per reaksjonsrolle-melding.`,
                { roleIds, limit: MAX_ROLES_PER_MESSAGE }
            );
        }

        for (const roleId of roleIds) {
            validateRoleId(roleId);
            await validateRoleSafety(client, guildId, roleId);
        }
        
        const reactionRoleData = {
            guildId,
            channelId,
            messageId,
            roles: roleIds,
            createdAt: new Date().toISOString()
        };
        
        const key = getReactionRoleKey(guildId, messageId);
        await client.db.set(key, reactionRoleData);
        
        logger.info(`Opprettet reaksjonsrolle-melding ${messageId} i server ${guildId} med ${roleIds.length} roller`);
        return reactionRoleData;
    } catch (error) {
        if (error.name === 'TitanBotError') {
            throw error;
        }
        logger.error(`Feil ved opprettelse av reaksjonsrolle-melding i server ${guildId}:`, error);
        throw createError(
            `Databasefeil ved opprettelse av reaksjonsrolle-melding`,
            ErrorTypes.DATABASE,
            'Kunne ikke lagre reaksjonsrolledata. Vennligst prøv igjen.',
            { guildId, messageId, originalError: error.message }
        );
    }
}

export async function addReactionRole(client, guildId, messageId, emoji, roleId) {
    try {
        validateGuildId(guildId);
        validateMessageId(messageId);
        validateRoleId(roleId);
        await validateRoleSafety(client, guildId, roleId);
        
        const key = getReactionRoleKey(guildId, messageId);
        const data = await getReactionRoleMessage(client, guildId, messageId) || {
            messageId,
            guildId,
            channelId: '',
            roles: {}
        };

        data.roles[emoji] = roleId;
        
        await client.db.set(key, data);
        logger.info(`Lagt til reaksjonsrolle for emoji ${emoji} på melding ${messageId} i server ${guildId}`);
        return true;
    } catch (error) {
        if (error.name === 'TitanBotError') {
            throw error;
        }
        logger.error(`Feil ved tilføying av reaksjonsrolle i server ${guildId}:`, error);
        throw createError(
            `Databasefeil ved tilføying av reaksjonsrolle`,
            ErrorTypes.DATABASE,
            'Kunne ikke legge til reaksjonsrolle. Vennligst prøv igjen.',
            { guildId, messageId, originalError: error.message }
        );
    }
}

export async function deleteReactionRoleMessage(client, guildId, messageId) {
    try {
        validateGuildId(guildId);
        validateMessageId(messageId);
        
        const key = getReactionRoleKey(guildId, messageId);
        const data = await getReactionRoleMessage(client, guildId, messageId);
        
        if (!data) {
            logger.debug(`Reaksjonsrolle-melding ${messageId} eksisterer ikke i server ${guildId}, ingenting å slette`);
            return true;
        }
        
        await client.db.delete(key);
        logger.info(`Slettet reaksjonsrolle-melding ${messageId} i server ${guildId}`);
        return true;
    } catch (error) {
        if (error.name === 'TitanBotError') {
            throw error;
        }
        logger.error(`Feil ved sletting av reaksjonsrolle-melding i server ${guildId}:`, error);
        throw createError(
            `Databasefeil ved sletting av reaksjonsrolle-melding`,
            ErrorTypes.DATABASE,
            'Kunne ikke slette reaksjonsrolle-melding. Vennligst prøv igjen.',
            { guildId, messageId, originalError: error.message }
        );
    }
}

export async function removeReactionRole(client, guildId, messageId, emoji) {
    try {
        validateGuildId(guildId);
        validateMessageId(messageId);
        
        const key = getReactionRoleKey(guildId, messageId);
        const data = await getReactionRoleMessage(client, guildId, messageId);
        
        if (!data || !data.roles[emoji]) {
            return false;
        }

        delete data.roles[emoji];

        if (Object.keys(data.roles).length === 0) {
            await client.db.delete(key);
            logger.info(`Fjernet siste reaksjonsrolle fra melding ${messageId}, slettet meldingsdata`);
        } else {
            await client.db.set(key, data);
            logger.info(`Fjernet reaksjonsrolle for emoji ${emoji} fra melding ${messageId}`);
        }
        
        return true;
    } catch (error) {
        if (error.name === 'TitanBotError') {
            throw error;
        }
        logger.error(`Feil ved fjerning av reaksjonsrolle i server ${guildId}:`, error);
        throw createError(
            `Databasefeil ved fjerning av reaksjonsrolle`,
            ErrorTypes.DATABASE,
            'Kunne ikke fjerne reaksjonsrolle. Vennligst prøv igjen.',
            { guildId, messageId, originalError: error.message }
        );
    }
}

export async function getAllReactionRoleMessages(client, guildId) {
    try {
        validateGuildId(guildId);
        
        const prefix = getReactionRolesPrefix(guildId);
        
        let keys;
        try {
            keys = await client.db.list(prefix);
            
            if (keys && typeof keys === 'object') {
                if (Array.isArray(keys)) {
                    
                } else if (keys.value && Array.isArray(keys.value)) {
                    keys = keys.value;
                } else {
                    const allKeys = await client.db.list();
                    
                    if (Array.isArray(allKeys)) {
                        keys = allKeys.filter(key => key.startsWith(prefix));
                    } else if (allKeys.value && Array.isArray(allKeys.value)) {
                        keys = allKeys.value.filter(key => key.startsWith(prefix));
                    } else {
                        return [];
                    }
                }
            } else {
                return [];
            }
        } catch (listError) {
            logger.error(`Feil ved opplisting av reaksjonsrolle-nøkler for server ${guildId}:`, listError);
            throw createError(
                'Databasefeil ved opplisting av reaksjonsroller',
                ErrorTypes.DATABASE,
                'Kunne ikke hente liste over reaksjonsroller. Vennligst prøv igjen.',
                { guildId, originalError: listError.message }
            );
        }
        
        if (!keys || keys.length === 0) {
            return [];
        }

        const messages = [];
        
        for (const key of keys) {
            try {
                const data = await client.db.get(key);
                
                if (data) {
                    let actualData;
                    if (data && data.ok && data.value) {
                        actualData = data.value;
                    } else if (data && data.value) {
                        actualData = data.value;
                    } else {
                        actualData = data;
                    }
                    
                    if (actualData && actualData.messageId && actualData.channelId) {
                        messages.push(actualData);
                    } else if (actualData) {
                        logger.warn(`Hopper over feilformatert reaksjonsrolledata for server ${guildId}:`, actualData);
                    }
                }
            } catch (dataError) {
                logger.warn(`Feil ved henting av data for reaksjonsrolle-nøkkel ${key}:`, dataError);
            }
        }

        return messages;
    } catch (error) {
        if (error.name === 'TitanBotError') {
            throw error;
        }
        logger.error(`Feil ved henting av alle reaksjonsrolle-meldinger for server ${guildId}:`, error);
        throw createError(
            'Databasefeil ved henting av reaksjonsroller',
            ErrorTypes.DATABASE,
            'Kunne ikke hente reaksjonsrolle-meldinger. Vennligst prøv igjen.',
            { guildId, originalError: error.message }
        );
    }
}

export async function setReactionRoleChannel(client, guildId, messageId, channelId) {
    try {
        validateGuildId(guildId);
        validateMessageId(messageId);
        
        if (!channelId || typeof channelId !== 'string' || !/^\d{17,19}$/.test(channelId)) {
            throw createError(
                `Ugyldig kanal-ID: ${channelId}`,
                ErrorTypes.VALIDATION,
                'Ugyldig kanal-ID oppgitt.',
                { channelId }
            );
        }
        
        const key = getReactionRoleKey(guildId, messageId);
        const data = await getReactionRoleMessage(client, guildId, messageId) || {
            messageId,
            guildId,
            channelId: '',
            roles: {}
        };

        data.channelId = channelId;
        await client.db.set(key, data);
        logger.info(`Satte kanal ${channelId} for reaksjonsrolle-melding ${messageId}`);
        return true;
    } catch (error) {
        if (error.name === 'TitanBotError') {
            throw error;
        }
        logger.error(`Feil ved setting av kanal for reaksjonsrolle-melding ${messageId}:`, error);
        throw createError(
            `Databasefeil ved setting av reaksjonsrolle-kanal`,
            ErrorTypes.DATABASE,
            'Kunne ikke oppdatere kanal for reaksjonsrolle. Vennligst prøv igjen.',
            { guildId, messageId, channelId, originalError: error.message }
        );
    }
}

export async function reconcileReactionRoleMessages(client, guildId = null) {
    const summary = {
        scannedGuilds: 0,
        scannedMessages: 0,
        removedMessages: 0,
        errors: 0
    };

    try {
        const targetGuildIds = guildId
            ? [guildId]
            : Array.from(client.guilds.cache.keys());

        for (const targetGuildId of targetGuildIds) {
            summary.scannedGuilds += 1;

            let reactionRoleMessages = [];
            try {
                reactionRoleMessages = await getAllReactionRoleMessages(client, targetGuildId);
            } catch (error) {
                summary.errors += 1;
                logger.warn(`Kunne ikke hente reaksjonsrolle-meldinger for synkronisering i server ${targetGuildId}:`, error);
                continue;
            }

            if (!reactionRoleMessages.length) {
                continue;
            }

            const guild = client.guilds.cache.get(targetGuildId) || await client.guilds.fetch(targetGuildId).catch(() => null);
            if (!guild) {
                for (const reactionRoleMessage of reactionRoleMessages) {
                    summary.scannedMessages += 1;
                    await client.db.delete(getReactionRoleKey(targetGuildId, reactionRoleMessage.messageId));
                    summary.removedMessages += 1;
                }
                logger.info(`Fjernet ${reactionRoleMessages.length} foreldede reaksjonsrolle-meldinger for utilgjengelig server ${targetGuildId}`);
                continue;
            }

            for (const reactionRoleMessage of reactionRoleMessages) {
                summary.scannedMessages += 1;

                try {
                    const channel = guild.channels.cache.get(reactionRoleMessage.channelId)
                        || await guild.channels.fetch(reactionRoleMessage.channelId).catch(() => null);

                    if (!channel || !channel.isTextBased?.()) {
                        await client.db.delete(getReactionRoleKey(targetGuildId, reactionRoleMessage.messageId));
                        summary.removedMessages += 1;
                        continue;
                    }

                    const message = await channel.messages.fetch(reactionRoleMessage.messageId).catch(() => null);
                    if (!message) {
                        await client.db.delete(getReactionRoleKey(targetGuildId, reactionRoleMessage.messageId));
                        summary.removedMessages += 1;
                    }
                } catch (messageCheckError) {
                    summary.errors += 1;
                    logger.warn(
                        `Kunne ikke validere reaksjonsrolle-melding ${reactionRoleMessage.messageId} under synkronisering:`,
                        messageCheckError
                    );
                }
            }
        }

        logger.info(
            `Synkronisering av reaksjonsroller fullført: skannet ${summary.scannedMessages} melding(er) over ${summary.scannedGuilds} server(e), fjernet ${summary.removedMessages}, feil ${summary.errors}`
        );

        return summary;
    } catch (error) {
        logger.error('Uventet feil under synkronisering av reaksjonsroller:', error);
        summary.errors += 1;
        return summary;
    }
}