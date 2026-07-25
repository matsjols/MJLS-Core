import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

import dashboard from './modules/logging_dashboard.js';
import channel from './modules/logging_channel.js';

import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName('logging') // Holder selve hovedkommandoen som 'logging' (brukes ofte også på norsk)
        .setDescription('Administrer serverlogging — kanaler, filtre og handlingskategorier.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription('Åpne dashboardet for logging — sett kanaler, filtre og slå av/på kategorier.'),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('kanal') // Endret fra 'channel'
                .setDescription('Hurtigoppsett av en loggkanal uten å åpne dashboardet.')
                .addStringOption((option) =>
                    option
                        .setName('destinasjon') // Endret fra 'destination'
                        .setDescription('Hvilken loggdestinasjon som skal konfigureres.')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Revisjon (moderering, meldinger, medlemmer…)', value: 'audit' },
                            { name: 'Søknader', value: 'applications' },
                            { name: 'Rapporter', value: 'reports' },
                        ),
                )
                .addChannelOption((option) =>
                    option
                        .setName('kanal') // Endret fra 'channel'
                        .setDescription('Tekstkanalen for logger.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName('deaktiver') // Endret fra 'disable'
                        .setDescription('Sett til True (Sann) for å fjerne denne loggkanalen.')
                        .setRequired(false),
                ),
        ),

    async execute(interaction, config, client) {
        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'dashboard') { // Endret for å matche ny setName
                return await dashboard.execute(interaction, config, client);
            }

            if (subcommand === 'kanal') { // Endret for å matche ny setName
                return await channel.execute(interaction, config, client);
            }

            await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Denne underkommandoen er ikke gjenkjent.' });
        } catch (error) {
            logger.error('logging command error:', error);
            await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'En uventet feil oppstod.' }).catch(() => {});
        }
    },
};