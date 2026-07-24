import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    LabelBuilder,
    ChannelType,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed, buildUserErrorEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { getGuildConfig, setConfigValue } from '../../services/config/guildConfig.js';
import ConfigService from '../../services/config/configService.js';
import { logger } from '../../utils/logger.js';
import { botConfig, getCommandPrefix } from '../../config/bot.js';

const DASHBOARD_CUSTOM_ID = 'config_select';
const WIZARD_BUTTON_ID = 'config_wizard';
const activeWizardSessions = new Set();

const DM_DISABLED_HELP = [
    '1. Høyreklikk på denne serverens navn (mobil: trykk på servernavnet øverst).',
    '2. Åpne **Personverninnstillinger**.',
    '3. Slå på **Tillat direktemeldinger fra servermedlemmer**.',
    '4. Klikk på **Start oppsettsveiviser** igjen.',
].join('\n');

async function notifyWizardStarted(buttonInteraction) {
    await buttonInteraction.followUp({
        embeds: [infoEmbed(
            'Oppsettsveiviser startet',
            'Sjekk direktemeldingene dine – jeg har sendt det første oppsettsspørsmålet dit.\n\nSvar på hvert spørsmål i den direktemeldingen. Skriv `skip` (eller `hopp over`) for å beholde nåværende verdi.',
        )],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});
}

async function notifyWizardDmBlocked(buttonInteraction) {
    await replyUserError(buttonInteraction, {
        type: ErrorTypes.USER_INPUT,
        message: `Jeg kunne ikke sende deg en direktemelding. Aktiver direktemeldinger fra denne serveren, og prøv igjen.\n\n${DM_DISABLED_HELP}`,
    }).catch(() => {});
}

function formatChannelMention(guild, channelId) {
    if (!channelId) {
        return '`Ikke satt`';
    }
    const channel = guild.channels.cache.get(channelId);
    return channel ? `<#${channelId}>` : `#${channelId}`;
}

function formatRoleMention(guild, roleId) {
    if (!roleId) {
        return '`Ikke satt`';
    }
    const role = guild.roles.cache.get(roleId);
    return role ? `<@&${roleId}>` : `@${roleId}`;
}

function getBotPresenceText() {
    const activity = botConfig.presence?.activities?.[0];
    if (!activity?.name) {
        return '`Ikke konfigurert`';
    }

    const typeLabels = ['Spiller', 'Strømmer', 'Lytter til', 'Overvåker', '', 'Konkurrerer i'];
    const typeLabel = typeLabels[activity.type];
    if (!typeLabel) {
        return activity.name;
    }

    return `${typeLabel} **${activity.name}**`;
}

function getThemeColorLines() {
    const colors = botConfig.embeds.colors;
    return [
        `🎨 Primær \`${colors.primary}\` · Suksess \`${colors.success}\``,
        `⚠️ Advarsel \`${colors.warning}\` · Feil \`${colors.error}\``,
    ].join('\n');
}

function buildDashboardEmbed(config, guild) {
    const setupDone = config.setupWizardCompleted;

    return createEmbed({
        title: '⚙️ Serverkonfigurasjon',
        description: `Kjerneinnstillinger for **${guild.name}**. Velg et alternativ nedenfor eller kjør oppsettsveiviseren.`,
        color: 'info',
        fields: [
            {
                name: '⌨️ Serverprefiks',
                value: `\`${config.prefix || getCommandPrefix()}\``,
                inline: true,
            },
            {
                name: '🛡️ Moderatorrolle',
                value: formatRoleMention(guild, config.modRole),
                inline: true,
            },
            {
                name: '📋 Loggkanal',
                value: formatChannelMention(guild, config.logging?.channels?.audit),
                inline: true,
            },
            {
                name: '💚 Bot-status',
                value: getBotPresenceText(),
                inline: false,
            },
            {
                name: '🎨 Innbyggingstema (Embed Theme)',
                value: `${getThemeColorLines()}\n-# Farger settes i bot-konfigurasjonen og gjelder globalt.`,
                inline: false,
            },
            {
                name: '⚡ Kommandotilgang',
                value: 'Bruk `/commands dashboard` for å aktivere eller deaktivere kommandoer og underkommandoer.',
                inline: false,
            },
            {
                name: `${setupDone ? '✅' : '📝'} Oppsett`,
                value: setupDone
                    ? 'Oppsettsveiviser fullført – kjør på nytt når som helst for å oppdatere innstillinger.'
                    : 'Kjør oppsettsveiviseren for å konfigurere serveren raskt.',
                inline: false,
            },
        ],
        footer: 'Dashbordet lukkes etter 10 minutters inaktivitet',
    });
}

function buildSettingsSelect(guildId) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${DASHBOARD_CUSTOM_ID}:${guildId}`)
            .setPlaceholder('⚙️ Velg en innstilling som skal redigeres...')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Serverprefiks')
                    .setDescription('Endre prefikset for tekstkommandoer')
                    .setValue('prefix')
                    .setEmoji('⌨️'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Moderatorrolle')
                    .setDescription('Rolle som brukes til moderatorkommandoer')
                    .setValue('modRole')
                    .setEmoji('🛡️'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Loggkanal')
                    .setDescription('Kanal for systemloggmeldinger')
                    .setValue('logChannelId')
                    .setEmoji('📋'),
            ),
    );
}

function buildButtonRow(config, guildId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${WIZARD_BUTTON_ID}:${guildId}`)
            .setLabel(config.setupWizardCompleted ? 'Kjør oppsettsveiviser på nytt' : 'Start oppsettsveiviser')
            .setEmoji('📝')
            .setStyle(config.setupWizardCompleted ? ButtonStyle.Secondary : ButtonStyle.Success),
    );
}

function extractId(value) {
    if (!value || typeof value !== 'string') return null;

    const channelMention = value.match(/<#!?(\d{17,19})>/);
    if (channelMention) return channelMention[1];

    const roleMention = value.match(/<@&(\d{17,19})>/);
    if (roleMention) return roleMention[1];

    const digits = value.match(/^(\d{17,19})$/);
    if (digits) return digits[1];

    return null;
}

async function askQuestion(dmChannel, userId, prompt, stepNumber, totalSteps) {
    await dmChannel.send({
        embeds: [createEmbed({
            title: `Oppsettsspørsmål ${stepNumber}/${totalSteps}`,
            description: prompt,
            color: 'primary',
        })],
    });

    const collected = await dmChannel.awaitMessages({
        filter: (message) => message.author.id === userId && !message.author.bot,
        max: 1,
        time: 180_000,
    }).catch(() => null);

    if (!collected || !collected.size) {
        await dmChannel.send({
            embeds: [buildUserErrorEmbed(ErrorTypes.RATE_LIMIT, 'Du svarte ikke i tide. Kjør oppsettsveiviseren på nytt når du er klar.')],
        });
        return null;
    }

    const answer = collected.first().content.trim();
    if (answer.toLowerCase() === 'cancel' || answer.toLowerCase() === 'avbryt') {
        await dmChannel.send({
            embeds: [infoEmbed('Oppsettsveiviser avbrutt', 'Oppsettsveiviseren ble stanset. Dine lagrede svar gjelder fortsatt.')],
        });
        return { cancelled: true };
    }

    return { answer };
}

function formatSavedAck(key, value, guild) {
    if (key === 'prefix') {
        return `Serverprefiks lagret som \`${value}\`.`;
    }

    if (key === 'logChannelId') {
        if (value === null) {
            return 'Loggkanal tømt.';
        }
        const channel = guild.channels.cache.get(value);
        return `Loggkanal lagret som ${channel ?? `<#${value}>`}.`;
    }

    if (key === 'modRole') {
        if (value === null) {
            return 'Moderatorrolle tømt.';
        }
        const role = guild.roles.cache.get(value);
        return `Moderatorrolle lagret som ${role ?? `<@&${value}>`}.`;
    }

    return 'Innstilling lagret.';
}

async function validateGuildChannelId(guild, channelId) {
    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
        throw new Error('Den kanalen ble ikke funnet på denne serveren, eller er ikke en tekstkanal.');
    }
    return channel.id;
}

async function validateGuildRoleId(guild, roleId) {
    const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
        throw new Error('Den rollen ble ikke funnet på denne serveren.');
    }
    return role.id;
}

async function refreshDashboard(rootInteraction, config, guild) {
    const embed = buildDashboardEmbed(config, guild);
    const components = [buildButtonRow(config, guild.id), buildSettingsSelect(guild.id)];
    await InteractionHelper.safeEditReply(rootInteraction, { embeds: [embed], components }).catch(() => {});
}

async function runSetupWizard(buttonInteraction, config, guild, client, rootInteraction) {
    const user = buttonInteraction.user;

    if (activeWizardSessions.has(user.id)) {
        await buttonInteraction.followUp({
            embeds: [warningEmbed('Oppsett kjører allerede', 'Du har allerede en oppsettsveiviser åpen i direktemeldingene dine. Svar der for å fortsette, eller skriv `cancel` / `avbryt` for å stoppe den.')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    activeWizardSessions.add(user.id);

    let dmChannel;

    try {
        dmChannel = await user.createDM();
    } catch (error) {
        logger.warn('Kunne ikke opprette DM-kanal for oppsettsveiviser', { userId: user.id, error: error.message });
        await notifyWizardDmBlocked(buttonInteraction);
        return;
    } finally {
        if (!dmChannel) {
            activeWizardSessions.delete(user.id);
        }
    }

    const prompts = [
        {
            key: 'prefix',
            skipMessage: 'Beholder nåværende serverprefiks.',
            question: 'Hvilken kommandoprefiks skal denne serveren bruke?\nNåværende: `' + (config.prefix || getCommandPrefix()) + '`\nSvar `skip` for å beholde den, eller `cancel` for å stoppe.',
            parse: async (answer) => {
                const normalized = answer.trim();
                if (normalized.toLowerCase() === 'skip' || normalized.toLowerCase() === 'hopp over') return undefined;
                if (/\s/.test(normalized) || normalized.length < 1 || normalized.length > 10) {
                    throw new Error('Prefikset må være mellom 1 og 10 tegn uten mellomrom.');
                }
                return normalized;
            },
        },
        {
            key: 'logChannelId',
            skipMessage: 'Beholder nåværende loggkanal.',
            question: 'Hvilken kanal skal motta bot-logger?\nSend en kanal-omtale (mention), kanal-ID, `none` for å tømme, `skip` for å beholde nåværende verdi, eller `cancel` for å stoppe.',
            parse: async (answer) => {
                const normalized = answer.trim();
                if (normalized.toLowerCase() === 'skip' || normalized.toLowerCase() === 'hopp over') return undefined;
                if (normalized.toLowerCase() === 'none' || normalized.toLowerCase() === 'ingen') return null;
                const id = extractId(normalized);
                if (!id) throw new Error('Oppgi en gyldig kanal-omtale eller ID fra denne serveren.');
                return validateGuildChannelId(guild, id);
            },
        },
        {
            key: 'modRole',
            skipMessage: 'Beholder nåværende moderatorrolle.',
            question: 'Hvilken rolle skal moderatorer ha?\nSend en rolle-omtale (mention), rolle-ID, `none` for å tømme, `skip` for å beholde nåværende verdi, eller `cancel` for å stoppe.',
            parse: async (answer) => {
                const normalized = answer.trim();
                if (normalized.toLowerCase() === 'skip' || normalized.toLowerCase() === 'hopp over') return undefined;
                if (normalized.toLowerCase() === 'none' || normalized.toLowerCase() === 'ingen') return null;
                const id = extractId(normalized);
                if (!id) throw new Error('Oppgi en gyldig rolle-omtale eller ID fra denne serveren.');
                return validateGuildRoleId(guild, id);
            },
        },
    ];

    const changes = {};
    const errors = [];
    let wizardCancelled = false;

    try {
        try {
            await dmChannel.send({
                embeds: [createEmbed({
                    title: '📝 Oppsettsveiviser',
                    description: 'Svar på hvert spørsmål i denne direktemeldingen.\n\n• Skriv `skip` for å beholde nåværende verdi\n• Skriv `cancel` for å stoppe veiviseren',
                    color: 'info',
                })],
            });
        } catch (error) {
            logger.warn('Kunne ikke sende DM for oppsettsveiviser', { userId: user.id, error: error.message });
            await notifyWizardDmBlocked(buttonInteraction);
            return;
        }

        await notifyWizardStarted(buttonInteraction);

        for (let index = 0; index < prompts.length; index++) {
            const prompt = prompts[index];
            let answered = false;

            while (!answered) {
                const result = await askQuestion(
                    dmChannel,
                    user.id,
                    prompt.question,
                    index + 1,
                    prompts.length,
                );

                if (result === null) {
                    wizardCancelled = true;
                    answered = true;
                    break;
                }

                if (result.cancelled) {
                    wizardCancelled = true;
                    answered = true;
                    break;
                }

                try {
                    const value = await prompt.parse(result.answer);

                    if (value === undefined) {
                        await dmChannel.send({
                            embeds: [infoEmbed('Hoppet over', prompt.skipMessage)],
                        });
                    } else {
                        await ConfigService.updateSetting(client, guild.id, prompt.key, value, user.id);
                        changes[prompt.key] = value;
                        await dmChannel.send({
                            embeds: [successEmbed('Lagret', formatSavedAck(prompt.key, value, guild))],
                        });

                        try {
                            const updatedConfig = await getGuildConfig(client, guild.id);
                            await refreshDashboard(rootInteraction, updatedConfig, guild);
                        } catch (refreshError) {
                            logger.debug('Kunne ikke oppdatere dashbordet under oppsettsveiviseren', { error: refreshError.message });
                        }
                    }

                    answered = true;
                } catch (error) {
                    errors.push(`• ${prompt.key}: ${error.message}`);
                    await dmChannel.send({
                        embeds: [buildUserErrorEmbed(ErrorTypes.VALIDATION, `${error.message}\n\nVennligst svar på nytt med et gyldig svar, \`skip\` eller \`cancel\`.`)],
                    });
                }
            }

            if (wizardCancelled) {
                break;
            }
        }

        if (!wizardCancelled) {
            try {
                await setConfigValue(client, guild.id, 'setupWizardCompleted', true);
            } catch (error) {
                logger.warn('Kunne ikke lagre setupWizardCompleted-flagget', { guildId: guild.id, error: error.message });
            }
        }

        const summaryTitle = wizardCancelled
            ? (Object.keys(changes).length > 0 ? 'Oppsettsveiviser stanset' : 'Oppsettsveiviser avbrutt')
            : (errors.length > 0 ? 'Oppsett fullført' : 'Oppsett fullført');

        const summaryBody = wizardCancelled
            ? (Object.keys(changes).length > 0
                ? `Oppsettet ble stanset tidlig. Lagret **${Object.keys(changes).length}** innstilling(er) før det ble stoppet.`
                : 'Oppsettsveiviseren ble stanset før noen endringer ble lagret.')
            : (Object.keys(changes).length > 0
                ? `Oppdaterte **${Object.keys(changes).length}** innstilling(er).${errors.length > 0 ? ' Noen svar trengte flere forsøk.' : ''}`
                : 'Ingen endringer ble utført.');

        const summaryEmbed = createEmbed({
            title: wizardCancelled ? `⚠️ ${summaryTitle}` : `✅ ${summaryTitle}`,
            description: summaryBody,
            color: wizardCancelled ? 'warning' : (errors.length > 0 ? 'warning' : 'success'),
        });

        if (errors.length > 0) {
            const uniqueErrors = [...new Set(errors)];
            summaryEmbed.addFields({ name: 'Problemer', value: uniqueErrors.join('\n').slice(0, 1024) });
        }

        await dmChannel.send({ embeds: [summaryEmbed] });

        try {
            const updatedConfig = await getGuildConfig(client, guild.id);
            await refreshDashboard(rootInteraction, updatedConfig, guild);
        } catch (error) {
            logger.debug('Kunne ikke oppdatere dashbordet etter fullført veiviser', { error: error.message });
        }
    } finally {
        activeWizardSessions.delete(user.id);
    }
}

async function showSettingModal(selectInteraction, guildId, setting) {
    const modalCustomId = `config_wizard_modal:${setting}:${guildId}`;

    if (setting === 'logChannelId') {
        const modal = new ModalBuilder()
            .setCustomId(modalCustomId)
            .setTitle('📋 Oppdater loggkanal');

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('log_channel')
            .setPlaceholder('Velg en tekstkanal...')
            .setMinValues(1)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true);

        const channelLabel = new LabelBuilder()
            .setLabel('Loggkanal')
            .setDescription('Kanal der systemloggmeldinger vil bli sendt')
            .setChannelSelectMenuComponent(channelSelect);

        modal.addLabelComponents(channelLabel);
        await selectInteraction.showModal(modal);
        return;
    }

    if (setting === 'modRole') {
        const modal = new ModalBuilder()
            .setCustomId(modalCustomId)
            .setTitle('🛡️ Oppdater moderatorrolle');

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('mod_role')
            .setPlaceholder('Velg en moderatorrolle...')
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true);

        const roleLabel = new LabelBuilder()
            .setLabel('Moderatorrolle')
            .setDescription('Rolle som brukes til moderatorkommandoer')
            .setRoleSelectMenuComponent(roleSelect);

        modal.addLabelComponents(roleLabel);
        await selectInteraction.showModal(modal);
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(modalCustomId)
        .setTitle('Oppdater serverprefiks');

    const textInput = new TextInputBuilder()
        .setCustomId('value')
        .setLabel('Nytt prefiks (1-10 tegn, ingen mellomrom)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(10);

    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    await selectInteraction.showModal(modal);
}

function resolveSettingModalValue(setting, submitted) {
    if (setting === 'logChannelId') {
        const channelId = submitted.fields.getField('log_channel')?.values?.[0];
        if (!channelId) {
            throw new Error('Vennligst velg en loggkanal.');
        }
        return channelId;
    }

    if (setting === 'modRole') {
        const roleId = submitted.fields.getField('mod_role')?.values?.[0];
        if (!roleId) {
            throw new Error('Vennligst velg en moderatorrolle.');
        }
        return roleId;
    }

    const prefix = submitted.fields.getTextInputValue('value')?.trim();
    if (!prefix || prefix.length < 1 || prefix.length > 10 || /\s/.test(prefix)) {
        throw new Error('Prefikset må være mellom 1 og 10 tegn uten mellomrom.');
    }
    return prefix;
}

function buildSettingSuccessMessage(setting, value, guild) {
    if (setting === 'logChannelId') {
        const channel = guild.channels.cache.get(value);
        return `Loggkanal satt til ${channel ?? `<#${value}>`}.`;
    }

    if (setting === 'modRole') {
        const role = guild.roles.cache.get(value);
        return `Moderatorrolle satt til ${role ?? `<@&${value}>`}.`;
    }

    return `Serverprefiks satt til \`${value}\`.`;
}

async function handleSettingModalSubmit(selectInteraction, rootInteraction, setting, guildId, client) {
    const modalCustomId = `config_wizard_modal:${setting}:${guildId}`;

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: (modalInteraction) =>
                modalInteraction.customId === modalCustomId &&
                modalInteraction.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        return;
    }

    try {
        const value = resolveSettingModalValue(setting, submitted);
        await ConfigService.updateSetting(client, guildId, setting, value, submitted.user.id);

        await submitted.reply({
            embeds: [successEmbed('Konfigurasjon oppdatert', buildSettingSuccessMessage(setting, value, submitted.guild))],
            flags: MessageFlags.Ephemeral,
        });

        const updatedConfig = await getGuildConfig(client, guildId);
        await refreshDashboard(rootInteraction, updatedConfig, submitted.guild);
    } catch (error) {
        logger.error('Feil ved innsending av modal for konfigurasjonsveiviser:', error);
        await replyUserError(submitted, {
            type: ErrorTypes.CONFIGURATION,
            message: error.message || 'Vennligst prøv igjen.',
        }).catch(() => {});
    }
}

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('configbordet')
        .setDescription('Åpne serverens konfigurasjonsdashbord og oppsettsveiviser')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),
    category: 'Core',

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferSuccess) {
                return;
            }

            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'Du trenger tillatelsen **Administrer server** for å bruke denne kommandoen.',
                });
            }

            const guildConfig = await getGuildConfig(interaction.client, interaction.guildId);
            const embed = buildDashboardEmbed(guildConfig, interaction.guild);
            const components = [buildButtonRow(guildConfig, interaction.guildId), buildSettingsSelect(interaction.guildId)];

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components });

            const replyMessage = await interaction.fetchReply().catch(() => null);
            if (!replyMessage) {
                return;
            }

            const collectorFilter = (componentInteraction) =>
                componentInteraction.user.id === interaction.user.id &&
                componentInteraction.customId.includes(`:${interaction.guildId}`);

            const componentCollector = replyMessage.createMessageComponentCollector({
                filter: collectorFilter,
                time: 600_000,
            });

            componentCollector.on('collect', async (componentInteraction) => {
                try {
                    if (componentInteraction.isButton()) {
                        await componentInteraction.deferUpdate();

                        if (componentInteraction.customId.startsWith(`${WIZARD_BUTTON_ID}:`)) {
                            const latestConfig = await getGuildConfig(interaction.client, interaction.guildId);
                            await runSetupWizard(componentInteraction, latestConfig, interaction.guild, interaction.client, interaction);
                        }
                        return;
                    }

                    if (componentInteraction.isStringSelectMenu()) {
                        const selected = componentInteraction.values[0];
                        await showSettingModal(componentInteraction, interaction.guildId, selected);
                        await handleSettingModalSubmit(
                            componentInteraction,
                            interaction,
                            selected,
                            interaction.guildId,
                            interaction.client,
                        );
                    }
                } catch (error) {
                    logger.error('Interaksjonsfeil i konfigurasjonsdashbordet:', error);
                    await replyUserError(componentInteraction, {
                        type: ErrorTypes.UNKNOWN,
                        message: 'Klarte ikke å behandle valget ditt. Vennligst prøv igjen.',
                    }).catch(() => {});
                }
            });
        } catch (error) {
            logger.error('Feil i config-kommando:', error);
            await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: 'Klarte ikke å åpne konfigurasjonsdashbordet. Vennligst prøv igjen.',
            });
        }
    },
};