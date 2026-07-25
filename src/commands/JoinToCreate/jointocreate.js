import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, LabelBuilder } from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    initializeJoinToCreate,
    getChannelConfiguration,
    updateChannelConfig,
    removeTriggerChannel,
    hasManageGuildPermission,
    logConfigurationChange,
    getConfiguration
} from '../../services/joinToCreateService.js';

export default {
    data: new SlashCommandBuilder()
        .setName("tempvoice")
        .setDescription("Administrer systemet for stemmekanaler der man kan bli med for å opprette dem.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("sett-opp")
                .setDescription("Opprett en ny TempVoice-talekanal.")
                .addChannelOption((option) =>
                    option
                        .setName("kategori")
                        .setDescription("Kategori talekanalen skal opprettes i.")
                        .addChannelTypes(ChannelType.GuildCategory)
                )
                .addStringOption((option) =>
                    option
                        .setName("kanalnavn")
                        .setDescription("Velg en mal for navnsetting av midlertidige talekanaler.")
                        .addChoices(
                            { name: "{username}s Rom (Standard)", value: "{username}'s Room" },
                            { name: "{username}s Kanal", value: "{username}'s Channel" },
                            { name: "{username}s Lounge", value: "{username}'s Lounge" },
                            { name: "{username}s Space", value: "{username}'s Space" },
                            { name: "{displayName}s Rom", value: "{displayName}'s Room" },
                            { name: "{username}s VC", value: "{username}'s VC" },
                            { name: "{username}s Musikkrom", value: "{username}'s Music Room" },
                            { name: "{username}s Spillrom", value: "{username}'s Gaming Room" },
                            { name: "{username}s Chatterom", value: "{username}'s Chat Room" },
                            { name: "{username}s Private Rom", value: "{username}'s Private Room" }
                        )
                )
                .addIntegerOption((option) =>
                    option
                        .setName("åpne-slots")
                        .setDescription("Maksimalt antall brukere i midlertidige kanaler. (0 = ubegrenset)")
                )
                .addIntegerOption((option) =>
                    option
                        .setName("bitrate")
                        .setDescription("Bithastighet for midlertidige kanaler i kbps (8–96).")
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Konfigurer et eksisterende «Join to Create»-system.")
                .addChannelOption((option) =>
                    option
                        .setName("trigger_channel")
                        .setDescription("TempVoice-kanalen som skal konfigureres.")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildVoice)
                )
        ),
    category: "utility",

    async execute(interaction, config, client) {
        try {
            
            if (!hasManageGuildPermission(interaction.member)) {
                throw new TitanBotError(
                    'Brukeren mangler tillatelsen ManageGuild',
                    ErrorTypes.PERMISSION,
                    'Du trenger tillatelsen **Administrer server** for å bruke denne kommandoen.'
                );
            }

            const subcommand = interaction.options.getSubcommand();
            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            let responseEmbed;

            if (subcommand === "sett-opp") {
                await handleSetupSubcommand(interaction, client);
                return;
            } else if (subcommand === "dashboard") {
                await handleConfigSubcommand(interaction, client);
                return;
            }

        } catch (error) {
            try {
                let errorMessage = 'Det oppsto en feil under utførelsen av denne kommandoen.';
                
                if (error instanceof TitanBotError) {
                    errorMessage = error.userMessage || 'Det oppstod en feil. Vennligst prøv igjen.';
                    logger.debug(`TitanBotError [${error.type}]: ${error.message}`, error.context || {});
                } else {
                    logger.error('Uventet feil i tempvoice-kommandoen:', error);
                    errorMessage = 'Det oppstod en uventet feil. Vennligst prøv igjen eller kontakt kundestøtte.';
                }

                return replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: errorMessage });
            } catch (replyError) {
                logger.error('Kunne ikke sende feilmelding:', replyError);
            }
        }
    }
};

async function handleSetupSubcommand(interaction, client) {
    try {
        const category = interaction.options.getChannel('kategori');
        const nameTemplate = interaction.options.getString('kanalnavn') || "{username}'s Room";
        const userLimit = interaction.options.getInteger('åpne-slots') || 0;
        const bitrate = interaction.options.getInteger('bitrate') || 64;
        const guildId = interaction.guild.id;

        logger.debug(`Setter opp Join to Create i server ${guildId} med mal: ${nameTemplate}`);

        const existingConfig = await getConfiguration(client, guildId);
        
        if (Array.isArray(existingConfig.triggerChannels) && existingConfig.triggerChannels.length > 0) {
            const activeTriggerChannels = [];
            const staleTriggerChannelIds = [];

            for (const existingChannelId of existingConfig.triggerChannels) {
                const existingChannel = await interaction.guild.channels.fetch(existingChannelId).catch(() => null);
                if (existingChannel) {
                    activeTriggerChannels.push(existingChannel);
                } else {
                    staleTriggerChannelIds.push(existingChannelId);
                }
            }

            if (staleTriggerChannelIds.length > 0) {
                for (const staleChannelId of staleTriggerChannelIds) {
                    logger.info(`Fjerner utdatert JTC-utløser ${staleChannelId} fra server ${guildId}`);
                    await removeTriggerChannel(client, guildId, staleChannelId);
                }
            }

            if (activeTriggerChannels.length > 0) {
                const primaryTrigger = activeTriggerChannels[0];
                const errorMessage = `Denne serveren har allerede en TempVoice-kanal satt opp: ${primaryTrigger}\n\nBruk \`/tempvoice dashboard\` for å endre den, eller fjern den først før du oppretter en ny.`;

                throw new TitanBotError(
                    'Serveren har allerede en TempVoice-kanal.',
                    ErrorTypes.VALIDATION,
                    errorMessage,
                    {
                        guildId,
                        activeTriggerCount: activeTriggerChannels.length,
                        expected: true,
                        suppressErrorLog: true
                    }
                );
            }
        }

        logger.debug('Oppretter «TempVoice»-kanal...');
        let triggerChannel = await interaction.guild.channels.create({
            name: 'Join to Create',
            type: ChannelType.GuildVoice,
            parent: category?.id,
            userLimit: 0,
            bitrate: 64000,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                },
            ],
        });

        logger.debug(`Opprettet utløserkanal ${triggerChannel.id}, initialiserer konfigurasjon...`);

        const config = await initializeJoinToCreate(client, guildId, triggerChannel.id, {
            nameTemplate: nameTemplate,
            userLimit: userLimit,
            bitrate: bitrate * 1000,
            categoryId: category?.id
        });

        await logConfigurationChange(client, guildId, interaction.user.id, 'Initialiserte TempVoice', {
            channelId: triggerChannel.id,
            nameTemplate,
            userLimit,
            bitrate
        });

        logger.info(`«TempVoice»-systemet ble opprettet i guilden ${guildId}`);

        const responseEmbed = successEmbed(
            '✅ Oppsett fullført',
            `Opprettet TempVoice-kanal: ${triggerChannel}\n\n` +
            `**Innstillinger:**\n` +
            `• Mal: \`${nameTemplate}\`\n` +
            `• Åpne slots: ${userLimit === 0 ? 'Ubegrenset' : userLimit + ' brukere'}\n` +
            `• Bitrate: ${bitrate} kbps\n` +
            `${category ?`• Kategori: ${category.name}`: '• Kategori: Ingen (rotnivå)'}`
        );

        return await InteractionHelper.safeEditReply(interaction, { embeds: [responseEmbed] });

    } catch (error) {
        logger.error('Error i handleSetupSubcommand:', error);
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Oppsett mislyktes: ${error.message}`,
            ErrorTypes.DISCORD_API,
            'Kunne ikke sette opp TempVoice-systemet. Vennligst sjekk botens tillatelser.'
        );
    }
}

async function handleConfigSubcommand(interaction, client) {
    try {
        const triggerChannel = interaction.options.getChannel('trigger_channel');
        const guildId = interaction.guild.id;

        const currentConfig = await getChannelConfiguration(client, guildId, triggerChannel.id);
        const channelConfig = currentConfig.channelConfig || {};

        const configEmbed = new EmbedBuilder()
            .setTitle('TempVoice konfigurasjon')
            .setDescription(`Konfigurasjon for ${triggerChannel}`)
            .setColor(getColor('info'))
            .addFields(
                {
                    name: 'Mal for kanalnavn',
                    value: `\`${channelConfig.nameTemplate || currentConfig.channelNameTemplate || "{username}'s Room"}\``,
                    inline: false
                },
                {
                    name: 'Åpne slots',
                    value: `${(channelConfig.userLimit ?? currentConfig.userLimit ?? 0) === 0 ? 'Ubegrenset' : (channelConfig.userLimit ?? currentConfig.userLimit ?? 0) + ' brukere'}`,
                    inline: true
                },
                {
                    name: 'Bitrate',
                    value: `${(channelConfig.bitrate ?? currentConfig.bitrate ?? 64000) / 1000} kbps`,
                    inline: true
                }
            )
            .setFooter({ text: 'Bruk knappene under for å endre innstillinger • Kun én utløserkanal støttes per server' })
            .setTimestamp();

        const nameButton = new ButtonBuilder()
            .setCustomId(`jtc_config_name_${triggerChannel.id}`)
            .setLabel('📝 Navnemal')
            .setStyle(ButtonStyle.Primary);

        const limitButton = new ButtonBuilder()
            .setCustomId(`jtc_config_limit_${triggerChannel.id}`)
            .setLabel('👥 Åpne slots')
            .setStyle(ButtonStyle.Primary);

        const bitrateButton = new ButtonBuilder()
            .setCustomId(`jtc_config_bitrate_${triggerChannel.id}`)
            .setLabel('🎵 Bitrate')
            .setStyle(ButtonStyle.Primary);

        const deleteButton = new ButtonBuilder()
            .setCustomId(`jtc_config_delete_${triggerChannel.id}`)
            .setLabel('🗑️ Fjern kanal')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(nameButton, limitButton, bitrateButton, deleteButton);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [configEmbed],
            components: [row]
        });

        const message = await interaction.fetchReply();

        if (!message || typeof message.createMessageComponentCollector !== 'function') {
            throw new TitanBotError(
                'Kunne ikke hente interaksjonssvar for oppsett av innsamler',
                ErrorTypes.DISCORD_API,
                'Kunne ikke åpne konfigurasjonskontrollene. Kjør `/tempvoice dashboard` på nytt..'
            );
        }

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000
        });

        collector.on('collect', async (buttonInteraction) => {
            try {
                
                if (!hasManageGuildPermission(buttonInteraction.member)) {
                    await buttonInteraction.reply({
                        content: '❌ Du trenger tillatelsen **Administrer server** for å bruke disse kontrollene.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const customId = buttonInteraction.customId;

                if (customId.includes('jtc_config_name_')) {
                    await handleNameTemplateModal(buttonInteraction, triggerChannel, currentConfig, client);
                } else if (customId.includes('jtc_config_limit_')) {
                    await handleUserLimitModal(buttonInteraction, triggerChannel, currentConfig, client);
                } else if (customId.includes('jtc_config_bitrate_')) {
                    await handleBitrateModal(buttonInteraction, triggerChannel, currentConfig, client);
                } else if (customId.includes('jtc_config_delete_')) {
                    await handleChannelDeletion(buttonInteraction, triggerChannel, currentConfig, client);
                }
            } catch (error) {
                const userMessage = error instanceof TitanBotError
                    ? error.userMessage || 'Det oppsto en feil.'
                    : 'Det oppsto en feil under behandling av forespørselen din.';

                if (error instanceof TitanBotError) {
                    logger.debug(`Valideringsfeil for knappeinteraksjon: ${error.message}`, error.context || {});
                } else {
                    logger.error('Uventet feil i knappeinteraksjon for konfigurasjon:', error);
                }

                await buttonInteraction.reply({
                    content: `❌ ${userMessage}`,
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
        });

        collector.on('end', () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                nameButton.setDisabled(true),
                limitButton.setDisabled(true),
                bitrateButton.setDisabled(true),
                deleteButton.setDisabled(true)
            );

            message.edit({
                components: [disabledRow],
                embeds: [configEmbed.setFooter({ text: 'Konfigurasjonsøkten er utløpt. Kjør kommandoen på nytt for å gjøre endringer.' })]
            }).catch(() => {});
        });

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Konfigurasjon mislyktes: ${error.message}`,
            ErrorTypes.DATABASE,
            'Kunne ikke laste konfigurasjonen.'
        );
    }
}

async function handleNameTemplateModal(interaction, triggerChannel, currentConfig, client) {
    try {
        const TEMPLATE_OPTIONS = [
            { label: "{username}s Rom (Standard)", value: "{username}'s Room" },
            { label: "{username}s Kanal",        value: "{username}'s Channel" },
            { label: "{username}s Lounge",         value: "{username}'s Lounge" },
            { label: "{username}s Space",          value: "{username}'s Space" },
            { label: "{displayName}s Rom",        value: "{displayName}'s Room" },
            { label: "{username}s VC",             value: "{username}'s VC" },
            { label: "{username}s Musikkrom",  value: "{username}'s Music Room" },
            { label: "{username}s Spillrom", value: "{username}'s Gaming Room" },
            { label: "{username}s Chatterom",   value: "{username}'s Chat Room" },
            { label: "{username}s Private Rom",   value: "{username}'s Private Room" },
        ];

        const currentTemplate = currentConfig.channelConfig?.nameTemplate
            || currentConfig.channelNameTemplate
            || "{username}'s Room";

        const templateSelect = new StringSelectMenuBuilder()
            .setCustomId('template')
            .setPlaceholder('Velg en navnemal...')
            .setOptions(
                TEMPLATE_OPTIONS.map(o => ({
                    label: o.label,
                    value: o.value,
                    default: o.value === currentTemplate,
                })),
            );

        const templateLabel = new LabelBuilder()
            .setLabel('Mal for kanalnavn')
            .setStringSelectMenuComponent(templateSelect);

        const modal = new ModalBuilder()
            .setCustomId(`jtc_name_modal_${triggerChannel.id}`)
            .setTitle('Mal for kanalnavn')
            .addLabelComponents(templateLabel);

        await interaction.showModal(modal);

        const modalSubmission = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === `jtc_name_modal_${triggerChannel.id}` && i.user.id === interaction.user.id,
            time: 60000
        });

        if (!hasManageGuildPermission(modalSubmission.member)) {
            await modalSubmission.reply({
                content: '❌ Du trenger tillatelsen **Administrer server** for å endre disse innstillingene.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const [newTemplate] = modalSubmission.fields.getStringSelectValues('template');

        await updateChannelConfig(client, interaction.guild.id, triggerChannel.id, {
            nameTemplate: newTemplate
        });

        await logConfigurationChange(client, interaction.guild.id, interaction.user.id, 'Oppdatert mal for kanalnavn', {
            channelId: triggerChannel.id,
            newTemplate
        });

        await modalSubmission.reply({
            embeds: [successEmbed('Oppdatert', `Mal for kanalnavn endret til \`${newTemplate}\``)],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            return;
        }
        if (error instanceof TitanBotError) {
            throw error;
        }
        logger.error('Uventet feil i modalvinduet for navnemal:', error);
        throw new TitanBotError(
            `Modalfeil: ${error.message}`,
            ErrorTypes.UNKNOWN,
            'Det oppstod en feil under oppdatering av malen.'
        );
    }
}

async function handleUserLimitModal(interaction, triggerChannel, currentConfig, client) {
    try {
        const currentLimit = currentConfig.channelConfig?.userLimit ?? currentConfig.userLimit ?? 0;

        const modal = new ModalBuilder()
            .setCustomId(`jtc_limit_modal_${triggerChannel.id}`)
            .setTitle('Konfigurer åpne slots')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('user_limit')
                        .setLabel('Angi åpne slots (0-99, 0 = ubegrenset)')
                        .setPlaceholder('Skriv inn et tall mellom 0 og 99')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(2)
                        .setValue(currentLimit.toString())
                )
            );

        await interaction.showModal(modal);

        const modalSubmission = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === `jtc_limit_modal_${triggerChannel.id}` && i.user.id === interaction.user.id,
            time: 60000
        });

        if (!hasManageGuildPermission(modalSubmission.member)) {
            await modalSubmission.reply({
                content: '❌ Du trenger tillatelsen **Administrer server** for å endre disse innstillingene..',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const userInput = modalSubmission.fields.getTextInputValue('user_limit').trim();

        await updateChannelConfig(client, interaction.guild.id, triggerChannel.id, {
            userLimit: parseInt(userInput)
        });

        await logConfigurationChange(client, interaction.guild.id, interaction.user.id, 'Oppdatert åpne slots', {
            channelId: triggerChannel.id,
            userLimit: parseInt(userInput)
        });

        await modalSubmission.reply({
            embeds: [successEmbed('Oppdatert', `Åpne slots endret til ${parseInt(userInput) === 0 ? 'Ubegrenset' : parseInt(userInput) + ' brukere'}`)],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            return;
        }
        if (error instanceof TitanBotError) {
            throw error;
        }
        logger.error('Uventet feil i modalvinduet for åpne slots:', error);
        throw new TitanBotError(
            `Modalfeil: ${error.message}`,
            ErrorTypes.UNKNOWN,
            'Det oppsto en feil under oppdatering av åpne slots.'
        );
    }
}

async function handleBitrateModal(interaction, triggerChannel, currentConfig, client) {
    try {
        const currentBitrate = ((currentConfig.channelConfig.bitrate ?? currentConfig.bitrate ?? 64000) / 1000);

        const modal = new ModalBuilder()
            .setCustomId(`jtc_bitrate_modal_${triggerChannel.id}`)
            .setTitle('Konfigurer Bitrate')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('bitrate')
                        .setLabel('Angi bitrate i kbps (8-384)')
                        .setPlaceholder('Skriv inn et tall mellom 8 og 384')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(3)
                        .setValue(currentBitrate.toString())
                )
            );

        await interaction.showModal(modal);

        const modalSubmission = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === `jtc_bitrate_modal_${triggerChannel.id}` && i.user.id === interaction.user.id,
            time: 60000
        });

        if (!hasManageGuildPermission(modalSubmission.member)) {
            await modalSubmission.reply({
                content: '❌ Du trenger tillatelsen **Administrer server** for å endre disse innstillingene.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const userInput = modalSubmission.fields.getTextInputValue('bitrate').trim();

        await updateChannelConfig(client, interaction.guild.id, triggerChannel.id, {
            bitrate: parseInt(userInput) * 1000
        });

        await logConfigurationChange(client, interaction.guild.id, interaction.user.id, 'Oppdatert bitrate', {
            channelId: triggerChannel.id,
            bitrate: parseInt(userInput)
        });

        await modalSubmission.reply({
            embeds: [successEmbed('Oppdatert', `Bitrate endret til ${parseInt(userInput)} kbps`)],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            return;
        }
        if (error instanceof TitanBotError) {
            throw error;
        }
        logger.error('Uventet feil i bitrate-dialogboksen:', error);
        throw new TitanBotError(
            `Modalfeil: ${error.message}`,
            ErrorTypes.UNKNOWN,
            'Det oppstod en feil under oppdatering av bitrate.'
        );
    }
}

async function handleChannelDeletion(interaction, triggerChannel, currentConfig, client) {
    try {
        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`jtc_delete_confirm_${triggerChannel.id}`)
                .setLabel('🗑️ Ja, slett')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`jtc_delete_cancel_${triggerChannel.id}`)
                .setLabel('❌ Avbryt')
                .setStyle(ButtonStyle.Secondary)
        );

        await InteractionHelper.safeReply(interaction, {
            embeds: [warningEmbed('Bekreft sletting', `Er du sikker på at du vil fjerne **${triggerChannel.name}** fra TempVoice-systemet?\n\nDette kan ikke angres.`)],
            components: [confirmRow],
            flags: MessageFlags.Ephemeral
        });

        const message = await interaction.fetchReply();
        const deleteCollector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: (i) => i.user.id === interaction.user.id && 
                          (i.customId === `jtc_delete_confirm_${triggerChannel.id}` || 
                           i.customId === `jtc_delete_cancel_${triggerChannel.id}`),
            time: 600_000,
            max: 1
        });

        deleteCollector.on('collect', async (buttonInteraction) => {
            try {
                
                if (!hasManageGuildPermission(buttonInteraction.member)) {
                    await buttonInteraction.reply({
                        content: '❌ Du trenger tillatelsen **Administrer server** for å fjerne kanaler.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                if (buttonInteraction.customId === `jtc_delete_confirm_${triggerChannel.id}`) {
                    
                    await removeTriggerChannel(client, interaction.guild.id, triggerChannel.id);

                    await logConfigurationChange(client, interaction.guild.id, interaction.user.id, 'Fjernet TempVoice-utløser', {
                        channelId: triggerChannel.id,
                        channelName: triggerChannel.name
                    });

                    try {
                        if (triggerChannel.members.size === 0) {
                            await triggerChannel.delete('TempVoice-utløser fjernet av administrator');
                        }
                    } catch (deleteError) {
                        logger.warn(`Kunne ikke slette kanalen ${triggerChannel.id}: ${deleteError.message}`);
                        
                    }

                    await buttonInteraction.update({
                        embeds: [successEmbed('Fjernet', `**${triggerChannel.name}** har blitt fjernet fra TempVoice-systemet.`)],
                        components: []
                    });

                } else {
                    await buttonInteraction.update({
                        embeds: [successEmbed('Avbrutt', 'Fjerning av kanal har blitt avbrutt.')],
                        components: []
                    });
                }
            } catch (collectError) {
                logger.error('Feil ved håndtering av bekreftelse på sletting:', collectError);
                await buttonInteraction.reply({
                    content: '❌ Det oppsto en feil under behandling av forespørselen din.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
        });

        deleteCollector.on('end', (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                message.edit({ components: [] }).catch(() => {});
            }
        });

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        logger.error('Uventet feil i handleChannelDeletion:', error);
        throw new TitanBotError(
            `Slettefeil: ${error.message}`,
            ErrorTypes.UNKNOWN,
            'Det oppsto en feil under fjerning av kanalen.'
        );
    }
}