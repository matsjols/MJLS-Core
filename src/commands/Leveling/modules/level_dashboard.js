import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    LabelBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { getLevelingConfig, saveLevelingConfig } from '../../../services/leveling/leveling.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';
import { startDashboardSession } from '../../../utils/dashboardSession.js';

function buildDashboardEmbed(cfg, guild) {
    const channel = cfg.levelUpChannel ? `<#${cfg.levelUpChannel}>` : '`Ikke angitt`';
    const xpMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 15;
    const xpMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 25;
    const cooldown = cfg.xpCooldown ?? 60;
    const rawMsg = cfg.levelUpMessage || '{user} har gått opp til level {level}!';
    const msgPreview = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;

    const rewards = cfg.roleRewards ?? {};
    const rewardEntries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));
    const rewardsValue = rewardEntries.length > 0
        ? rewardEntries.map(([lvl, roleId]) => `Level **${lvl}** → <@&${roleId}>`).join('\n')
        : '`Ingen konfigurert`';

    const ignoredChannels = cfg.ignoredChannels ?? [];
    const ignoredRoles = cfg.ignoredRoles ?? [];
    const ignoredChValue = ignoredChannels.length > 0 ? ignoredChannels.map(id => `<#${id}>`).join(',') : '`Ingen`';
    const ignoredRoValue = ignoredRoles.length > 0 ? ignoredRoles.map(id => `<@&${id}>`).join(',') : '`Ingen`';

    return new EmbedBuilder()
        .setTitle('⚡ Dashboard for levlingssystem')
        .setDescription(`Administrer levlingsinnstillinger for **${guild.name}**.\nVelg et alternativ nedenfor for å endre en innstilling.`)
        .setColor(getColor('info'))
        .addFields(
            { name: 'Level-up kanal', value: channel, inline: true },
            { name: 'Systemstatus', value: cfg.enabled ? '**Aktivert**' : '**Deaktivert**', inline: true },
            { name: 'Kunngjøringer', value: cfg.announceLevelUp !== false ? '**Aktivert**' : '**Deaktivert**', inline: true },
            { name: 'XP per melding', value: `\`${xpMin} – ${xpMax}\``, inline: true },
            { name: 'XP-nedkjøling', value: `\`${cooldown}s\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Level-up melding', value: msgPreview, inline: false },
            { name: 'Rollebelønninger', value: rewardsValue, inline: false },
            { name: 'Ignorerte kanaler', value: ignoredChValue, inline: true },
            { name: 'Ignorerte roller', value: ignoredRoValue, inline: true },
        )
        .setFooter({ text: 'Dashboardet lukkes etter 10 minutter med inaktivitet' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`level_cfg_${guildId}`)
        .setPlaceholder('Velg en innstilling å konfigurere...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Endre level-up kanal')
                .setDescription('Angi kanalen hvor level-up varsler sendes')
                .setValue('channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Rediger level-up melding')
                .setDescription('Tilpass meldingen som vises når en bruker går opp i level')
                .setValue('message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Angi XP-rekkevidde')
                .setDescription('Angi minimum og maksimum XP gitt per melding')
                .setValue('xp_range')
                .setEmoji('🎲'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Angi XP-nedkjøling')
                .setDescription('Sekunder mellom hver gang XP gis til samme bruker')
                .setValue('xp_cooldown')
                .setEmoji('⏱️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Legg til rollebelønning')
                .setDescription('Gi en rolle når en bruker når et bestemt level')
                .setValue('role_reward_add')
                .setEmoji('🏆'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Fjern rollebelønning')
                .setDescription('Fjern en rollebelønning fra et bestemt level')
                .setValue('role_reward_remove')
                .setEmoji('\ud83d\uddd1\ufe0f'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Ignorerte kanaler')
                .setDescription('Slå av/på kanaler der XP ikke vil bli gitt')
                .setValue('ignore_channels')
                .setEmoji('\ud83d\udeab'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Ignorerte roller')
                .setDescription('Slå av/på roller som ikke vil motta XP')
                .setValue('ignore_roles')
                .setEmoji('\ud83d\udeab'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const announceOn = cfg.announceLevelUp !== false;
    const systemOn = cfg.enabled !== false;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`level_cfg_toggle_announce_${guildId}`)
            .setLabel('Kunngjøringer')
            .setStyle(announceOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('📣')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`level_cfg_toggle_system_${guildId}`)
            .setLabel('Levling')
            .setStyle(systemOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('⚡')
            .setDisabled(disabled),
    );
}

async function refreshDashboard(rootInteraction, cfg, guildId) {
    const selectMenu = buildSelectMenu(guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(cfg, rootInteraction.guild)],
        components: [
            buildButtonRow(cfg, guildId),
            new ActionRowBuilder().addComponents(selectMenu),
        ],
    }).catch(() => {});
}

export default {
    prefixOnly: false,
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const cfg = await getLevelingConfig(client, guildId);

            if (!cfg.configured) {
                throw new TitanBotError(
                    'Leveling system not configured',
                    ErrorTypes.CONFIGURATION,
                    'Levlingssystemet har ikke blitt satt opp enda. Kjør `/level setup` først for å konfigurere det.',
                );
            }

            await startDashboardSession({
                interaction,
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: [
                    buildButtonRow(cfg, guildId),
                    new ActionRowBuilder().addComponents(buildSelectMenu(guildId)),
                ],
                selectMenuId: `level_cfg_${guildId}`,
                buttonMatcher: (customId) =>
                    customId === `level_cfg_toggle_announce_${guildId}` ||
                    customId === `level_cfg_toggle_system_${guildId}`,
                onSelect: async (selectInteraction) => {
                    const selectedOption = selectInteraction.values[0];
                    switch (selectedOption) {
                        case 'channel':
                            await handleChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'message':
                            await handleMessage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'xp_range':
                            await handleXpRange(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'xp_cooldown':
                            await handleXpCooldown(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'role_reward_add':
                            await handleRoleRewardAdd(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'role_reward_remove':
                            await handleRoleRewardRemove(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'ignore_channels':
                            await handleIgnoreChannels(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'ignore_roles':
                            await handleIgnoreRoles(selectInteraction, interaction, cfg, guildId, client);
                            break;
                    }
                },
                onButton: async (btnInteraction) => {
                    await btnInteraction.deferUpdate().catch(() => null);
                    const isAnnounce = btnInteraction.customId === `level_cfg_toggle_announce_${guildId}`;

                    if (isAnnounce) {
                        cfg.announceLevelUp = cfg.announceLevelUp === false;
                        await saveLevelingConfig(client, guildId, cfg);
                        await btnInteraction.followUp({
                            embeds: [
                                successEmbed(
                                    '✅ Kunngjøringer oppdatert',
                                    `Level-up kunngjøringer er nå **${cfg.announceLevelUp ? 'aktivert' : 'deaktivert'}**.`,
                                ),
                            ],
                            flags: MessageFlags.Ephemeral,
                        });
                    } else {
                        const wasEnabled = cfg.enabled !== false;
                        cfg.enabled = !wasEnabled;
                        await saveLevelingConfig(client, guildId, cfg);
                        await btnInteraction.followUp({
                            embeds: [
                                successEmbed(
                                    '✅ System oppdatert',
                                    `Levlingssystemet er nå **${cfg.enabled ? 'aktivert' : 'deaktivert'}**.${!cfg.enabled ? '\nBrukere vil ikke tjene XP før systemet er aktivert igjen.' : ''}`,
                                ),
                            ],
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await refreshDashboard(interaction, cfg, guildId);
                },
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in level_dashboard:', error);
            throw new TitanBotError(
                `Level dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Klarte ikke å åpne levlings-dashboardet.',
            );
        }
    },
};

async function handleRoleRewardAdd(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_role_reward_add_${guildId}`)
        .setTitle('🏆 Legg til rollebelønning');

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('reward_role')
        .setPlaceholder('Velg en rolle å gi...')
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);

    const roleLabel = new LabelBuilder()
        .setLabel('Rolle som skal gis')
        .setDescription('Denne rollen vil bli gitt når brukeren når dette levelet')
        .setRoleSelectMenuComponent(roleSelect);

    const levelInput = new TextInputBuilder()
        .setCustomId('reward_level')
        .setLabel('Level kreves (1–500)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('10')
        .setMaxLength(3)
        .setMinLength(1)
        .setRequired(true);

    modal.addLabelComponents(roleLabel);
    modal.addComponents(new ActionRowBuilder().addComponents(levelInput));

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_role_reward_add_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawLevel = submitted.fields.getTextInputValue('reward_level').trim();
    const level = parseInt(rawLevel, 10);

    if (isNaN(level) || level < 1 || level > 500) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Level må være et heltall mellom **1** og **500**.' });
        return;
    }

    const roleId = submitted.fields.getField('reward_role').values[0];

    cfg.roleRewards = cfg.roleRewards ?? {};
    cfg.roleRewards[level] = roleId;
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('Rollebelønning lagt til', `<@&${roleId}> vil nå bli gitt på level **${level}**.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleRoleRewardRemove(selectInteraction, rootInteraction, cfg, guildId, client) {
    const rewards = cfg.roleRewards ?? {};
    const entries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));

    if (entries.length === 0) {
        await selectInteraction.deferUpdate();
        await replyUserError(selectInteraction, {
            type: ErrorTypes.USER_INPUT,
            message: 'Det er ingen rollebelønninger konfigurert som kan fjernes.',
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_role_reward_remove_${guildId}`)
        .setTitle('🗑️ Fjern rollebelønning');

    const infoInput = new TextInputBuilder()
        .setCustomId('current_rewards')
        .setLabel('Nåværende belønninger (skrivebeskyttet)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(entries.map(([lvl, roleId]) => `Level ${lvl}: <@&${roleId}>`).join('\n'))
        .setRequired(false);

    const levelInput = new TextInputBuilder()
        .setCustomId('remove_level')
        .setLabel('Level å fjerne belønning fra')
        .setStyle(TextInputStyle.Short)
        .setValue(entries[0][0])
        .setMaxLength(3)
        .setMinLength(1)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(infoInput),
        new ActionRowBuilder().addComponents(levelInput),
    );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_role_reward_remove_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawLevel = submitted.fields.getTextInputValue('remove_level').trim();
    const level = parseInt(rawLevel, 10);

    if (isNaN(level) || !cfg.roleRewards?.[level]) {
        await replyUserError(submitted, { type: ErrorTypes.USER_INPUT, message: `Ingen rollebelønning er konfigurert for level **${rawLevel}**.` });
        return;
    }

    delete cfg.roleRewards[level];
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('Rollebelønning fjernet', `Rollebelønningen for level **${level}** har blitt fjernet.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_channel_modal_${guildId}`)
        .setTitle('\ud83d\udce2 Endre level-up kanal');

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('levelup_channel')
        .setPlaceholder('Velg en tekstkanal...')
        .setMinValues(1)
        .setMaxValues(1)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true);

    const channelLabel = new LabelBuilder()
        .setLabel('Level-up kanal')
        .setDescription('Kanal hvor level-up varsler vil bli sendt')
        .setChannelSelectMenuComponent(channelSelect);

    modal.addLabelComponents(channelLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_channel_modal_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const channelId = submitted.fields.getField('levelup_channel').values[0];
    const channel = selectInteraction.guild.channels.cache.get(channelId);

    if (channel && !botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
        await replyUserError(submitted, { type: ErrorTypes.PERMISSION, message: `Jeg trenger **SendMessages** og **EmbedLinks** tillatelser i ${channel} for å sende level-up varsler.` });
        return;
    }

    cfg.levelUpChannel = channelId;
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('\u2705 Kanal oppdatert', `Level-up varsler vil nå bli sendt i ${channel ??`<#${channelId}>`}.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleIgnoreChannels(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_ignore_channels_${guildId}`)
        .setTitle('\ud83d\udeab Ignorerte kanaler');

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ignore_channel')
        .setPlaceholder('Velg kanaler å slå av/på...')
        .setMinValues(1)
        .setMaxValues(10)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true);

    const channelLabel = new LabelBuilder()
        .setLabel('Slå av/på ignorerte kanaler')
        .setDescription('Valgte kanaler vil bli slått av/på — XP vil ikke bli gitt i disse')
        .setChannelSelectMenuComponent(channelSelect);

    modal.addLabelComponents(channelLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_ignore_channels_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const selectedIds = submitted.fields.getField('ignore_channel').values;
    const ignoreSet = new Set(cfg.ignoredChannels ?? []);

    for (const id of selectedIds) {
        if (ignoreSet.has(id)) {
            ignoreSet.delete(id);
        } else {
            ignoreSet.add(id);
        }
    }

    cfg.ignoredChannels = Array.from(ignoreSet);
    await saveLevelingConfig(client, guildId, cfg);

    const list = cfg.ignoredChannels.length > 0
        ? cfg.ignoredChannels.map(id => `<#${id}>`).join(',')
        : '`Ingen`';

    await submitted.reply({
        embeds: [successEmbed('\u2705 Ignorerte kanaler oppdatert', `XP vil ikke bli gitt i: ${list}`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleIgnoreRoles(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_ignore_roles_${guildId}`)
        .setTitle('\ud83d\udeab Ignorerte roller');

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('ignore_role')
        .setPlaceholder('Velg roller å slå av/på...')
        .setMinValues(1)
        .setMaxValues(10)
        .setRequired(true);

    const roleLabel = new LabelBuilder()
        .setLabel('Slå av/på ignorerte roller')
        .setDescription('Valgte roller vil bli slått av/på — medlemmer med disse vil ikke tjene XP')
        .setRoleSelectMenuComponent(roleSelect);

    modal.addLabelComponents(roleLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_ignore_roles_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const selectedIds = submitted.fields.getField('ignore_role').values;
    const ignoreSet = new Set(cfg.ignoredRoles ?? []);

    for (const id of selectedIds) {
        if (ignoreSet.has(id)) {
            ignoreSet.delete(id);
        } else {
            ignoreSet.add(id);
        }
    }

    cfg.ignoredRoles = Array.from(ignoreSet);
    await saveLevelingConfig(client, guildId, cfg);

    const list = cfg.ignoredRoles.length > 0
        ? cfg.ignoredRoles.map(id => `<@&${id}>`).join(',')
        : '`Ingen`';

    await submitted.reply({
        embeds: [successEmbed('\u2705 Ignorerte roller oppdatert', `Disse rollene vil ikke tjene XP: ${list}`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('level_cfg_message')
        .setTitle('💬 Rediger level-up melding')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message_input')
                    .setLabel('Melding ({user} og {level} er tilgjengelig)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.levelUpMessage || '{user} har gått opp til level {level}!')
                    .setMaxLength(500)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('{user} har gått opp til level {level}!'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'level_cfg_message' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newMessage = submitted.fields.getTextInputValue('message_input').trim();

    if (!newMessage.includes('{user}') && !newMessage.includes('{level}')) {
        logger.warn(
            `Level-up message set without {user} or {level} placeholders in guild ${guildId}`,
        );
    }

    cfg.levelUpMessage = newMessage;
    await saveLevelingConfig(client, guildId, cfg);

    const preview = newMessage.replace('{user}', '@User').replace('{level}', '5');

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Melding oppdatert',
                `Level-up melding lagret.\n**Forhåndsvisning:** ${preview}`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleXpRange(selectInteraction, rootInteraction, cfg, guildId, client) {
    const currentMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 15;
    const currentMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 25;

    const modal = new ModalBuilder()
        .setCustomId('level_cfg_xp_range')
        .setTitle('Angi XP-rekkevidde per melding')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('xp_min_input')
                    .setLabel('Minimum XP (1–500)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(currentMin))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('15'),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('xp_max_input')
                    .setLabel('Maksimum XP (1–500)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(currentMax))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('25'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'level_cfg_xp_range' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawMin = submitted.fields.getTextInputValue('xp_min_input').trim();
    const rawMax = submitted.fields.getTextInputValue('xp_max_input').trim();
    const newMin = parseInt(rawMin, 10);
    const newMax = parseInt(rawMax, 10);

    if (isNaN(newMin) || isNaN(newMax) || newMin < 1 || newMax < 1 || newMin > 500 || newMax > 500) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Begge XP-verdier må være heltall mellom **1** og **500**.' });
        return;
    }

    if (newMin > newMax) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Minimum XP kan ikke være større enn maksimum XP.' });
        return;
    }

    cfg.xpRange = { min: newMin, max: newMax };
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ XP-rekkevidde oppdatert',
                `Brukere vil nå tjene mellom **${newMin}** og **${newMax}** XP per melding.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleXpCooldown(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('level_cfg_cooldown')
        .setTitle('⏱️ Angi XP-nedkjøling')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cooldown_input')
                    .setLabel('Nedkjøling i sekunder (0–3600)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.xpCooldown ?? 60))
                    .setMaxLength(4)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('60'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'level_cfg_cooldown' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const raw = submitted.fields.getTextInputValue('cooldown_input').trim();
    const newCooldown = parseInt(raw, 10);

    if (isNaN(newCooldown) || newCooldown < 0 || newCooldown > 3600) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Nedkjøling må være et heltall mellom **0** og **3600** sekunder.' });
        return;
    }

    cfg.xpCooldown = newCooldown;
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Nedkjøling oppdatert',
                `XP-nedkjøling satt til **${newCooldown} sekund${newCooldown !== 1 ? 'er' : ''}**.${newCooldown === 0 ? '\n> ⚠️ En nedkjøling på 0 betyr at XP gis på hver eneste melding.' : ''}`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}