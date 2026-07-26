// guildConfig.js — den eneste modulen som skal lese/skrive serverkonfigurasjon.

import { GUILD_CONFIG_DEFAULTS } from '../../config/guild/guildConfigDefaults.js';
import { readGuildConfig, writeGuildConfig } from '../../utils/database/guildConfigStorage.js';
import { normalizeGuildConfig, validateGuildConfigOrThrow } from '../../utils/schemas.js';
import { createError, ErrorTypes, wrapServiceBoundary } from '../../utils/errorHandler.js';

export { GUILD_CONFIG_DEFAULTS };

export const getGuildConfig = wrapServiceBoundary(async function getGuildConfig(client, guildId, context = {}) {
    const config = await readGuildConfig(client, guildId, context);
    return normalizeGuildConfig(config, GUILD_CONFIG_DEFAULTS);
}, {
    service: 'guildConfigService',
    operation: 'getGuildConfig',
    message: 'Kunne ikke hente serverkonfigurasjon',
    userMessage: 'Kunne ikke laste inn serverkonfigurasjonen. Vennligst prøv igjen.',
});

export const setGuildConfig = wrapServiceBoundary(async function setGuildConfig(client, guildId, config, context = {}) {
    const normalized = normalizeGuildConfig(config, GUILD_CONFIG_DEFAULTS);
    return await writeGuildConfig(client, guildId, normalized, context);
}, {
    service: 'guildConfigService',
    operation: 'setGuildConfig',
    message: 'Kunne ikke lagre serverkonfigurasjon',
    userMessage: 'Kunne ikke lagre serverkonfigurasjonen. Vennligst prøv igjen.',
});

export const updateGuildConfig = wrapServiceBoundary(async function updateGuildConfig(client, guildId, updates, context = {}) {
    const currentConfig = await readGuildConfig(client, guildId, context);
    const merged = { ...currentConfig, ...updates };
    const normalized = normalizeGuildConfig(merged, GUILD_CONFIG_DEFAULTS);
    return await writeGuildConfig(client, guildId, normalized, context);
}, {
    service: 'guildConfigService',
    operation: 'updateGuildConfig',
    message: 'Kunne ikke oppdatere serverkonfigurasjon',
    userMessage: 'Kunne ikke oppdatere serverkonfigurasjonen. Vennligst prøv igjen.',
});

export const getConfigValue = wrapServiceBoundary(async function getConfigValue(client, guildId, key, defaultValue = null, context = {}) {
    const config = await getGuildConfig(client, guildId, context);
    return config[key] !== undefined ? config[key] : defaultValue;
}, {
    service: 'guildConfigService',
    operation: 'getConfigValue',
    message: 'Kunne ikke lese verdi fra serverkonfigurasjon',
    userMessage: 'Kunne ikke lese en serverinnstilling. Vennligst prøv igjen.',
});

export const setConfigValue = wrapServiceBoundary(async function setConfigValue(client, guildId, key, value, context = {}) {
    return await updateGuildConfig(client, guildId, { [key]: value }, context);
}, {
    service: 'guildConfigService',
    operation: 'setConfigValue',
    message: 'Kunne ikke oppdatere verdi i serverkonfigurasjon',
    userMessage: 'Kunne ikke oppdatere en serverinnstilling. Vennligst prøv igjen.',
});

/**
 * Slå sammen delvise oppdateringer i et nøstet konfigurasjonsobjekt (f.eks. verifisering, logging).
 */
export const patchGuildConfig = wrapServiceBoundary(async function patchGuildConfig(client, guildId, patch, context = {}) {
    if (!patch || typeof patch !== 'object') {
        throw createError(
            'Ugyldig patch for serverkonfigurasjon',
            ErrorTypes.VALIDATION,
            'Ugyldig konfigurasjonsoppdatering.',
            { guildId, ...context },
        );
    }

    const currentConfig = await readGuildConfig(client, guildId, context);
    const merged = deepMergeGuildConfig(currentConfig, patch);
    const normalized = normalizeGuildConfig(merged, GUILD_CONFIG_DEFAULTS);
    validateGuildConfigOrThrow(normalized, { guildId, ...context });
    return await writeGuildConfig(client, guildId, normalized, context);
}, {
    service: 'guildConfigService',
    operation: 'patchGuildConfig',
    message: 'Kunne ikke lappe (patch) serverkonfigurasjon',
    userMessage: 'Kunne ikke oppdatere serverkonfigurasjonen. Vennligst prøv igjen.',
});

function deepMergeGuildConfig(base, patch) {
    const result = { ...base };

    for (const [key, value] of Object.entries(patch)) {
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            base[key] &&
            typeof base[key] === 'object' &&
            !Array.isArray(base[key])
        ) {
            result[key] = { ...base[key], ...value };
        } else {
            result[key] = value;
        }
    }

    return result;
}