import { EmbedBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { getGuildConfig } from '../../../services/config/guildConfig.js';
import { getLoggingStatus } from '../../../services/loggingService.js';
import {
  createLoggingDashboardComponents,
  createLoggingCategoryViewComponents,
  createLoggingFilterComponents,
  DASHBOARD_CATEGORIES,
  DASHBOARD_CATEGORY_LABELS,
  EVENT_TYPES_BY_CATEGORY,
} from '../../../utils/logging/loggingUi.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

export function getCategoryStatus(enabledEvents, category, auditEnabled) {
  if (!auditEnabled) return false;
  const events = enabledEvents || {};
  if (events[`${category}.*`] === false) return false;
  const categoryEvents = EVENT_TYPES_BY_CATEGORY[category] || [];
  if (categoryEvents.length === 0) return true;
  return categoryEvents.every((eventType) => events[eventType] !== false);
}

async function formatChannelMention(guild, id) {
  if (!id) return '`Ikke konfigurert`';
  const channel = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
  return channel ? channel.toString() : `⚠️ Mangler (${id})`;
}

function countEnabledCategories(enabledEvents, auditEnabled) {
  const enabled = DASHBOARD_CATEGORIES.filter((key) =>
    getCategoryStatus(enabledEvents, key, auditEnabled),
  ).length;
  return { enabled, total: DASHBOARD_CATEGORIES.length };
}

export async function buildLoggingDashboardView(interaction, client) {
  const guildConfig = await getGuildConfig(client, interaction.guildId);
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);

  const auditEnabled = Boolean(loggingStatus.enabled);
  const channels = loggingStatus.channels || {};

  const auditChannel = await formatChannelMention(interaction.guild, channels.audit);
  const applicationsChannel = await formatChannelMention(interaction.guild, channels.applications);
  const reportsChannel = await formatChannelMention(interaction.guild, channels.reports);
  const lifecycleChannel = await formatChannelMention(interaction.guild, guildConfig.ticketLogsChannelId);
  const transcriptChannel = await formatChannelMention(interaction.guild, guildConfig.ticketTranscriptChannelId);

  const ignore = loggingStatus.ignore || { users: [], channels: [] };
  const { enabled: enabledCount, total } = countEnabledCategories(loggingStatus.enabledEvents, auditEnabled);

  const embed = new EmbedBuilder()
    .setTitle('📝 Kontrollpanel for logging')
    .setDescription(`Administrer serverlogging for **${interaction.guild.name}**. Bruk menyen under for å konfigurere kanaler, kategorier og filtre.`)
    .setColor(auditEnabled ? getColor('success') : getColor('warning'))
    .addFields(
      {
        name: 'Loggstatus',
        value: auditEnabled ? '✅ Aktivert' : '❌ Deaktivert',
        inline: true,
      },
      {
        name: 'Handlingskategorier',
        value: auditEnabled ? `${enabledCount}/${total} aktivert` : '`Logging deaktivert`',
        inline: true,
      },
      {
        name: 'Ignoreringsfiltre',
        value: `${ignore.users?.length || 0} brukere · ${ignore.channels?.length || 0} kanaler`,
        inline: true,
      },
      {
        name: 'Loggkanaler',
        value: [
          `**Revisjon (Audit):** ${auditChannel}`,
          `**Søknader:** ${applicationsChannel}`,
          `**Rapporter:** ${reportsChannel}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Ticket-kanaler (skrivebeskyttet)',
        value: [
          `**Ticket-logger:** ${lifecycleChannel}`,
          `**Transkripsjoner:** ${transcriptChannel}`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Ticket-kanaler: konfigurer via /ticket dashboard' })
    .setTimestamp();

  const components = createLoggingDashboardComponents(loggingStatus.enabledEvents, auditEnabled);
  return { embed, components };
}

export async function buildLoggingCategoriesView(interaction, client) {
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);
  const auditEnabled = Boolean(loggingStatus.enabled);

  const categoryLines = DASHBOARD_CATEGORIES.map((key) => {
    const on = getCategoryStatus(loggingStatus.enabledEvents, key, auditEnabled);
    const label = DASHBOARD_CATEGORY_LABELS[key] || key;
    return `${on ? '✅' : '❌'} ${label}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📋 Handlingskategorier')
    .setDescription(
      auditEnabled
        ? 'Velg hvilke typer handlinger som skal logges til revisjonskanalen.'
        : '⚠️ Logging er deaktivert. Aktiver det fra hovedpanelet for å sende logger.',
    )
    .setColor(getColor('info'))
    .addFields({ name: 'Kategoristatus', value: categoryLines, inline: false })
    .setFooter({ text: 'Grønn = logging på · Rød = logging av' })
    .setTimestamp();

  const components = createLoggingCategoryViewComponents(loggingStatus.enabledEvents, auditEnabled);
  return { embed, components };
}

export async function buildLoggingFilterView(interaction, client) {
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);
  const ignore = loggingStatus.ignore || { users: [], channels: [] };

  const userLines = (ignore.users || []).length
    ? ignore.users.map((id) => `• Bruker \`${id}\``).join('\n')
    : '*Ingen ignorerte brukere*';

  const channelLines = (ignore.channels || []).length
    ? ignore.channels.map((id) => `• Kanal \`${id}\``).join('\n')
    : '*Ingen ignorerte kanaler*';

  const embed = new EmbedBuilder()
    .setTitle('🔇 Logg-ignoreringsfiltre')
    .setDescription('Brukere og kanaler på denne listen vil bli hoppet over når revisjonslogger sendes.')
    .setColor(getColor('info'))
    .addFields(
      { name: 'Ignorerte brukere', value: userLines.slice(0, 1024), inline: false },
      { name: 'Ignorerte kanaler', value: channelLines.slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'Bruk knappene under for å legge til eller fjerne filtre' })
    .setTimestamp();

  const components = createLoggingFilterComponents();
  return { embed, components };
}

export function isCategoriesView(interaction) {
  return interaction.message?.embeds?.[0]?.title === '📋 Handlingskategorier';
}

export function isFilterView(interaction) {
  return interaction.message?.embeds?.[0]?.title === '🔇 Logg-ignoreringsfiltre';
}

export async function refreshDashboardMessage(interaction, client) {
  let view;
  if (isCategoriesView(interaction)) {
    view = await buildLoggingCategoriesView(interaction, client);
  } else if (isFilterView(interaction)) {
    view = await buildLoggingFilterView(interaction, client);
  } else {
    view = await buildLoggingDashboardView(interaction, client);
  }

  await interaction.message.edit({
    embeds: [view.embed],
    components: view.components,
    content: null,
  }).catch(() => {});
}

export default {
  prefixOnly: false,
  async execute(interaction, config, client) {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger tillatelsen **Administrer server** for å se kontrollpanelet for logging.' });
      }

      await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      const { embed, components } = await buildLoggingDashboardView(interaction, client);
      await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components });
    } catch (error) {
      logger.error('logging_dashboard error:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Klarte ikke å laste inn kontrollpanelet for logging.' });
    }
  },
};