import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getLevelingConfig, saveLevelingConfig } from '../../services/leveling/leveling.js';
import { botHasPermission } from '../../utils/permissionGuard.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import levelDashboard from './modules/level_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('Administrer levlingssystemet')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('setup')
                .setDescription('Sett opp levlingssystemet — dette aktiverer det også')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Kanal for å sende level-up varsler i')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_min')
                        .setDescription('Minimum XP gitt per melding (standard: 15)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_max')
                        .setDescription('Maksimum XP gitt per melding (standard: 25)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName('message')
                        .setDescription(
                            'Level-up melding. Bruk {user} og {level} som plassholdere (standard er angitt)',
                        )
                        .setMaxLength(500)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_cooldown')
                        .setDescription('Sekunder mellom XP gis per bruker (standard: 60)')
                        .setMinValue(0)
                        .setMaxValue(3600)
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription('Åpne det interaktive konfigurasjons-dashboardet for levling'),
        ),
    category: 'Leveling',

    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral,
        });
        if (!deferred) return;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger tillatelsen **Administrer server** for å bruke denne kommandoen.' });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'dashboard') {
            return levelDashboard.execute(interaction, config, client);
        }

        if (subcommand === 'setup') {
            const channel = interaction.options.getChannel('channel');
            const xpMin = interaction.options.getInteger('xp_min') ?? 15;
            const xpMax = interaction.options.getInteger('xp_max') ?? 25;
            const message =
                interaction.options.getString('message') ??
                '{user} har gått opp til level {level}!';
            const xpCooldown = interaction.options.getInteger('xp_cooldown') ?? 60;

            if (xpMin > xpMax) {
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `Minimum XP (**${xpMin}**) kan ikke være større enn maksimum XP (**${xpMax}**).` });
            }

            if (!botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
                throw new TitanBotError(
                    'Bot missing permissions in the specified channel',
                    ErrorTypes.PERMISSION,
                    `Jeg trenger tillatelsene **SendMessages** og **EmbedLinks** i ${channel} for å sende level-up varsler.`,
                );
            }

            const existingConfig = await getLevelingConfig(client, interaction.guildId);

            if (existingConfig.configured) {
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Levlingssystemet er allerede satt opp på denne serveren (level-up varsler går til <#${existingConfig.levelUpChannel}>).\n\nBruk \`/level dashboard\` for å justere innstillingene.` });
            }

            const newConfig = {
                ...existingConfig,
                configured: true,
                enabled: true,
                levelUpChannel: channel.id,
                xpRange: { min: xpMin, max: xpMax },
                xpCooldown: xpCooldown,
                levelUpMessage: message,
                announceLevelUp: true,
            };

            await saveLevelingConfig(client, interaction.guildId, newConfig);

            logger.info(`Leveling system set up in guild ${interaction.guildId}`, {
                channelId: channel.id,
                xpMin,
                xpMax,
                xpCooldown,
                userId: interaction.user.id,
            });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: 'Levlingssystem satt opp',
                        description:
                            `Levlingssystemet er nå **aktivert** og klart til bruk.\n\n` +
                            `**Level-up kanal:** ${channel}\n` +
                            `**XP per melding:** ${xpMin} – ${xpMax}\n` +
                            `**XP-nedkjøling:** ${xpCooldown}s\n` +
                            `**Level-up melding:** \`${message}\`\n\n` +
                            `Bruk \`/level dashboard\` for å justere disse innstillingene når som helst.`,
                        color: 'success',
                    }),
                ],
            });
        }
    },
};