import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import {
  getCommandAccessSnapshot,
  disableCategory,
  enableCategory,
  disableCommand,
  enableCommand,
  resetCategoryCommands,
} from '../../../services/commandAccessService.js';
import { getGuildConfig } from '../../../services/config/guildConfig.js';

export const DASHBOARD_CATEGORY_SELECT = 'cmdaccess_category';
export const DASHBOARD_COMMAND_SELECT = 'cmdaccess_command';
export const DASHBOARD_TOGGLE_CATEGORY = 'cmdaccess_toggle_category';
export const DASHBOARD_ENABLE_ALL = 'cmdaccess_enable_all';
export const DASHBOARD_DISABLE_ALL = 'cmdaccess_disable_all';
export const DASHBOARD_RESET_COMMANDS = 'cmdaccess_reset_commands';
export const DASHBOARD_REFRESH = 'cmdaccess_refresh';
export const DASHBOARD_HOME = 'cmdaccess_home';

const STATUS = {
  enabled: '🟢',
  partial: '🟡',
  disabled: '🔴',
};

// Oversettelsestabell for kategorier i dashbordet
const CATEGORY_NAMES_NB = {
  Core: "Core",
  Moderation: "Moderering",
  Economy: "Økonomi",
  Music: "Musikk",
  Fun: "Moro",
  Leveling: "Leveling",
  Utility: "Hjelpeverktøy",
  Ticket: "Tickets",
  Welcome: "Velkomst",
  Giveaway: "Giveaway",
  Counter: "Teller",
  Tools: "Verktøy",
  Search: "Søk",
  Søk: "Søk",
  ReactionRoles: "Reaksjonsroller",
  "Reaction Roles": "Reaksjonsroller",
  Reactionroles: "Reaksjonsroller",
  Community: "Fellesskap",
  Birthday: "Bursdag",
  JoinToCreate: "TempVoice",
  "Join To Create": "TempVoice",
  Verification: "Verifisering",
  Logging: "Logging",
  ServerStats: "Serverstatistikk",
  "Server Stats": "Serverstatistikk",
};

function translateCategoryName(rawName) {
  if (!rawName) return rawName;
  const compactKey = rawName.replace(/\s+/g, '');
  return CATEGORY_NAMES_NB[rawName] || CATEGORY_NAMES_NB[compactKey] || rawName;
}

function customId(base, guildId, suffix = '') {
  return suffix ? `${base}:${guildId}:${suffix}` : `${base}:${guildId}`;
}

function getCategoryStatus(category) {
  if (category.categoryDisabled) {
    return STATUS.disabled;
  }
  if (category.disabledCount === 0) {
    return STATUS.enabled;
  }
  return STATUS.partial;
}

function formatCommandLabel(command) {
  if (command.isSubcommand) {
    return `\`${command.name.replace(/ /g, ' ')}\``;
  }
  return `\`${command.name}\``;
}

function chunkLines(lines, maxLength = 980) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export function buildOverviewEmbed(snapshot, guild) {
  const fullyEnabled = snapshot.categories.filter((c) => !c.categoryDisabled && c.disabledCount === 0).length;
  const partial = snapshot.categories.filter((c) => !c.categoryDisabled && c.disabledCount > 0).length;
  const disabled = snapshot.categories.filter((c) => c.categoryDisabled).length;

  const categoryLines = snapshot.categories.map((category) => {
    const icon = getCategoryStatus(category);
    const subcommandNote = category.commands.some((c) => c.isSubcommand) ? ' · inkl. underkommandoer' : '';
    const translatedName = translateCategoryName(category.displayName);
    return `${icon} ${category.icon} **${translatedName}** — ${category.enabledCount}/${category.totalCount}${subcommandNote}`;
  });

  const fields = [
    {
      name: '📊 Sammendrag',
      value: [
        `**${snapshot.enabledTotal}/${snapshot.totalCommands}** kommandoer aktivert`,
        `${STATUS.enabled} ${fullyEnabled} helt på · ${STATUS.partial} ${partial} delvis · ${STATUS.disabled} ${disabled} av`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '🔑 Forklaring',
      value: `${STATUS.enabled} Alle aktivert · ${STATUS.partial} Noen deaktivert · ${STATUS.disabled} Kategori av`,
      inline: false,
    },
  ];

  const chunks = chunkLines(categoryLines);
  chunks.forEach((chunk, index) => {
    fields.push({
      name: index === 0 ? '📁 Kategorier' : '📁 Kategorier (forts.)',
      value: chunk,
      inline: false,
    });
  });

  fields.push({
    name: 'Slik bruker du det',
    value: [
      '• Velg en kategori nedenfor for å administrere kommandoer og underkommandoer',
      '• `/commands deaktiver` — slå av en kategori eller en bestemt kommando',
      '• `/commands aktiver` — slå noe på igjen',
    ].join('\n'),
  });

  return createEmbed({
    title: '⚙️ Kommandotilgang',
    description: `Administrer skråstrek- og prefikskommandoer for **${guild.name}**. Underkommandoer (f.eks. \`bursdag liste\`) vises separat.`,
    color: 'info',
    fields,
    footer: '🔒 commands & configwizard forblir alltid tilgjengelige',
  });
}

export function buildCategoryEmbed(category, guild) {
  const statusIcon = getCategoryStatus(category);
  const statusText = category.categoryDisabled
    ? 'Kategori deaktivert'
    : category.disabledCount === 0
      ? 'Alle kommandoer aktivert'
      : `${category.disabledCount} av ${category.totalCount} deaktivert`;

  const commandLines = category.commands.map((command) => {
    const enabled = category.enabledCommands.includes(command.name);
    const icon = enabled ? STATUS.enabled : STATUS.disabled;
    const lock = command.protected ? ' 🔒' : '';
    return `${icon} ${formatCommandLabel(command)}${lock}`;
  });

  const fields = [
    {
      name: `${statusIcon} Status`,
      value: statusText,
      inline: true,
    },
    {
      name: '📈 Antall',
      value: `${category.enabledCount}/${category.totalCount} aktivert`,
      inline: true,
    },
  ];

  const chunks = chunkLines(commandLines);
  chunks.forEach((chunk, index) => {
    fields.push({
      name: index === 0 ? '📋 Kommandoer & Underkommandoer' : '📋 (forts.)',
      value: chunk,
      inline: false,
    });
  });

  fields.push({
    name: 'Slik bruker du det',
    value: [
      '• Bruk nedtrekksmenyen til å slå av/på individuelle kommandoer eller underkommandoer',
      '• **Deaktiver alle** slår av hele kategorien',
      '• **Fjern overstyringer** aktiverer individuelt deaktiverte kommandoer igjen',
    ].join('\n'),
  });

  const translatedName = translateCategoryName(category.displayName);

  return createEmbed({
    title: `${category.icon} ${translatedName}`,
    description: `Kommandotilgang for **${guild.name}**.`,
    color: category.categoryDisabled ? 'error' : category.disabledCount > 0 ? 'warning' : 'success',
    fields,
    footer: '🔒 Beskyttede kommandoer kan ikke deaktiveres',
  });
}

export function buildOverviewComponents(guildId, snapshot) {
  const categoryOptions = snapshot.categories.slice(0, 25).map((category) => {
    const status = getCategoryStatus(category);
    const translatedName = translateCategoryName(category.displayName);
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${translatedName}`.slice(0, 100))
      .setDescription(`${status} ${category.enabledCount}/${category.totalCount} aktivert`.slice(0, 100))
      .setValue(category.key)
      .setEmoji(category.icon);
  });

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId(DASHBOARD_CATEGORY_SELECT, guildId))
        .setPlaceholder('📁 Velg en kategori...')
        .addOptions(categoryOptions),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(DASHBOARD_REFRESH, guildId))
        .setLabel('Oppdater')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildCategoryComponents(guildId, category) {
  const toggleableCommands = category.commands.filter((command) => !command.protected);
  const commandOptions = toggleableCommands.slice(0, 25).map((command) => {
    const enabled = category.enabledCommands.includes(command.name);
    const label = command.isSubcommand
      ? command.name.replace(' ', ' · ').slice(0, 100)
      : command.name.slice(0, 100);

    return new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setDescription((enabled ? '🟢 Aktivert — klikk for å deaktivere' : '🔴 Deaktivert — klikk for å aktivere').slice(0, 100))
      .setValue(command.name);
  });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(DASHBOARD_HOME, guildId))
        .setLabel('Tilbake')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(customId(DASHBOARD_TOGGLE_CATEGORY, guildId, category.key))
        .setLabel(category.categoryDisabled ? 'Aktiver kategori' : 'Deaktiver kategori')
        .setEmoji(category.categoryDisabled ? '🟢' : '🔴')
        .setStyle(category.categoryDisabled ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(customId(DASHBOARD_ENABLE_ALL, guildId, category.key))
        .setLabel('Aktiver alle')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(customId(DASHBOARD_DISABLE_ALL, guildId, category.key))
        .setLabel('Deaktiver alle')
        .setEmoji('⛔')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(customId(DASHBOARD_RESET_COMMANDS, guildId, category.key))
        .setLabel('Fjern overstyringer')
        .setEmoji('🧹')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  if (commandOptions.length > 0) {
    rows.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId(DASHBOARD_COMMAND_SELECT, guildId, category.key))
          .setPlaceholder('Slå av/på en kommando eller underkommando...')
          .addOptions(commandOptions),
      ),
    );
  }

  return rows;
}

export async function buildDashboardView(client, guildId, guild, view = 'overview', categoryKey = null) {
  const config = await getGuildConfig(client, guildId);
  const snapshot = getCommandAccessSnapshot(client, config);

  if (view === 'category' && categoryKey) {
    const category = snapshot.categories.find((entry) => entry.key === categoryKey);
    if (!category) {
      return {
        embed: buildOverviewEmbed(snapshot, guild),
        components: buildOverviewComponents(guildId, snapshot),
      };
    }

    return {
      embed: buildCategoryEmbed(category, guild),
      components: buildCategoryComponents(guildId, category),
      categoryKey,
    };
  }

  return {
    embed: buildOverviewEmbed(snapshot, guild),
    components: buildOverviewComponents(guildId, snapshot),
  };
}

export async function handleDashboardComponent(interaction, client) {
  const parts = interaction.customId.split(':');
  const action = parts[0];
  const guildId = parts[1];
  const suffix = parts[2] || null;

  if (guildId !== interaction.guildId) {
    return interaction.reply({
      content: 'Dette dashbordet tilhører en annen server.',
      ephemeral: true,
    });
  }

  if (action === DASHBOARD_COMMAND_SELECT) {
    const categoryKey = suffix;
    const commandName = interaction.values[0];
    const config = await getGuildConfig(client, guildId);
    const snapshot = getCommandAccessSnapshot(client, config);
    const category = snapshot.categories.find((entry) => entry.key === categoryKey);
    const enabled = category?.enabledCommands.includes(commandName);

    if (enabled) {
      await disableCommand(client, guildId, commandName);
    } else {
      await enableCommand(client, guildId, commandName);
    }

    const view = await buildDashboardView(client, guildId, interaction.guild, 'category', categoryKey);
    return interaction.update({ embeds: [view.embed], components: view.components });
  }

  if (action === DASHBOARD_CATEGORY_SELECT) {
    const categoryKey = interaction.values[0];
    const view = await buildDashboardView(client, guildId, interaction.guild, 'category', categoryKey);
    return interaction.update({ embeds: [view.embed], components: view.components });
  }

  await interaction.deferUpdate();

  if (action === DASHBOARD_REFRESH || action === DASHBOARD_HOME) {
    const view = await buildDashboardView(client, guildId, interaction.guild, 'overview');
    return interaction.editReply({ embeds: [view.embed], components: view.components });
  }

  if (action === DASHBOARD_TOGGLE_CATEGORY) {
    const categoryKey = suffix;
    const config = await getGuildConfig(client, guildId);
    const snapshot = getCommandAccessSnapshot(client, config);
    const category = snapshot.categories.find((entry) => entry.key === categoryKey);

    if (category?.categoryDisabled) {
      await enableCategory(client, guildId, categoryKey);
    } else {
      await disableCategory(client, guildId, categoryKey);
    }

    const view = await buildDashboardView(client, guildId, interaction.guild, 'category', categoryKey);
    return interaction.editReply({ embeds: [view.embed], components: view.components });
  }

  if (action === DASHBOARD_ENABLE_ALL) {
    await enableCategory(client, guildId, suffix);
    await resetCategoryCommands(client, guildId, suffix);
    const view = await buildDashboardView(client, guildId, interaction.guild, 'category', suffix);
    return interaction.editReply({ embeds: [view.embed], components: view.components });
  }

  if (action === DASHBOARD_DISABLE_ALL) {
    await disableCategory(client, guildId, suffix);
    const view = await buildDashboardView(client, guildId, interaction.guild, 'category', suffix);
    return interaction.editReply({ embeds: [view.embed], components: view.components });
  }

  if (action === DASHBOARD_RESET_COMMANDS) {
    await enableCategory(client, guildId, suffix);
    await resetCategoryCommands(client, guildId, suffix);
    const view = await buildDashboardView(client, guildId, interaction.guild, 'category', suffix);
    return interaction.editReply({ embeds: [view.embed], components: view.components });
  }

  return interaction.editReply({ content: 'Ukjent dashbord-handling.', embeds: [], components: [] });
}

export function isCommandAccessCustomId(customIdValue) {
  return customIdValue.startsWith('cmdaccess_');
}

export function createDashboardCollectorFilter(userId, guildId) {
  return (componentInteraction) =>
    componentInteraction.user.id === userId &&
    componentInteraction.customId.includes(`:${guildId}`);
}