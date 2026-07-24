import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
  getCountingGameConfig,
  activateCountingGame,
  disableCountingGame,
  resetCountingGame,
  buildCountingLeaderboard,
  getCountingSystemChoices,
  getCountingSystemLabel,
  getExpectedCountValue,
} from '../../services/countingGameService.js';
import { logger } from '../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('telleleken')
    .setDescription('Administrer telleleken for serveren')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sett-opp')
        .setDescription('Start en tellelek i en tekstkanal')
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanalen hvor tellingen skal foregå')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((option) =>
          option
            .setName('system')
            .setDescription('Tellesystemet som skal brukes')
            .setRequired(true)
            .addChoices(...getCountingSystemChoices()),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('deaktiver').setDescription('Deaktiver telleleken for denne serveren'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Vis nåværende status for telleleken'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset')
        .setDescription('Tilbakestill den nåværende tellesekvensen')
        .addIntegerOption((option) =>
          option
            .setName('start')
            .setDescription('Tallet som skal startes på etter tilbakestilling')
            .setMinValue(1),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('toppliste').setDescription('Vis ledertavlen for telleleken'),
    ),
  category: 'Fun',

  async execute(interaction) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) {
        logger.warn('Count command defer failed', { userId: interaction.user.id, guildId: interaction.guildId });
        return;
      }

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger tillatelsen **Administrer server** for å bruke denne kommandoen.' });
      }

      const guildId = interaction.guildId;
      const subcommand = interaction.options.getSubcommand();
      const config = await getCountingGameConfig(interaction.client, guildId);

      if (subcommand === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const system = interaction.options.getString('system');
        if (!channel || channel.type !== ChannelType.GuildText) {
          return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Vennligst velg en tekstkanal for telleleken.' });
        }

        if (config.enabled && config.channelId && config.channelId !== channel.id) {
          return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Denne serveren har allerede en aktiv tellekanal konfigurert: <#${config.channelId}>. Deaktiver den nåværende telleleken først, eller bruk den eksisterende kanalen.` });
        }

        await activateCountingGame(interaction.client, guildId, channel.id, system);
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              'Telleleken er igang',
              `Telleleken er nå aktiv i ${channel} med systemet **${getCountingSystemLabel(system)}**. Spillere må telle oppover fra **1** og kan ikke skrive to tall på rad.`,
            ),
          ],
        });
      }

      if (subcommand === 'disable') {
        if (!config.enabled) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [infoEmbed('Tellelek deaktivert', 'Telleleken er allerede deaktivert for denne serveren.')],
          });
        }

        await disableCountingGame(interaction.client, guildId);
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [successEmbed('Tellelek deaktivert', 'Telleleken har blitt deaktivert.')],
        });
      }

      if (subcommand === 'status') {
        const fields = [
          { name: 'Aktivert', value: config.enabled ? 'Ja' : 'Nei', inline: true },
          { name: 'Kanal', value: config.channelId ? `<#${config.channelId}>` : 'Ikke konfigurert', inline: true },
          { name: 'System', value: getCountingSystemLabel(config.system), inline: true },
          { name: 'Neste tall', value: getExpectedCountValue(config), inline: true },
          { name: 'Nåværende rekke', value: `${config.currentStreak}`, inline: true },
          { name: 'Beste rekke', value: `${config.bestStreak || 0}`, inline: true },
          { name: 'Siste teller', value: config.lastUserId ? `<@${config.lastUserId}>` : 'Ingen', inline: true },
        ];

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            createEmbed({
              title: 'Status for tellelek',
              description: 'Oversikt over den nåværende konfigurerte telleleken.',
              fields,
              color: 'primary',
            }),
          ],
        });
      }

      if (subcommand === 'reset') {
        if (!config.enabled) {
          return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Aktiver telleleken først med `/count setup`.' });
        }

        const startNumber = interaction.options.getInteger('start') || 1;
        await resetCountingGame(interaction.client, guildId, startNumber);

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              'Tellelek tilbakestilt',
              `Tellesekvensen har blitt tilbakestilt. Start igjen med **${startNumber}** i <#${config.channelId}>.`,
            ),
          ],
        });
      }

      if (subcommand === 'leaderboard') {
        const leaderboard = buildCountingLeaderboard(config, interaction.guild);

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            createEmbed({
              title: 'Ledertavle for tellelek',
              description: leaderboard.length > 0 ? leaderboard.join('\n') : 'Ingen tall har blitt registrert ennå.',
              color: 'primary',
            }),
          ],
        });
      }

      return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Vennligst velg en gyldig handling for telleleken.' });
    } catch (error) {
      logger.error('Count command error:', error);
      return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Noe gikk galt under administrering av telleleken.' });
    }
  },
};