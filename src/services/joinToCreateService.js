import {
    getJoinToCreateConfig,
    saveJoinToCreateConfig,
    updateJoinToCreateConfig,
    getTemporaryChannelInfo,
    formatChannelName as formatChannelNameUtil
} from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { formatLogLine } from '../utils/logging/logEmbeds.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

const CHANNEL_NAME_MAX_LENGTH = 100;
const CHANNEL_VARIABLE_MAX_LENGTH = 32;
const CONTROL_AND_INVISIBLE_CHARS_REGEX = /[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g;
const ALLOWED_TEMPLATE_PLACEHOLDERS = new Set([
    '{username}',
    '{user_tag}',
    '{displayName}',
    '{display_name}',
    '{guildName}',
    '{guild_name}',
    '{channelName}',
    '{channel_name}'
]);

export function validateChannelNameTemplate(template) {
    if (!template || typeof template !== 'string') {
        throw new TitanBotError(
            'Ugyldig kanalmal: må være en tekststreng som ikke er tom',
            ErrorTypes.VALIDATION,
            'Kanalnavnmalen må bestå av gyldig tekst.'
        );
    }

    const normalizedTemplate = template.normalize('NFKC').replace(CONTROL_AND_INVISIBLE_CHARS_REGEX, '').trim();

    if (normalizedTemplate.length > CHANNEL_NAME_MAX_LENGTH) {
        throw new TitanBotError(
            'Kanalmalen overskrider maksimal lengde',
            ErrorTypes.VALIDATION,
            `Kanalnavnmalen kan ikke være lengre enn ${CHANNEL_NAME_MAX_LENGTH} tegn.`
        );
    }

    if (/[@#:`]/.test(normalizedTemplate)) {
        throw new TitanBotError(
            'Kanalmalen inneholder ulovlige tegn',
            ErrorTypes.VALIDATION,
            'Kanalmalen kan ikke inneholde tegnene @, #, : eller backtick (`).'
        );
    }

    const placeholders = normalizedTemplate.match(/\{[^}]+\}/g) || [];
    for (const placeholder of placeholders) {
        if (!ALLOWED_TEMPLATE_PLACEHOLDERS.has(placeholder)) {
            throw new TitanBotError(
                'Kanalmalen inneholder ukjente variabler',
                ErrorTypes.VALIDATION,
                `Ukjent variabel: ${placeholder}. Tillatte variabler er ${Array.from(ALLOWED_TEMPLATE_PLACEHOLDERS).join(', ')}`
            );
        }
    }

    return true;
}

export function validateBitrate(bitrate) {
    const bitrateNum = parseInt(bitrate);

    if (isNaN(bitrateNum)) {
        throw new TitanBotError(
            'Bitrate må være et gyldig tall',
            ErrorTypes.VALIDATION,
            'Vennligst oppgi et gyldig tall for bitrate.'
        );
    }

    if (bitrateNum < 8 || bitrateNum > 384) {
        throw new TitanBotError(
            'Bitrate er utenfor gyldig område',
            ErrorTypes.VALIDATION,
            'Bitrate må settes mellom 8 og 384 kbps.'
        );
    }

    return true;
}

export function validateUserLimit(limit) {
    const limitNum = parseInt(limit);

    if (isNaN(limitNum)) {
        throw new TitanBotError(
            'Brukergrensen må være et gyldig tall',
            ErrorTypes.VALIDATION,
            'Vennligst oppgi et gyldig tall for brukergrense.'
        );
    }

    if (limitNum < 0 || limitNum > 99) {
        throw new TitanBotError(
            'Brukergrensen er utenfor gyldig område',
            ErrorTypes.VALIDATION,
            'Brukergrense må være mellom 0 (ingen grense) og 99.'
        );
    }

    return true;
}

export function formatChannelName(template, variables) {
    try {
        const safeTemplate = template.normalize('NFKC').replace(CONTROL_AND_INVISIBLE_CHARS_REGEX, '').trim();
        validateChannelNameTemplate(safeTemplate);

        if (!variables || typeof variables !== 'object') {
            throw new TitanBotError(
                'Ugyldig variabelobjekt for kanalformatering',
                ErrorTypes.VALIDATION
            );
        }

        const sanitized = {};
        for (const [key, value] of Object.entries(variables)) {
            if (value === null || value === undefined) {
                sanitized[key] = 'Ukjent';
            } else {
                sanitized[key] = String(value)
                    .normalize('NFKC')
                    .replace(CONTROL_AND_INVISIBLE_CHARS_REGEX, '')
                    .replace(/[@#:`\n\r\t]/g, '') 
                    .trim()
                    .substring(0, CHANNEL_VARIABLE_MAX_LENGTH);
            }
        }

        const replacements = {
            '{username}': sanitized.username || 'Bruker',
            '{user_tag}': sanitized.userTag || 'Bruker#0000',
            '{displayName}': sanitized.displayName || 'Bruker',
            '{display_name}': sanitized.displayName || 'Bruker',
            '{guildName}': sanitized.guildName || 'Server',
            '{guild_name}': sanitized.guildName || 'Server',
            '{channelName}': sanitized.channelName || 'Talekanal',
            '{channel_name}': sanitized.channelName || 'Talekanal',
        };

        let formatted = safeTemplate;
        for (const [placeholder, value] of Object.entries(replacements)) {
            formatted = formatted.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
        }

        formatted = formatted
            .normalize('NFKC')
            .replace(CONTROL_AND_INVISIBLE_CHARS_REGEX, '')
            .replace(/[@#:`\n\r\t]/g, '') 
            .replace(/\s+/g, ' ')
            .trim();

        if (formatted.length === 0) {
            formatted = 'Talekanal';
        } else if (formatted.length > CHANNEL_NAME_MAX_LENGTH) {
            formatted = formatted.substring(0, CHANNEL_NAME_MAX_LENGTH);
        }

        logger.debug(`Formatert kanalnavn: "${formatted}" fra malen "${template}"`);
        return formatted;

    } catch (error) {
        logger.error('Feil ved formatering av kanalnavn:', error);
        throw error;
    }
}

export async function initializeJoinToCreate(client, guildId, channelId, options = {}) {
    try {
        if (!client || !client.db) {
            throw new TitanBotError(
                'Databasetjenesten er ikke tilgjengelig',
                ErrorTypes.DATABASE,
                'Systemfeil oppstod. Vennligst prøv igjen.'
            );
        }

        if (!guildId || !channelId) {
            throw new TitanBotError(
                'Mangler nødvendig server- eller kanal-ID',
                ErrorTypes.VALIDATION,
                'Ugyldig server- eller kanalinformasjon oppgitt.'
            );
        }

        if (options.nameTemplate) {
            validateChannelNameTemplate(options.nameTemplate);
        }
        if (options.bitrate) {
            validateBitrate(options.bitrate / 1000); 
        }
        if (options.userLimit !== undefined) {
            validateUserLimit(options.userLimit);
        }

        const config = await getJoinToCreateConfig(client, guildId);

        if (config.triggerChannels.includes(channelId)) {
            throw new TitanBotError(
                'Kanalen er allerede konfigurert som utløser for Join to Create',
                ErrorTypes.VALIDATION,
                'Denne kanalen er allerede satt opp som en Join to Create-utløser.'
            );
        }

        if (Array.isArray(config.triggerChannels) && config.triggerChannels.length > 0) {
            throw new TitanBotError(
                'Serveren har allerede en aktivert Join to Create-kanal',
                ErrorTypes.VALIDATION,
                'Serveren har allerede en Join to Create-kanal satt opp. Bruk `/jointocreate dashboard` for å endre den, eller fjern den eksisterende før du oppretter en ny.',
                {
                    guildId,
                    existingTriggerChannelId: config.triggerChannels[0],
                    expected: true,
                    suppressErrorLog: true
                }
            );
        }

        config.triggerChannels.push(channelId);
        config.enabled = true;

        if (Object.keys(options).length > 0) {
            if (!config.channelOptions) {
                config.channelOptions = {};
            }
            config.channelOptions[channelId] = {
                nameTemplate: options.nameTemplate || config.channelNameTemplate,
                userLimit: options.userLimit !== undefined ? options.userLimit : config.userLimit,
                bitrate: options.bitrate || config.bitrate,
                categoryId: options.categoryId || null,
                createdAt: Date.now()
            };
        }

        const saveResult = await saveJoinToCreateConfig(client, guildId, config);
        if (!saveResult) {
            throw new TitanBotError(
                'Klarte ikke å lagre Join to Create-konfigurasjonen',
                ErrorTypes.DATABASE,
                'Klarte ikke å sette opp Join to Create-systemet. Vennligst prøv igjen.'
            );
        }

        logger.info(`Initialiserte Join to Create for server ${guildId} med utløserkanal ${channelId}`);

        return config;

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Klarte ikke å konfigurere Join to Create: ${error.message}`,
            ErrorTypes.DATABASE,
            'Kunne ikke fullføre oppsettet av Join to Create.'
        );
    }
}

export async function updateChannelConfig(client, guildId, channelId, updates) {
    try {
        if (!client || !client.db) {
            throw new TitanBotError(
                'Databasetjenesten er ikke tilgjengelig',
                ErrorTypes.DATABASE,
                'Databasetjenesten er for øyeblikket utilgjengelig. Vennligst prøv igjen senere.'
            );
        }

        const config = await getJoinToCreateConfig(client, guildId);

        if (!config.triggerChannels.includes(channelId)) {
            throw new TitanBotError(
                'Kanalen er ikke konfigurert som en Join to Create-utløser',
                ErrorTypes.VALIDATION,
                'Denne kanalen er ikke opprettet som utløserkanal.'
            );
        }

        if (updates.nameTemplate) {
            validateChannelNameTemplate(updates.nameTemplate);
        }
        if (updates.bitrate !== undefined) {
            validateBitrate(updates.bitrate / 1000);
        }
        if (updates.userLimit !== undefined) {
            validateUserLimit(updates.userLimit);
        }

        if (!config.channelOptions) {
            config.channelOptions = {};
        }

        config.channelOptions[channelId] = {
            ...config.channelOptions[channelId],
            ...updates,
            updatedAt: Date.now()
        };

        await saveJoinToCreateConfig(client, guildId, config);

        logger.info(`Oppdaterte Join to Create-innstillinger for kanal ${channelId} på server ${guildId}`, {
            updates: Object.keys(updates)
        });

        return config.channelOptions[channelId];

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Klarte ikke å oppdatere kanalinnstillingene: ${error.message}`,
            ErrorTypes.DATABASE,
            'Kunne ikke lagre oppdaterte innstillinger.'
        );
    }
}

export async function removeTriggerChannel(client, guildId, channelId) {
    try {
        if (!client || !client.db) {
            throw new TitanBotError(
                'Databasetjenesten er ikke tilgjengelig',
                ErrorTypes.DATABASE,
                'Databasetjenesten er for øyeblikket utilgjengelig. Vennligst prøv igjen senere.'
            );
        }

        const config = await getJoinToCreateConfig(client, guildId);

        const index = config.triggerChannels.indexOf(channelId);
        if (index === -1) {
            throw new TitanBotError(
                'Finner ikke kanalen blant aktive utløsere',
                ErrorTypes.VALIDATION,
                'Denne kanalen er ikke satt opp som en utløserkanal.'
            );
        }

        config.triggerChannels.splice(index, 1);
        config.enabled = config.triggerChannels.length > 0;

        if (config.channelOptions && config.channelOptions[channelId]) {
            delete config.channelOptions[channelId];
        }

        if (config.temporaryChannels) {
            for (const [tempChannelId, tempInfo] of Object.entries(config.temporaryChannels)) {
                if (tempInfo.triggerChannelId === channelId) {
                    delete config.temporaryChannels[tempChannelId];
                }
            }
        }

        await saveJoinToCreateConfig(client, guildId, config);

        logger.info(`Fjernet Join to Create-utløserkanal ${channelId} fra server ${guildId}`);

        return true;

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Klarte ikke å fjerne utløserkanal: ${error.message}`,
            ErrorTypes.DATABASE,
            'Feil oppstod ved fjerning av utløserkanal.'
        );
    }
}

export async function getConfiguration(client, guildId) {
    try {
        if (!client || !client.db) {
            throw new TitanBotError(
                'Databasetjenesten er ikke tilgjengelig',
                ErrorTypes.DATABASE,
                'Databasetjenesten er for øyeblikket utilgjengelig. Vennligst prøv igjen senere.'
            );
        }

        return await getJoinToCreateConfig(client, guildId);

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Klarte ikke å hente konfigurasjon: ${error.message}`,
            ErrorTypes.DATABASE,
            'Kunne ikke hente innstillinger.'
        );
    }
}

export async function isTriggerChannel(client, guildId, channelId) {
    try {
        const config = await getConfiguration(client, guildId);
        return config.triggerChannels.includes(channelId);
    } catch (error) {
        logger.error(`Feil under kontroll av utløserkanal: ${error.message}`);
        return false;
    }
}

export async function getChannelConfiguration(client, guildId, channelId) {
    try {
        const config = await getConfiguration(client, guildId);

        if (!config.triggerChannels || !Array.isArray(config.triggerChannels) || !config.triggerChannels.includes(channelId)) {
            throw new TitanBotError(
                'Kanalen er ikke en gyldig utløser for Join to Create',
                ErrorTypes.VALIDATION,
                'Denne kanalen er ikke satt opp som en Join to Create-utløser.'
            );
        }

        return {
            ...config,
            channelConfig: config.channelOptions?.[channelId] || {}
        };

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Klarte ikke å hente kanalinnstillingene: ${error.message}`,
            ErrorTypes.DATABASE,
            'Kunne ikke hente konfigurasjon for denne kanalen. Vennligst prøv igjen.'
        );
    }
}

export function hasManageGuildPermission(member) {
    try {
        if (!member || !member.permissions) {
            return false;
        }
        return member.permissions.has(PermissionFlagsBits.ManageGuild);
    } catch (error) {
        logger.error('Feil ved sjekk av ManageGuild-rettigheter:', error);
        return false;
    }
}

export async function logConfigurationChange(client, guildId, userId, action, details) {
    try {
        await logEvent({
            client,
            guildId,
            eventType: EVENT_TYPES.COUNTER_CONFIG,
            data: {
                title: 'Join to Create oppdatert',
                lines: [
                    formatLogLine('Handling', action),
                    formatLogLine('Detaljer', typeof details === 'string' ? details : JSON.stringify(details)),
                ],
                userId,
            },
        });
    } catch (error) {
        logger.warn(`Klarte ikke å logge endring i Join to Create-oppsettet: ${error.message}`);
    }
}

export async function createTemporaryChannel(guild, member, options = {}) {
    try {
        if (!guild || !member) {
            throw new TitanBotError(
                'Ugyldig server eller medlem',
                ErrorTypes.VALIDATION
            );
        }

        const {
            nameTemplate,
            userLimit,
            bitrate,
            parentId
        } = options;

        if (nameTemplate) {
            validateChannelNameTemplate(nameTemplate);
        }
        if (userLimit !== undefined) {
            validateUserLimit(userLimit);
        }
        if (bitrate !== undefined) {
            validateBitrate(bitrate / 1000);
        }

        const channelName = formatChannelName(nameTemplate || '{username} sitt rom', {
            username: member.user.username,
            displayName: member.displayName,
            userTag: member.user.tag,
            guildName: guild.name
        });

        const tempChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: parentId,
            userLimit: userLimit === 0 ? undefined : userLimit,
            bitrate: bitrate || 64000,
            permissionOverwrites: [
                {
                    id: member.id,
                    allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.PrioritySpeaker, PermissionFlagsBits.MoveMembers]
                },
                {
                    id: guild.id,
                    allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
                }
            ]
        });

        logger.info(`Opprettet midlertidig talekanal ${tempChannel.name} (${tempChannel.id}) for bruker ${member.user.tag}`);

        return {
            id: tempChannel.id,
            name: tempChannel.name,
            ownerId: member.id
        };

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Klarte ikke å opprette midlertidig kanal: ${error.message}`,
            ErrorTypes.DISCORD_API,
            'Feil oppstod ved opprettelse av den midlertidige talekanalen. Vennligst kontakt en administrator.'
        );
    }
}

export default {
    validateChannelNameTemplate,
    validateBitrate,
    validateUserLimit,
    formatChannelName,
    initializeJoinToCreate,
    updateChannelConfig,
    removeTriggerChannel,
    getConfiguration,
    isTriggerChannel,
    getChannelConfiguration,
    hasManageGuildPermission,
    logConfigurationChange,
    createTemporaryChannel
};