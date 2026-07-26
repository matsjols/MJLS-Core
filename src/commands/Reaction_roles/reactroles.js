import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType, EmbedBuilder, LabelBuilder, CheckboxBuilder, TextDisplayBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { createError, TitanBotError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createReactionRoleMessage, hasDangerousPermissions, getAllReactionRoleMessages, deleteReactionRoleMessage } from '../../services/reactionRoleService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import {
    getReactionRolePanelStatus,
    formatPanelStatusField,
} from '../../utils/panelStatus.js';
import { startDashboardSession } from '../../utils/dashboardSession.js';
import { getReactionRoleKey } from '../../utils/database/keys.js';

const DASHBOARD_EPHEMERAL = MessageFlags.Ephemeral;
const SELECT_OPTION_LABEL_LIMIT = 100;
const SELECT_OPTION_DESCRIPTION_LIMIT = 100;

function truncateText(value, maxLength) {
    const text = String(value ?? '');
    return text.length > maxLength ? text.substring(0, maxLength) : text;
}

export default {
    data: new SlashCommandBuilder()
        .setName('reaksjonsroller')
        .setDescription('Administrer tildeling av reaksjonsroller')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('sett-opp')
                .setDescription('Sett opp et nytt reaksjonsrollepanel')
                .addChannelOption(option => 
                    option.setName('kanal')
                        .setDescription('Kanalen der reaksjonsrollemeldingen skal sendes')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('tittel')
                        .setDescription('Tittel for reaksjonsrollepanelet')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('beskrivelse')
                        .setDescription('Beskrivelse for reaksjonsrollepanelet')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('rolle1')
                        .setDescription('Første rolle som skal legges til')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('rolle2')
                        .setDescription('Andre rolle som skal legges til')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('rolle3')
                        .setDescription('Tredje rolle som skal legges til')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('rolle4')
                        .setDescription('Fjerde rolle som skal legges til')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('rolle5')
                        .setDescription('Femte rolle som skal legges til')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Administrer og konfigurer reaksjonsrollepanelene dine')
                .addStringOption(option =>
                    option
                        .setName('panel')
                        .setDescription('Velg et reaksjonsrollepanel som skal administreres')
                        .setRequired(false)
                        .setAutocomplete(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'sett-opp') {
            await handleSetup(interaction);
        } else if (subcommand === 'dashboard') {
            const selectedPanelId = interaction.options.getString('panel');
            await handleDashboard(interaction, selectedPanelId);
        }
    },

    async autocomplete(interaction) {
        if (interaction.commandName !== 'reaksjonsroller') return;
        if (interaction.options.getSubcommand() !== 'dashboard') return;

        try {
            const guildId = interaction.guild.id;
            const client = interaction.client;
            const guild = interaction.guild;

            let panels;
            try {
                panels = await getAllReactionRoleMessages(client, guildId);
            } catch {
                await interaction.respond([]).catch(() => {});
                return;
            }

            if (!panels?.length) {
                await interaction.respond([]).catch(() => {});
                return;
            }

            const choices = [];
            for (const panel of panels) {
                if (!panel.messageId || !panel.channelId) continue;

                const channel = guild.channels.cache.get(panel.channelId);
                if (!channel) continue;

                const cachedTitle = channel.messages?.cache?.get(panel.messageId)?.embeds?.[0]?.title;
                const roleCount = Array.isArray(panel.roles) ? panel.roles.length : 0;
                const label = cachedTitle
                    ? `${cachedTitle} (#${channel.name})`
                    : `#${channel.name} · ${roleCount} rolle${roleCount === 1 ? '' : 'r'}`;

                choices.push({ name: label.substring(0, 100), value: panel.messageId });
                if (choices.length >= 25) break;
            }

            await interaction.respond(choices).catch(() => {});
        } catch {
            await interaction.respond([]).catch(() => {});
        }
    }
};

async function handleSetup(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;
    
    logger.info(`Sett opp av reaksjonsroller startet av ${interaction.user.tag} i serveren ${interaction.guild.name}`);
    
    const channel = interaction.options.getChannel('kanal');
    const title = interaction.options.getString('tittel');
    const description = interaction.options.getString('beskrivelse');

    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        throw createError(
            `Ugyldig kanaltype: ${channel.type}`,
            ErrorTypes.VALIDATION,
            'Vennligst velg en tekst- eller kunngjøringskanal.',
            { channelType: channel.type }
        );
    }

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw createError(
            'Boten mangler tillatelsen ManageRoles',
            ErrorTypes.PERMISSION,
            'Jeg trenger tillatelsen "ManageRoles" for å sette opp reaksjonsroller.',
            { permission: 'ManageRoles' }
        );
    }
    
    if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        throw createError(
            `Boten kan ikke sende meldinger i ${channel.name}`,
            ErrorTypes.PERMISSION,
            `Jeg har ikke tillatelse til å sende meldinger i ${channel}.`,
            { channelId: channel.id }
        );
    }

    const existingPanels = await getAllReactionRoleMessages(interaction.client, interaction.guildId);
    if (existingPanels && existingPanels.length >= 5) {
        throw createError(
            'Paneltak nådd',
            ErrorTypes.VALIDATION,
            'Serveren din har nådd grensen på maksimalt 5 reaksjonsrollepaneler. Slett et eksisterende panel for å opprette et nytt.',
            { maxPanels: 5, currentPanels: existingPanels.length }
        );
    }

    const roles = [];
    const roleValidationErrors = [];
    const seenRoleIds = new Set();
    
    for (let i = 1; i <= 5; i++) {
        const role = interaction.options.getRole(`rolle${i}`);
        if (role) {
            if (seenRoleIds.has(role.id)) {
                roleValidationErrors.push(`**${role.name}** - Denne rollen ble valgt mer enn én gang`);
                continue;
            }

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                roleValidationErrors.push(`**${role.name}** - Botens rolle er plassert lavere enn denne rollen i rolle-hierarkiet og kan ikke tildele den`);
                continue;
            }
            
            if (hasDangerousPermissions(role)) {
                roleValidationErrors.push(`**${role.name}** - Denne rollen har farlige tillatelser (Administrator, ManageServer, osv.)`);
                continue;
            }
            
            if (role.managed) {
                roleValidationErrors.push(`**${role.name}** - Dette er en administrert rolle (integrasjons-/bot-rolle)`);
                continue;
            }
            
            if (role.id === interaction.guild.id) {
                roleValidationErrors.push(`**${role.name}** - Kan ikke bruke @everyone-rollen`);
                continue;
            }
            
            seenRoleIds.add(role.id);
            roles.push(role);
        }
    }
    
    if (roleValidationErrors.length > 0) {
        const errorMsg = `Følgende roller kan ikke legges til:\n${roleValidationErrors.join('\n')}`;
        
        if (roles.length === 0) {
            throw createError(
                'Ingen gyldige roller oppgitt',
                ErrorTypes.VALIDATION,
                errorMsg,
                { errors: roleValidationErrors }
            );
        }
        
        await interaction.followUp({
            embeds: [warningEmbed('Advarsel om validering av roller', errorMsg)],
            flags: MessageFlags.Ephemeral
        });
    }

    if (roles.length < 1) {
        throw createError(
            'Ingen roller oppgitt',
            ErrorTypes.VALIDATION,
            'Du må oppgi minst én gyldig rolle.',
            {}
        );
    }

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('reaction_roles')
            .setPlaceholder('Velg rollene dine')
            .setMinValues(0)
            .setMaxValues(roles.length)
            .addOptions(
                roles.map(role => ({
                    label: truncateText(role.name, SELECT_OPTION_LABEL_LIMIT),
                    description: truncateText(`Legg til / fjern rollen ${role.name}`, SELECT_OPTION_DESCRIPTION_LIMIT),
                    value: role.id,
                    emoji: '🎭'
                }))
            )
    );

    const panelEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(getColor('info'))
        .addFields({
            name: 'Tilgjengelige roller',
            value: roles.map(role => `• ${role}`).join('\n')
        })
        .setFooter({ text: 'Velg roller fra nedtrekksmenyen nedenfor' });

    const message = await channel.send({
        embeds: [panelEmbed],
        components: [row]
    });

    const roleIds = roles.map(role => role.id);
    try {
        await createReactionRoleMessage(
            interaction.client,
            interaction.guildId,
            channel.id,
            message.id,
            roleIds
        );
    } catch (saveError) {
        await message.delete().catch(() => {});
        throw saveError;
    }

    logger.info(`Reaksjonsrollemelding opprettet: ${message.id} med ${roles.length} roller av ${interaction.user.tag}`);

    try {
        await logEvent({
            client: interaction.client,
            guildId: interaction.guildId,
            eventType: EVENT_TYPES.REACTION_ROLE_CREATE,
            data: {
                description: `Reaksjonsrollepanel opprettet av ${interaction.user.tag}`,
                userId: interaction.user.id,
                channelId: channel.id,
                fields: [
                    {
                        name: 'Tittel',
                        value: title,
                        inline: false
                    },
                    {
                        name: 'Kanal',
                        value: channel.toString(),
                        inline: true
                    },
                    {
                        name: 'Roller',
                        value: `${roles.length} roller`,
                        inline: true
                    },
                    {
                        name: 'Rolleliste',
                        value: roles.map(r => r.toString()).join(','),
                        inline: false
                    },
                    {
                        name: 'Lenke til melding',
                        value: message.url,
                        inline: false
                    }
                ]
            }
        });
    } catch (logError) {
        logger.warn('Kunne ikke logge opprettelse av reaksjonsrolle:', logError);
    }

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('Vellykket', `✅ Reaksjonsrollepanel opprettet i ${channel}!\n\n${message.url}`)]
    });
}

async function fetchPanelDiscordMessage(guild, panelData) {
    try {
        const channel = guild.channels.cache.get(panelData.channelId);
        if (!channel) return null;
        return await channel.messages.fetch(panelData.messageId).catch(() => null);
    } catch {
        return null;
    }
}

async function rebuildLivePanelMessage(guild, panelData) {
    try {
        const channel = guild.channels.cache.get(panelData.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(panelData.messageId).catch(() => null);
        if (!msg || !msg.embeds[0]) return;

        const roleObjects = panelData.roles
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean);

        if (roleObjects.length === 0) return;

        const currentEmbed = msg.embeds[0];
        const updatedEmbed = EmbedBuilder.from(currentEmbed);
        const fields = currentEmbed.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
        const roleFieldIdx = fields.findIndex(f => f.name === 'Tilgjengelige roller' || f.name === 'Available Roles');
        const newRoleValue = roleObjects.map(r => `• ${r}`).join('\n');
        if (roleFieldIdx !== -1) {
            fields[roleFieldIdx] = { name: 'Tilgjengelige roller', value: newRoleValue, inline: false };
        } else {
            fields.push({ name: 'Tilgjengelige roller', value: newRoleValue, inline: false });
        }
        updatedEmbed.setFields(fields);

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('reaction_roles')
                .setPlaceholder('Velg rollene dine')
                .setMinValues(0)
                .setMaxValues(roleObjects.length)
                .addOptions(
                    roleObjects.map(r => ({
                        label: r.name.substring(0, 100),
                        description: `Legg til / fjern rollen ${r.name}`.substring(0, 100),
                        value: r.id,
                        emoji: '🎭',
                    })),
                ),
        );

        await msg.edit({ embeds: [updatedEmbed], components: [selectRow] });
    } catch (error) {
        logger.warn('Kunne ikke gjenoppbygge aktivt reaksjonsrollepanel:', error.message);
    }
}

async function showPanelDashboard(interaction, panelData, discordMsg, guildId, guild, client, panelStatus = null) {
    if (!panelStatus && client) {
        panelStatus = await getReactionRolePanelStatus(client, guild, panelData);
        if (panelStatus.recoveredId) {
            await migrateReactionRoleMessageId(client, guildId, panelData, panelStatus.recoveredId);
            discordMsg = panelStatus.message || discordMsg;
        }
    }

    const payload = buildReactionRoleDashboardPayload(panelData, discordMsg, guildId, guild, panelStatus);
    await InteractionHelper.safeEditReply(interaction, { ...payload, flags: DASHBOARD_EPHEMERAL });
}

function buildReactionRoleDashboardPayload(panelData, discordMsg, guildId, guild, panelStatus = null) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const title = discordMsg?.embeds?.[0]?.title ?? 'Navnløst panel';
    const roleList =
        panelData.roles.length > 0
            ? panelData.roles.map(id => `<@&${id}>`).join(',')
            : '`Ingen`';

    const showRepost = panelStatus?.exists === false && panelStatus?.reason === 'panel_deleted';

    const embed = new EmbedBuilder()
        .setTitle('Kontrollpanel for reaksjonsroller')
        .setDescription(
            `**Tittel:** ${title}\n\nVelg et alternativ nedenfor for å endre en innstilling.${discordMsg ? `\n[Klikk her for å se panelet](${discordMsg.url})` : ''}`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: 'Panelstatus', value: formatPanelStatusField(panelStatus), inline: false },
            { name: 'Kanal', value: channel ? `<#${channel.id}>` : '`Ikke funnet`', inline: true },
            { name: 'Roller', value: `\`${panelData.roles.length} / 25\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Rolleliste', value: roleList, inline: false },
        )
        .setFooter({ text: 'Kontrollpanelet lukkes etter 10 minutter med inaktivitet' })
        .setTimestamp();

    const buttons = [];

    if (showRepost) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`rr_repost_${guildId}`)
                .setLabel('Publiser panel på nytt')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📌'),
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId(`rr_edit_text_${guildId}`)
            .setLabel('Rediger paneltekst')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✏️'),
        new ButtonBuilder()
            .setCustomId(`rr_delete_${guildId}`)
            .setLabel('Slett panel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
    );

    const optionsSelect = new StringSelectMenuBuilder()
        .setCustomId(`rr_opts_${guildId}`)
        .setPlaceholder('Velg en handling...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Legg til rolle')
                .setDescription('Legg til en rolle i dette panelet (opptil 25 totalt)')
                .setValue('add_role')
                .setEmoji('➕'),
            ...(panelData.roles.length > 0
                ? [
                      new StringSelectMenuOptionBuilder()
                          .setLabel('Fjern rolle')
                          .setDescription('Fjern en rolle fra dette panelet')
                          .setValue('remove_role')
                          .setEmoji('➖'),
                  ]
                : []),
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(buttons),
            new ActionRowBuilder().addComponents(optionsSelect),
        ],
    };
}

async function migrateReactionRoleMessageId(client, guildId, panelData, newMessageId) {
    if (!newMessageId || panelData.messageId === newMessageId) return;
    const oldKey = getReactionRoleKey(guildId, panelData.messageId);
    panelData.messageId = newMessageId;
    await client.db.set(getReactionRoleKey(guildId, newMessageId), panelData);
    await client.db.delete(oldKey).catch(() => {});
}

async function repostReactionRolePanel(guild, panelData, client, guildId, fallbackEmbed = null) {
    const channel = await guild.channels.fetch(panelData.channelId).catch(() => null);
    if (!channel) {
        throw createError(
            'Panelkanal mangler',
            ErrorTypes.CONFIGURATION,
            'Den konfigurerte panelkanalen eksisterer ikke lenger.',
        );
    }

    const roleObjects = panelData.roles.map(id => guild.roles.cache.get(id)).filter(Boolean);
    if (roleObjects.length === 0) {
        throw createError(
            'Ingen gyldige roller',
            ErrorTypes.VALIDATION,
            'Dette panelet har ingen gyldige roller igjen å republisere.',
        );
    }

    const title = fallbackEmbed?.title || 'Reaksjonsroller';
    const description = fallbackEmbed?.description || 'Velg rollene dine ved å bruke menyen nedenfor.';

    const panelEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(getColor('info'))
        .addFields({
            name: 'Tilgjengelige roller',
            value: roleObjects.map(role => `• ${role}`).join('\n'),
        });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('reaction_roles')
            .setPlaceholder('Velg rollene dine')
            .setMinValues(0)
            .setMaxValues(roleObjects.length)
            .addOptions(
                roleObjects.map(role => ({
                    label: role.name.substring(0, 100),
                    description: `Legg til / fjern rollen ${role.name}`.substring(0, 100),
                    value: role.id,
                    emoji: '🎭',
                })),
            ),
    );

    const sent = await channel.send({ embeds: [panelEmbed], components: [row] });
    await migrateReactionRoleMessageId(client, guildId, panelData, sent.id);
    return sent;
}

async function handleDashboard(interaction, selectedPanelId) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: DASHBOARD_EPHEMERAL });
    if (!deferSuccess) return;

    const client = interaction.client;
    const guildId = interaction.guild.id;
    const guild = interaction.guild;

    const panels = await getAllReactionRoleMessages(client, guildId);
    if (!panels?.length) {
        throw createError(
            'Ingen paneler',
            ErrorTypes.CONFIGURATION,
            'Ingen reaksjonsrollepaneler ble funnet. Bruk `/reaksjonsroller sett-opp` først.',
        );
    }

    let panelData = selectedPanelId ? panels.find(p => p.messageId === selectedPanelId) : null;
    if (!panelData) {
        if (panels.length === 1) {
            panelData = panels[0];
        } else {
            throw createError(
                'Panel kreves',
                ErrorTypes.VALIDATION,
                'Det finnes flere paneler. Velg ett ved hjelp av **panel**-alternativet.',
            );
        }
    }

    let panelStatus = await getReactionRolePanelStatus(client, guild, panelData);
    if (panelStatus.recoveredId) {
        await migrateReactionRoleMessageId(client, guildId, panelData, panelStatus.recoveredId);
        panelStatus = await getReactionRolePanelStatus(client, guild, panelData);
    }

    const discordMsg = panelStatus.message || (await fetchPanelDiscordMessage(guild, panelData));
    const payload = buildReactionRoleDashboardPayload(panelData, discordMsg, guildId, guild, panelStatus);

    await startDashboardSession({
        interaction,
        ...payload,
        flags: DASHBOARD_EPHEMERAL,
        selectMenuId: `rr_opts_${guildId}`,
        buttonMatcher: (customId) =>
            customId === `rr_edit_text_${guildId}` ||
            customId === `rr_delete_${guildId}` ||
            customId === `rr_repost_${guildId}`,
        onSelect: async (selectInteraction) => {
            const selectedOption = selectInteraction.values[0];
            if (selectedOption === 'add_role') {
                await handleAddRole(selectInteraction, interaction, panelData, guildId, guild, client);
            } else if (selectedOption === 'remove_role') {
                await handleRemoveRole(selectInteraction, interaction, panelData, panels, guildId, guild, client);
            }
        },
        onButton: async (btnInteraction) => {
            if (btnInteraction.customId === `rr_repost_${guildId}`) {
                await btnInteraction.deferUpdate();
                const fallbackEmbed = discordMsg?.embeds?.[0];
                const newMsg = await repostReactionRolePanel(
                    guild,
                    panelData,
                    client,
                    guildId,
                    fallbackEmbed,
                );
                await btnInteraction.followUp({
                    embeds: [successEmbed('Panel publisert på nytt', `Reaksjonsrollepanelet ble gjenopprettet i ${newMsg.channel}.`)],
                    flags: MessageFlags.Ephemeral,
                });
                await showPanelDashboard(
                    interaction,
                    panelData,
                    newMsg,
                    guildId,
                    guild,
                    client,
                    { exists: true, message: newMsg },
                );
                return;
            }

            if (btnInteraction.customId === `rr_edit_text_${guildId}`) {
                await handleEditText(btnInteraction, interaction, panelData, guildId, guild, client);
                return;
            }

            if (btnInteraction.customId === `rr_delete_${guildId}`) {
                await handleDeletePanel(btnInteraction, interaction, panelData, panels, guildId, guild, client);
            }
        },
    });
}

async function handleEditText(buttonInteraction, rootInteraction, panelData, guildId, guild, client) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const discordMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;

    const currentTitle = discordMsg?.embeds?.[0]?.title ?? '';
    const currentDesc = discordMsg?.embeds?.[0]?.description ?? '';

    const modal = new ModalBuilder()
        .setCustomId('rr_edit_text')
        .setTitle('Rediger paneltekst')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_title')
                    .setLabel('Tittel')
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentTitle)
                    .setMaxLength(256)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_description')
                    .setLabel('Beskrivelse')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(currentDesc)
                    .setMaxLength(2048)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await buttonInteraction.showModal(modal);
    } catch (error) {
        logger.error('Feil ved visning av modal for redigering av tekst:', error);
        await replyUserError(buttonInteraction, {
            type: ErrorTypes.UNKNOWN,
            message: 'Kunne ikke vise vinduet for å redigere paneltekst. Vennligst prøv igjen.',
        }).catch(() => {});
        return;
    }

    const submitted = await buttonInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'rr_edit_text' && i.user.id === buttonInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newTitle = submitted.fields.getTextInputValue('panel_title').trim();
    const newDescription = submitted.fields.getTextInputValue('panel_description').trim();

    if (discordMsg) {
        const roleObjects = panelData.roles
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean);
        const updatedEmbed = EmbedBuilder.from(discordMsg.embeds[0])
            .setTitle(newTitle)
            .setDescription(newDescription);
        if (roleObjects.length > 0) {
            const fields = discordMsg.embeds[0].fields?.map(f => ({ name: f.name, value: f.value, inline: f.inline })) || [];
            const roleFieldIdx = fields.findIndex(f => f.name === 'Tilgjengelige roller' || f.name === 'Available Roles');
            const newRoleValue = roleObjects.map(r => `• ${r}`).join('\n');
            if (roleFieldIdx !== -1) {
                fields[roleFieldIdx] = { name: 'Tilgjengelige roller', value: newRoleValue, inline: false };
            } else {
                fields.push({ name: 'Tilgjengelige roller', value: newRoleValue, inline: false });
            }
            updatedEmbed.setFields(fields);
        }
        await discordMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
    }

    await submitted.reply({
        embeds: [successEmbed('Panel oppdatert', 'Tittel og beskrivelse har blitt oppdatert.')],
        flags: MessageFlags.Ephemeral,
    });

    const refreshedMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;
    await showPanelDashboard(rootInteraction, panelData, refreshedMsg, guildId, guild, client);
}

async function handleAddRole(selectInteraction, rootInteraction, panelData, guildId, guild, client) {
    await selectInteraction.deferUpdate();

    if (panelData.roles.length >= 25) {
        await replyUserError(selectInteraction, {
            type: ErrorTypes.VALIDATION,
            message: 'Dette panelet har allerede nådd maksimalkapasiteten på 25 roller.',
        });
        return;
    }

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('rr_add_role_pick')
        .setPlaceholder('Velg en rolle å legge til...')
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('Legg til rolle')
                .setDescription(
                    `**Nåværende roller:** ${panelData.roles.length}/25\n\nVelg en rolle du ønsker å legge til i dette panelet.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'rr_add_role_pick',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        if (panelData.roles.includes(role.id)) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.VALIDATION,
                message: `${role} finnes allerede i dette panelet.`,
            });
            return;
        }
        if (role.id === guild.id) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.VALIDATION,
                message: 'Du kan ikke bruke @everyone.',
            });
            return;
        }
        if (role.managed) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.VALIDATION,
                message: 'Administrerte roller / bot-roller kan ikke benyttes.',
            });
            return;
        }
        if (hasDangerousPermissions(role)) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.PERMISSION,
                message: 'Den rollen har sensitive tillatelser (Administrator, ManageServer, osv.) og kan ikke benyttes.',
            });
            return;
        }
        if (role.position >= guild.members.me.roles.highest.position) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.PERMISSION,
                message: "Den rollen er plassert høyere enn min høyeste rolle i hierarkiet. Flytt min rolle over den først.",
            });
            return;
        }

        panelData.roles.push(role.id);
        const key = getReactionRoleKey(guildId, panelData.messageId);
        await client.db.set(key, panelData);

        await rebuildLivePanelMessage(guild, panelData);

        await roleInteraction.followUp({
            embeds: [successEmbed('Rolle lagt til', `${role} har blitt lagt til i panelet.`)],
            flags: MessageFlags.Ephemeral,
        });

        const channel = guild.channels.cache.get(panelData.channelId);
        const discordMsg = channel
            ? await channel.messages.fetch(panelData.messageId).catch(() => null)
            : null;
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, client);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            replyUserError(selectInteraction, {
                type: ErrorTypes.RATE_LIMIT,
                message: 'Ingen rolle ble valgt. Ingenting ble endret.',
            }).catch(() => {});
        }
    });
}

async function handleRemoveRole(selectInteraction, rootInteraction, panelData, panels, guildId, guild, client) {
    await selectInteraction.deferUpdate();

    const roleOptions = panelData.roles
        .map(id => {
            const role = guild.roles.cache.get(id);
            return role ? { label: role.name.substring(0, 100), value: id } : null;
        })
        .filter(Boolean);

    if (roleOptions.length === 0) {
        await replyUserError(selectInteraction, {
            type: ErrorTypes.USER_INPUT,
            message: 'Rollene på dette panelet eksisterer ikke lenger på serveren.',
        });
        return;
    }

    const removeSelect = new StringSelectMenuBuilder()
        .setCustomId('rr_remove_role_pick')
        .setPlaceholder('Velg en rolle som skal fjerne...')
        .setMaxValues(1)
        .addOptions(
            roleOptions.map(r =>
                new StringSelectMenuOptionBuilder().setLabel(r.label).setValue(r.value).setEmoji('🎭'),
            ),
        );

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('Fjern rolle')
                .setDescription('Velg rollen du ønsker å fjerne fra dette panelet.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(removeSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const removeCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'rr_remove_role_pick',
        time: 60_000,
        max: 1,
    });

    removeCollector.on('collect', async removeInteraction => {
        await removeInteraction.deferUpdate();
        const roleId = removeInteraction.values[0];
        const role = guild.roles.cache.get(roleId);

        panelData.roles = panelData.roles.filter(id => id !== roleId);

        if (panelData.roles.length === 0) {
            const channel = guild.channels.cache.get(panelData.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(panelData.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }
            await deleteReactionRoleMessage(client, guildId, panelData.messageId);

            await removeInteraction.followUp({
                embeds: [
                    successEmbed(
                        '✅ Rolle fjernet',
                        'Det var den siste rollen på panelet. Panelet har blitt slettet.',
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

            const panelIndex = panels.findIndex(p => p.messageId === panelData.messageId);
            if (panelIndex > -1) {
                panels.splice(panelIndex, 1);
            }

            if (panels.length === 0) {
                await InteractionHelper.safeEditReply(rootInteraction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Kontrollpanel for reaksjonsroller')
                            .setDescription('Ingen paneler gjenstår. Bruk `/reaksjonsroller sett-opp` for å opprette et.')
                            .setColor(getColor('info')),
                    ],
                    components: [],
                    flags: DASHBOARD_EPHEMERAL,
                });
            } else {
                await InteractionHelper.safeEditReply(rootInteraction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Kontrollpanel for reaksjonsroller')
                            .setDescription('Panel slettet. Kjør `/reaksjonsroller dashboard` for å administrere et annet panel.')
                            .setColor(getColor('success')),
                    ],
                    components: [],
                    flags: DASHBOARD_EPHEMERAL,
                });
            }
        } else {
            const key = getReactionRoleKey(guildId, panelData.messageId);
            await client.db.set(key, panelData);
            await rebuildLivePanelMessage(guild, panelData);

            await removeInteraction.followUp({
                embeds: [
                    successEmbed(
                        '✅ Rolle fjernet',
                        `${role ? role.toString() : `<@&${roleId}>`} har blitt fjernet fra panelet.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

            const channel = guild.channels.cache.get(panelData.channelId);
            const discordMsg = channel
                ? await channel.messages.fetch(panelData.messageId).catch(() => null)
                : null;
            await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, client);
        }
    });

    removeCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            replyUserError(selectInteraction, {
                type: ErrorTypes.RATE_LIMIT,
                message: 'Ingen rolle ble valgt. Ingenting ble endret.',
            }).catch(() => {});
        }
    });
}

async function handleDeletePanel(btnInteraction, rootInteraction, panelData, panels, guildId, guild, client) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const discordMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;
    const title = discordMsg?.embeds?.[0]?.title ?? 'dette panelet';

    const deleteModal = new ModalBuilder()
        .setCustomId('rr_delete_confirm_modal')
        .setTitle('Slett reaksjonsrollepanel');

    const deleteWarningText = new TextDisplayBuilder()
        .setContent(`⚠️ Du er i ferd med å slette panelet **${title}** permanent. Dette vil fjerne Discord-meldingen og alle tilknyttede reaksjonsrolletildelinger.`);

    const deleteCheckbox = new CheckboxBuilder()
        .setCustomId('delete_confirmation')
        .setDefault(false);

    const deleteCheckboxLabel = new LabelBuilder()
        .setLabel('Jeg bekrefter – dette kan ikke angres')
        .setCheckboxComponent(deleteCheckbox);

    deleteModal
        .addTextDisplayComponents(deleteWarningText)
        .addLabelComponents(deleteCheckboxLabel);

    await btnInteraction.showModal(deleteModal);

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'rr_delete_confirm_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, client);
        return;
    }

    const confirmed = submitted.fields.getCheckbox('delete_confirmation');

    if (!confirmed) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Du må huke av bekreftelsesboksen for å slette panelet.' });
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, client);
        return;
    }

    await submitted.deferUpdate();

    if (discordMsg) {
        await discordMsg.delete().catch(() => {});
    }
    await deleteReactionRoleMessage(client, guildId, panelData.messageId);

    try {
        await logEvent({
            client,
            guildId,
            eventType: EVENT_TYPES.REACTION_ROLE_DELETE,
            data: {
                description: `Reaksjonsrollepanel slettet av ${submitted.user.tag}`,
                userId: submitted.user.id,
                channelId: panelData.channelId,
                fields: [
                    { name: 'Panel', value: title, inline: true },
                    { name: 'Kanal', value: channel ? channel.toString() : 'Ukjent', inline: true },
                ],
            },
        });
    } catch (logErr) {
        logger.warn('Kunne ikke logge sletting av reaksjonsrolle:', logErr);
    }

    await submitted.followUp({
        embeds: [successEmbed('Panel slettet', `**${title}** har blitt slettet.`)],
        flags: MessageFlags.Ephemeral,
    });

    const panelIndex = panels.findIndex(p => p.messageId === panelData.messageId);
    if (panelIndex > -1) {
        panels.splice(panelIndex, 1);
    }

    if (panels.length === 0) {
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [
                new EmbedBuilder()
                    .setTitle('Kontrollpanel for reaksjonsroller')
                    .setDescription('Ingen paneler gjenstår. Bruk `/reaksjonsroller sett-opp` for å opprette et.')
                    .setColor(getColor('info')),
            ],
            components: [],
            flags: DASHBOARD_EPHEMERAL,
        });
    } else {
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [
                new EmbedBuilder()
                    .setTitle('Kontrollpanel for reaksjonsroller')
                    .setDescription('Panel slettet. Kjør `/reaksjonsroller dashboard` for å administrere et annet panel.')
                    .setColor(getColor('success')),
            ],
            components: [],
            flags: DASHBOARD_EPHEMERAL,
        });
    }
}