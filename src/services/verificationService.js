import { PermissionFlagsBits } from 'discord.js';
import { botConfig } from '../config/bot.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig, setGuildConfig } from './config/guildConfig.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { insertVerificationAudit } from '../utils/database.js';
import { ensureTypedServiceError } from '../utils/serviceErrorBoundary.js';

const verificationCooldowns = new Map();
const attemptTracker = new Map();

const verificationDefaults = botConfig?.verification || {};
const autoVerifyDefaults = verificationDefaults.autoVerify || {};
const minAutoVerifyAccountAgeDays = autoVerifyDefaults.minAccountAge ?? 1;
const maxAutoVerifyAccountAgeDays = autoVerifyDefaults.maxAccountAge ?? 365;
const serverSizeThreshold = autoVerifyDefaults.serverSizeThreshold ?? 1000;
const defaultCooldownMs = verificationDefaults.verificationCooldown ?? 5000;
const defaultMaxAttempts = verificationDefaults.maxVerificationAttempts ?? 3;
const defaultAttemptWindowMs = verificationDefaults.attemptWindow ?? 60000;
const maxCooldownEntries = verificationDefaults.maxCooldownEntries ?? 10000;
const maxAttemptEntries = verificationDefaults.maxAttemptEntries ?? 10000;
const cooldownCleanupIntervalMs = verificationDefaults.cooldownCleanupInterval ?? 300000;
const maxAuditMetadataBytes = verificationDefaults.maxAuditMetadataBytes ?? 4096;
const shouldSendAutoVerifyDm = autoVerifyDefaults.sendDMNotification ?? true;
const shouldLogVerifications = verificationDefaults.logAllVerifications ?? true;
const shouldKeepAuditTrail = verificationDefaults.keepAuditTrail ?? false;
let lastCleanupAt = 0;

export async function verifyUser(client, guildId, userId, options = {}) {
    const { source = 'manual', moderatorId = null } = options;
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            throw createError(
                `Guild ${guildId} not found`,
                ErrorTypes.CONFIGURATION,
                "Serveren ble ikke funnet i botens hurtigbuffer.",
                { guildId }
            );
        }

        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch (error) {
            throw createError(
                `Member ${userId} not found in guild`,
                ErrorTypes.USER_INPUT,
                "Brukeren er ikke på denne serveren.",
                { userId, guildId }
            );
        }

        const guildConfig = await getGuildConfig(client, guildId);
        
        if (!guildConfig.verification?.enabled) {
            throw createError(
                "Verification system disabled",
                ErrorTypes.CONFIGURATION,
                "Verifiseringssystemet er ikke aktivert på denne serveren.",
                { guildId }
            );
        }

        await validateVerificationSetup(guild, guildConfig.verification);

        const verifiedRole = guild.roles.cache.get(guildConfig.verification.roleId);
        const canAssignRole = await validateBotCanAssignRole(guild, verifiedRole.id);
        if (!canAssignRole) {
            throw createError(
                'Bot cannot assign verified role',
                ErrorTypes.PERMISSION,
                "Jeg kan ikke tildele verifisert-rollen. Vennligst sjekk min **Administrer roller**-tillatelse og rollehierarkiet.",
                { guildId, roleId: verifiedRole.id }
            );
        }

        if (member.roles.cache.has(verifiedRole.id)) {
            return {
                status: 'already_verified',
                userId,
                roleId: verifiedRole.id,
                roleName: verifiedRole.name,
            };
        }

        await checkVerificationCooldown(userId, guildId, defaultCooldownMs);
        await trackVerificationAttempt(userId, guildId, defaultMaxAttempts, defaultAttemptWindowMs);

        await member.roles.add(verifiedRole.id, `Bruker verifisert (${source})`);

        logVerificationAction(client, guildId, userId, 'verified', {
            source,
            roleId: verifiedRole.id,
            roleName: verifiedRole.name,
            moderatorId
        });

        logger.info('Bruker verifisert', {
            guildId,
            userId,
            roleId: verifiedRole.id,
            source,
            moderatorId
        });

        return {
            status: 'verified',
            userId,
            roleId: verifiedRole.id,
            roleName: verifiedRole.name,
        };

    } catch (error) {
        const typedError = ensureTypedServiceError(error, {
            service: 'verificationService',
            operation: 'verifyUser',
            type: ErrorTypes.UNKNOWN,
            message: 'Verification operation failed: verifyUser',
            userMessage: 'Verifisering feilet. Vennligst prøv igjen om et øyeblikk.',
            context: { guildId, userId, source: options.source }
        });
        logger.error('Feil ved verifisering av bruker', {
            guildId,
            userId,
            source: options.source,
            error: typedError.message,
            errorCode: typedError.context?.errorCode
        });
        throw typedError;
    }
}

function pruneVerificationTrackers(now = Date.now()) {
    if (now - lastCleanupAt < cooldownCleanupIntervalMs) {
        return;
    }

    lastCleanupAt = now;

    for (const [key, timestamp] of verificationCooldowns.entries()) {
        if (now - timestamp > Math.max(defaultCooldownMs * 2, 60000)) {
            verificationCooldowns.delete(key);
        }
    }

    for (const [key, attempts] of attemptTracker.entries()) {
        const recentAttempts = (attempts || []).filter(ts => now - ts < defaultAttemptWindowMs);
        if (recentAttempts.length === 0) {
            attemptTracker.delete(key);
            continue;
        }
        attemptTracker.set(key, recentAttempts);
    }

    while (verificationCooldowns.size > maxCooldownEntries) {
        const firstKey = verificationCooldowns.keys().next().value;
        if (!firstKey) {
            break;
        }
        verificationCooldowns.delete(firstKey);
    }

    while (attemptTracker.size > maxAttemptEntries) {
        const firstKey = attemptTracker.keys().next().value;
        if (!firstKey) {
            break;
        }
        attemptTracker.delete(firstKey);
    }
}

export async function autoVerifyOnJoin(client, guild, member, verificationConfig) {
    try {
        if (!verificationConfig.autoVerify?.enabled) {
            return {
                autoVerified: false,
                reason: 'auto_verify_disabled'
            };
        }

        const autoVerifyRoleId = verificationConfig.autoVerify?.roleId || verificationConfig.roleId;
        if (!autoVerifyRoleId) {
            return {
                autoVerified: false,
                reason: 'auto_verify_role_not_configured'
            };
        }

        const effectiveVerificationConfig = {
            ...verificationConfig,
            roleId: autoVerifyRoleId
        };

        await validateVerificationSetup(guild, effectiveVerificationConfig);

        const shouldVerify = evaluateAutoVerifyCriteria(
            member,
            verificationConfig.autoVerify
        );

        if (!shouldVerify) {
            return {
                autoVerified: false,
                reason: 'criteria_not_met',
                criteria: verificationConfig.autoVerify.criteria
            };
        }

        const verifiedRole = guild.roles.cache.get(autoVerifyRoleId);

        const canAssign = await validateBotCanAssignRole(guild, verifiedRole.id);
        if (!canAssign) {
            logger.warn('Kunne ikke automatisk verifisere: boten kan ikke tildele rollen', {
                guildId: guild.id,
                userId: member.id,
                roleId: verifiedRole.id
            });
            return {
                autoVerified: false,
                reason: 'bot_cannot_assign_role'
            };
        }

        if (member.roles.cache.has(verifiedRole.id)) {
            return {
                autoVerified: false,
                reason: 'already_verified',
                alreadyHasRole: true
            };
        }

        await member.roles.add(verifiedRole.id, 'Automatisk verifisert ved tilkobling');

        logVerificationAction(client, guild.id, member.id, 'auto_verified', {
            criteria: verificationConfig.autoVerify.criteria,
            accountAge: Date.now() - member.user.createdTimestamp,
            roleId: verifiedRole.id,
            roleName: verifiedRole.name
        });

        logger.info('Bruker automatisk verifisert ved tilkobling', {
            guildId: guild.id,
            userId: member.id,
            userTag: member.user.tag,
            criteria: verificationConfig.autoVerify.criteria,
            accountAge: Date.now() - member.user.createdTimestamp
        });

        if (shouldSendAutoVerifyDm) {
            await sendAutoVerifyNotification(member, verifiedRole, guild);
        }

        return {
            autoVerified: true,
            userId: member.id,
            roleId: verifiedRole.id,
            roleName: verifiedRole.name,
            criteria: verificationConfig.autoVerify.criteria
        };

    } catch (error) {
        const typedError = ensureTypedServiceError(error, {
            service: 'verificationService',
            operation: 'autoVerifyOnJoin',
            type: ErrorTypes.UNKNOWN,
            message: 'Verification operation failed: autoVerifyOnJoin',
            userMessage: 'Automatisk verifisering feilet. Vennligst verifiser manuelt.',
            context: { guildId: guild.id, userId: member.id }
        });
        logger.error('Feil ved automatisk verifisering ved tilkobling', {
            guildId: guild.id,
            userId: member.id,
            error: typedError.message,
            errorCode: typedError.context?.errorCode
        });
        
        return {
            autoVerified: false,
            reason: 'auto_verify_error',
            error: typedError.userMessage || typedError.message,
            errorCode: typedError.context?.errorCode
        };
    }
}

export async function removeVerification(client, guildId, userId, options = {}) {
    const { moderatorId = null, reason = 'admin_removal' } = options;
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            throw createError(
                `Guild ${guildId} not found`,
                ErrorTypes.CONFIGURATION,
                "Serveren ble ikke funnet.",
                { guildId }
            );
        }

        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch (error) {
            throw createError(
                `Member ${userId} not found`,
                ErrorTypes.USER_INPUT,
                "Brukeren er ikke på denne serveren.",
                { userId }
            );
        }

        const guildConfig = await getGuildConfig(client, guildId);
        
        if (!guildConfig.verification?.enabled) {
            throw createError(
                "Verification system disabled",
                ErrorTypes.CONFIGURATION,
                "Verifiseringssystemet er ikke aktivert.",
                { guildId }
            );
        }

        const verifiedRole = guild.roles.cache.get(guildConfig.verification.roleId);
        if (!verifiedRole) {
            throw createError(
                "Verified role not found",
                ErrorTypes.CONFIGURATION,
                "Verifisert-rollen eksisterer ikke lenger.",
                { roleId: guildConfig.verification.roleId }
            );
        }

        const canAssignRole = await validateBotCanAssignRole(guild, verifiedRole.id);
        if (!canAssignRole) {
            throw createError(
                'Bot cannot manage verified role',
                ErrorTypes.PERMISSION,
                "Jeg kan ikke fjerne verifisert-rollen akkurat nå. Vennligst sjekk min **Administrer roller**-tillatelse og rollehierarkiet.",
                { guildId, roleId: verifiedRole.id }
            );
        }

        if (!member.roles.cache.has(verifiedRole.id)) {
            return {
                status: 'not_verified',
                userId,
            };
        }

        await member.roles.remove(
            verifiedRole.id, 
            `Verifisering fjernet av ${moderatorId || 'system'}: ${reason}`
        );

        logVerificationAction(client, guildId, userId, 'removed', {
            removedBy: moderatorId,
            reason,
            roleId: verifiedRole.id,
            roleName: verifiedRole.name
        });

        logger.info('Verifisering fjernet fra bruker', {
            guildId,
            userId,
            removedBy: moderatorId,
            reason
        });

        return {
            status: 'removed',
            userId,
            roleId: verifiedRole.id,
        };

    } catch (error) {
        const typedError = ensureTypedServiceError(error, {
            service: 'verificationService',
            operation: 'removeVerification',
            type: ErrorTypes.UNKNOWN,
            message: 'Verification operation failed: removeVerification',
            userMessage: 'Kunne ikke fjerne verifisering. Vennligst prøv igjen om et øyeblikk.',
            context: { guildId, userId, reason }
        });
        logger.error('Feil ved fjerning av verifisering', {
            guildId,
            userId,
            error: typedError.message,
            errorCode: typedError.context?.errorCode
        });
        throw typedError;
    }
}

export async function validateVerificationSetup(guild, verificationConfig) {
    const botMember = guild.members.me;
    if (!botMember) {
        throw createError(
            'Bot member not available in guild cache',
            ErrorTypes.CONFIGURATION,
            "Jeg kunne ikke verifisere tillatelsene mine på serveren. Vennligst prøv igjen.",
            { guildId: guild.id }
        );
    }

    const verifiedRole = guild.roles.cache.get(verificationConfig.roleId);
    if (!verifiedRole) {
        throw createError(
            "Verified role not found",
            ErrorTypes.CONFIGURATION,
            "Verifisert-rollen ble slettet. Vennligst kjør `/verification setup` på nytt.",
            { roleId: verificationConfig.roleId, guildId: guild.id }
        );
    }

    if (verificationConfig.channelId) {
        const channel = guild.channels.cache.get(verificationConfig.channelId);
        if (!channel) {
            throw createError(
                "Verification channel not found",
                ErrorTypes.CONFIGURATION,
                "Verifiseringskanalen ble slettet.",
                { channelId: verificationConfig.channelId, guildId: guild.id }
            );
        }

        const botPerms = channel.permissionsFor(botMember);
        const requiredPerms = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
        const missingPerms = requiredPerms.filter(perm => !botPerms.has(perm));

        if (missingPerms.length > 0) {
            throw createError(
                "Bot missing permissions in verification channel",
                ErrorTypes.PERMISSION,
                `Jeg mangler tillatelser i verifiseringskanalen: ${missingPerms.join(', ')}`,
                { missingPerms, channelId: channel.id }
            );
        }
    }

    return true;
}

export async function validateBotCanAssignRole(guild, roleId) {
    const role = guild.roles.cache.get(roleId);
    
    if (!role) {
        logger.warn('Kan ikke tildele rolle – rollen ble ikke funnet', {
            guildId: guild.id,
            roleId
        });
        return false;
    }

    const botMember = guild.members.me;
    if (!botMember) {
        logger.warn('Kan ikke tildele rolle – bot-medlem ble ikke funnet i server-cache', {
            guildId: guild.id,
            roleId
        });
        return false;
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        logger.warn('Kan ikke tildele rolle – mangler Administrer roller-tillatelse', {
            guildId: guild.id,
            roleId
        });
        return false;
    }

    const botHighest = botMember.roles.highest;
    if (role.position >= botHighest.position) {
        logger.warn('Kan ikke tildele rolle – problem med rollehierarki', {
            guildId: guild.id,
            roleId,
            rolePosition: role.position,
            botHighestPosition: botHighest.position
        });
        return false;
    }

    return true;
}

function evaluateAutoVerifyCriteria(member, autoVerifyConfig) {
    const { criteria, accountAgeDays } = autoVerifyConfig;

    switch (criteria) {
        case 'account_age': {
            const accountAge = Date.now() - member.user.createdTimestamp;
            const requiredAge = accountAgeDays * 24 * 60 * 60 * 1000;
            return accountAge >= requiredAge;
        }

        case 'server_size':
            return member.guild.memberCount < serverSizeThreshold;

        case 'none':
            return true;

        default:
            logger.warn('Ukjent kriterium for automatisk verifisering', { criteria });
            return false;
    }
}

export async function checkVerificationCooldown(userId, guildId, cooldownMs = defaultCooldownMs) {
    pruneVerificationTrackers();

    const key = `${guildId}:${userId}`;
    const lastVerified = verificationCooldowns.get(key);
    
    if (lastVerified && Date.now() - lastVerified < cooldownMs) {
        const remaining = cooldownMs - (Date.now() - lastVerified);
        throw createError(
            "User on verification cooldown",
            ErrorTypes.RATE_LIMIT,
            `Vennligst vent ${Math.ceil(remaining / 1000)} sekunder før du verifiserer på nytt.`,
            { userId, guildId, cooldownRemaining: remaining }
        );
    }
    
    verificationCooldowns.set(key, Date.now());
}

export async function trackVerificationAttempt(
    userId,
    guildId,
    maxAttempts = defaultMaxAttempts,
    windowMs = defaultAttemptWindowMs
) {
    pruneVerificationTrackers();

    const key = `${guildId}:${userId}`;
    const attempts = attemptTracker.get(key) || [];
    const now = Date.now();

    const recentAttempts = attempts.filter(timestamp => now - timestamp < windowMs);

    if (recentAttempts.length >= maxAttempts) {
        throw createError(
            "Too many verification attempts",
            ErrorTypes.RATE_LIMIT,
            "Du har prøvd for mange ganger. Vennligst vent et øyeblikk.",
            { attempts: recentAttempts.length, maxAttempts }
        );
    }

    recentAttempts.push(now);
    attemptTracker.set(key, recentAttempts);
}

async function sendAutoVerifyNotification(member, role, guild) {
    try {
        const { createEmbed } = await import('../utils/embeds.js');
        
        const embed = createEmbed({
            title: "🎉 Velkommen til serveren!",
            description: `Du har blitt automatisk verifisert i **${guild.name}**!`,
            fields: [
                {
                    name: "✅ Rolle tildelt",
                    value: `Du har nå fått rollen ${role}!`,
                    inline: false
                },
                {
                    name: "📖 Hva nå?",
                    value: "Du har nå tilgang til alle serverens kanaler og funksjoner. Velkommen!",
                    inline: false
                }
            ],
            color: 'success'
        });

        await member.send({ embeds: [embed] });
    } catch (error) {
        logger.debug('Kunne ikke sende melding på DM for automatisk verifisering', {
            userId: member.id,
            guildId: guild.id,
            reason: error.message
        });
    }
}

function logVerificationAction(client, guildId, userId, action, metadata = {}) {
    if (!shouldLogVerifications) {
        return;
    }

    const sanitizedMetadata = sanitizeAuditMetadata(metadata);

    logger.info('Verifiseringshandling', {
        guildId,
        userId,
        action,
        timestamp: new Date().toISOString(),
        metadata: sanitizedMetadata
    });

    if (!shouldKeepAuditTrail) {
        return;
    }

    const moderatorId = metadata.moderatorId || metadata.removedBy || null;
    const source = metadata.source || null;

    void insertVerificationAudit({
        guildId,
        userId,
        action,
        source,
        moderatorId,
        metadata: sanitizedMetadata,
        createdAt: new Date().toISOString()
    });
}

function sanitizeAuditMetadata(metadata = {}) {
    try {
        const payload = metadata && typeof metadata === 'object' ? metadata : { value: metadata };
        const json = JSON.stringify(payload);

        if (!json) {
            return {};
        }

        if (Buffer.byteLength(json, 'utf8') <= maxAuditMetadataBytes) {
            return payload;
        }

        return {
            truncated: true,
            originalBytes: Buffer.byteLength(json, 'utf8'),
            preview: json.slice(0, Math.max(0, maxAuditMetadataBytes - 32))
        };
    } catch {
        return {
            invalidMetadata: true,
            reason: 'Kunne ikke serialisere metadata'
        };
    }
}

export function validateAutoVerifyCriteria(criteria, accountAgeDays) {
    const validCriteria = ['account_age', 'server_size', 'none'];
    
    if (!validCriteria.includes(criteria)) {
        throw createError(
            `Invalid auto-verify criteria: ${criteria}`,
            ErrorTypes.VALIDATION,
            "Vennligst velg et gyldig kriteriealternativ.",
            { criteria, validCriteria }
        );
    }
    
    if (criteria === 'account_age') {
        if (!accountAgeDays || accountAgeDays < minAutoVerifyAccountAgeDays || accountAgeDays > maxAutoVerifyAccountAgeDays) {
            throw createError(
                "Invalid account age days",
                ErrorTypes.VALIDATION,
                `Kontoens alder må være mellom ${minAutoVerifyAccountAgeDays} og ${maxAutoVerifyAccountAgeDays} dager.`,
                { accountAgeDays, minAutoVerifyAccountAgeDays, maxAutoVerifyAccountAgeDays }
            );
        }
    }
    
    return { criteria, accountAgeDays };
}

export default {
    verifyUser,
    autoVerifyOnJoin,
    removeVerification,
    validateVerificationSetup,
    validateBotCanAssignRole,
    checkVerificationCooldown,
    trackVerificationAttempt,
    validateAutoVerifyCriteria
};