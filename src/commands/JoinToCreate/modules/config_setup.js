import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { 
    getJoinToCreateConfig, 
    updateJoinToCreateConfig,
    removeJoinToCreateTrigger,
    addJoinToCreateTrigger
} from '../../../utils/database.js';

export default {
    async execute(interaction, config, client) {
        try {
            const triggerChannel = interaction.options.getChannel('trigger_channel');
        const guildId = interaction.guild.id;

        const currentConfig = await getJoinToCreateConfig(client, guildId);

        if (!currentConfig.triggerChannels.includes(triggerChannel.id)) {
            throw new TitanBotError(
                `Kanalen ${triggerChannel.id} er ikke en TempVoice-utløser`,
                ErrorTypes.VALIDATION,
                `${triggerChannel} er ikke konfigurert som en TempVoice-kanal.`
            );
        }

        const embed = new EmbedBuilder()
            .setTitle('TempVoice Konfigurasjon')
            .setDescription(`Konfigurer innstillinger for ${triggerChannel}`)
            .setColor(getColor('info'))
            .addFields(
                {
                    name: 'Nåværende mal for kanalnavn',
                    value: `\`${currentConfig.channelOptions?.[triggerChannel.id]?.nameTemplate || currentConfig.channelNameTemplate}\``,
                    inline: false
                },
                {
                    name: 'Nåværende grense for brukere',
                    value: `${currentConfig.channelOptions?.[triggerChannel.id]?.userLimit || currentConfig.userLimit === 0 ? 'Ingen grense' : currentConfig.userLimit + ' brukere'}`,
                    inline: true
                },
                {
                    name: 'Nåværende Bitrate',
                    value: `${(currentConfig.channelOptions?.[triggerChannel.id]?.bitrate || currentConfig.bitrate) / 1000} kbps`,
                    inline: true
                }
            )
            .setFooter({ text: 'Velg et alternativ å konfigurere under' })
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`jointocreate_config_${triggerChannel.id}`)
            .setPlaceholder('Velg et konfigurasjonsalternativ')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Endre mal for kanalnavn')
                    .setDescription('Endre malen for midlertidige kanalnavn')
                    .setValue('name_template'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Endre grense for antall brukere')
                    .setDescription('Angi maksimalt antall brukere per midlertidige kanal')
                    .setValue('user_limit'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Endre Bitrate')
                    .setDescription('Juster lydkvaliteten for midlertidige kanaler')
                    .setValue('bitrate'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Fjern denne utløserkanalen')
                    .setDescription('Fjern denne kanalen fra TempVoice-systemet')
                    .setValue('remove_trigger'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Vis nåværende innstillinger')
                    .setDescription('Vis alle nåværende konfigurasjonsdetaljer')
                    .setValue('view_settings')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            components: [row],
        }).catch(error => {
            logger.error('Kunne ikke oppdatere svar i config_setup:', error);
        });

        const collector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: (i) => i.user.id === interaction.user.id && i.customId === `jointocreate_config_${triggerChannel.id}`,
            time: 60000
        });

        collector.on('collect', async (selectInteraction) => {
            await selectInteraction.deferUpdate();

            const selectedOption = selectInteraction.values[0];

            try {
                switch (selectedOption) {
                    case 'name_template':
                        await handleNameTemplateChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'user_limit':
                        await handleUserLimitChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'bitrate':
                        await handleBitrateChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'remove_trigger':
                        await handleRemoveTrigger(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'view_settings':
                        await handleViewSettings(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                }
            } catch (error) {
                if (error instanceof TitanBotError) {
                    logger.debug(`Konfigurasjonsvalideringsfeil: ${error.message}`, error.context || {});
                } else {
                    logger.error('Uventet feil i konfigurasjonsmeny:', error);
                }
                
                const errorMessage = error instanceof TitanBotError 
                    ? error.userMessage || 'Det oppsto en feil under behandling av valget ditt.'
                    : 'Det oppsto en feil under behandling av valget ditt.';
                    
                await replyUserError(selectInteraction, {
                    type: ErrorTypes.CONFIGURATION,
                    message: errorMessage
                }).catch(() => {});
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const disabledRow = new ActionRowBuilder().addComponents(
                    selectMenu.setDisabled(true)
                );
                
                await InteractionHelper.safeEditReply(interaction, {
                    components: [disabledRow],
                }).catch(() => {});
            }
        });
            } catch (error) {
            if (error instanceof TitanBotError) {
                throw error;
            }
            logger.error('Uventet feil i config_setup:', error);
            throw new TitanBotError(
                `Konfigurasjonsoppsett mislyktes: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Kunne ikke konfigurere TempVoice-systemet.'
            );
        }
    }
};

async function handleNameTemplateChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle('Konfigurasjon av navnemal')
        .setDescription('Vennligst skriv inn den nye malen for kanalnavn.')
        .addFields(
            {
                name: 'Tilgjengelige variabler',
                value: '• `{username}` - Brukerens brukernavn\n• `{display_name}` - Brukerens visningsnavn\n• `{user_tag}` - Brukerens tag (Bruker#1234)\n• `{guild_name}` - Servernavn',
                inline: false
            },
            {
                name: 'Nåværende mal',
                value: `\`${currentConfig.channelOptions?.[triggerChannel.id]?.nameTemplate || currentConfig.channelNameTemplate}\``,
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: 'Skriv inn den nye malen din i chatten under' });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id,
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newTemplate = message.content.trim();
            
            if (!newTemplate || newTemplate.length > 100) {
                await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Malen må være mellom 1 og 100 tegn.'
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                nameTemplate: newTemplate
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed('Mal oppdatert', `Mal for kanalnavn endret til \`${newTemplate}\``)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`Malvalideringsfeil: ${error.message}`);
            } else {
                logger.error('Feil ved oppdatering av mal:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || 'Kunne ikke oppdatere malen for kanalnavn.'
                : 'Kunne ikke oppdatere malen for kanalnavn.';
                
            await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: errorMessage
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            replyUserError(interaction, {
                type: ErrorTypes.RATE_LIMIT,
                message: 'Ingen respons mottatt. Oppdatering av mal avbrutt.'
            }).catch(() => {});
        }
    });
}

async function handleUserLimitChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle('Konfigurasjon av åpne slots')
        .setDescription('Vennligst skriv inn ny grense for antall brukere (0-99, hvor 0 = ubegrenset).')
        .addFields(
            {
                name: 'Nåværende grense',
                value: `${currentConfig.channelOptions?.[triggerChannel.id]?.userLimit || currentConfig.userLimit === 0 ? 'Ingen grense' : currentConfig.userLimit + ' brukere'}`,
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: 'Skriv inn den nye grensen i chatten under' });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim()),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newLimit = parseInt(message.content.trim());
            
            if (newLimit < 0 || newLimit > 99) {
                await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Brukergrensen må være mellom 0 og 99.'
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                userLimit: newLimit
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed('Grense oppdatert', `Brukergrense endret til ${newLimit === 0 ? 'Ubegrenset' : newLimit + ' brukere'}`)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`Feil ved validering av brukergrense: ${error.message}`);
            } else {
                logger.error('Feil ved oppdatering av brukergrense:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || 'Kunne ikke oppdatere brukergrensen.'
                : 'Kunne ikke oppdatere brukergrensen.';
                
            await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: errorMessage
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            replyUserError(interaction, {
                type: ErrorTypes.RATE_LIMIT,
                message: 'Ingen gyldig respons mottatt. Oppdatering avbrutt.'
            }).catch(() => {});
        }
    });
}

async function handleBitrateChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle('Bitrate-konfigurasjon')
        .setDescription('Vennligst skriv inn den nye bitraten i kbps (8-384).')
        .addFields(
            {
                name: 'Nåværende Bitrate',
                value: `${(currentConfig.channelOptions?.[triggerChannel.id]?.bitrate || currentConfig.bitrate) / 1000} kbps`,
                inline: false
            },
            {
                name: 'Vanlige verdier',
                value: '• 64 kbps - Normal kvalitet\n• 96 kbps - God kvalitet\n• 128 kbps - Høy kvalitet\n• 256 kbps - Veldig høy kvalitet',
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: 'Skriv inn den nye bitraten i chatten under' });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim()),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newBitrate = parseInt(message.content.trim());
            
            if (newBitrate < 8 || newBitrate > 384) {
                await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Bitrate må være mellom 8 og 384 kbps.'
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                bitrate: newBitrate * 1000
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed('Bitrate oppdatert', `Bitrate endret til ${newBitrate} kbps`)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`Feil ved validering av bitrate: ${error.message}`);
            } else {
                logger.error('Feil ved oppdatering av bitrate:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || 'Kunne ikke oppdatere bitraten.'
                : 'Kunne ikke oppdatere bitraten.';
                
            await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: errorMessage
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            replyUserError(interaction, {
                type: ErrorTypes.RATE_LIMIT,
                message: 'Ingen gyldig respons mottatt. Oppdatering avbrutt.'
            }).catch(() => {});
        }
    });
}

async function handleRemoveTrigger(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle('Fjern utløserkanal')
        .setDescription(`Er du sikker på at du vil fjerne ${triggerChannel} fra TempVoice-systemet?`)
        .setColor('#ff6600')
        .setFooter({ text: 'Dette kan ikke angres' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_remove_${triggerChannel.id}`)
            .setLabel('Fjern kanal')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`cancel_remove_${triggerChannel.id}`)
            .setLabel('Avbryt')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.followUp({ 
        embeds: [embed], 
        components: [row],
        flags: MessageFlags.Ephemeral 
    });

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id && 
                     (i.customId === `confirm_remove_${triggerChannel.id}` || i.customId === `cancel_remove_${triggerChannel.id}`),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (buttonInteraction) => {
        await buttonInteraction.deferUpdate();

        if (buttonInteraction.customId === `confirm_remove_${triggerChannel.id}`) {
            try {
                const success = await removeJoinToCreateTrigger(client, interaction.guild.id, triggerChannel.id);
                
                if (success) {
                    await buttonInteraction.followUp({
                        embeds: [successEmbed('Kanal fjernet', `${triggerChannel} har blitt fjernet fra TempVoice-systemet.`)],
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    await replyUserError(buttonInteraction, {
                        type: ErrorTypes.CONFIGURATION,
                        message: 'Kunne ikke fjerne utløserkanalen.'
                    });
                }
            } catch (error) {
                if (error instanceof TitanBotError) {
                    logger.debug(`Feil ved validering av fjerning av utløser: ${error.message}`);
                } else {
                    logger.error('Feil ved fjerning av utløser:', error);
                }
                
                const errorMessage = error instanceof TitanBotError
                    ? error.userMessage || 'Det oppsto en feil under fjerning av utløserkanalen.'
                    : 'Det oppsto en feil under fjerning av utløserkanalen.';
                    
                await replyUserError(buttonInteraction, {
                    type: ErrorTypes.CONFIGURATION,
                    message: errorMessage
                }).catch(() => {});
            }
        } else {
            await buttonInteraction.followUp({
                embeds: [successEmbed('Avbrutt', 'Fjerning av kanal har blitt avbrutt.')],
                flags: MessageFlags.Ephemeral,
            });
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            replyUserError(interaction, {
                type: ErrorTypes.RATE_LIMIT,
                message: 'Ingen respons mottatt. Fjerning avbrutt.'
            }).catch(() => {});
        }
    });
}

async function handleViewSettings(interaction, triggerChannel, currentConfig, client) {
    const channelConfig = currentConfig.channelOptions?.[triggerChannel.id] || {};
    
    const embed = new EmbedBuilder()
        .setTitle('Nåværende innstillinger')
        .setDescription(`Konfigurasjon for ${triggerChannel}`)
        .setColor(getColor('info'))
        .addFields(
            {
                name: 'Utløserkanal',
                value: `${triggerChannel} (${triggerChannel.id})`,
                inline: false
            },
            {
                name: 'Mal for kanalnavn',
                value: `\`${channelConfig.nameTemplate || currentConfig.channelNameTemplate}\``,
                inline: false
            },
            {
                name: 'Åpne slots',
                value: `${channelConfig.userLimit || currentConfig.userLimit === 0 ? 'Ingen grense' : (channelConfig.userLimit || currentConfig.userLimit) + ' brukere'}`,
                inline: true
            },
            {
                name: 'Bitrate',
                value: `${(channelConfig.bitrate || currentConfig.bitrate) / 1000} kbps`,
                inline: true
            },
            {
                name: 'Kategori',
                value: currentConfig.categoryId ? `<#${currentConfig.categoryId}>` : 'Ikke satt',
                inline: true
            },
            {
                name: 'Systemstatus',
                value: currentConfig.enabled ? '✅ Aktivert' : '❌ Deaktivert',
                inline: true
            },
            {
                name: 'Aktive midlertidige kanaler',
                value: Object.keys(currentConfig.temporaryChannels || {}).length.toString(),
                inline: true
            }
        )
        .setTimestamp();

    await interaction.followUp({ 
        embeds: [embed], 
        flags: MessageFlags.Ephemeral 
    });
}