import { SlashCommandBuilder } from 'discord.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import searchDefine from './modules/search_define.js';
import searchGoogle from './modules/search_google.js';
import searchUrban from './modules/search_urban.js';

export default {
    data: new SlashCommandBuilder()
        .setName('sok')
        .setDescription('Søk på nettet og i ordbøker')
        .addSubcommand(subcommand =>
            subcommand
                .setName('definer')
                .setDescription('Slå opp definisjonen på et ord')
                .addStringOption(option =>
                    option.setName('ord')
                        .setDescription('Ordet du vil slå opp')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('google')
                .setDescription('Søk på Google')
                .addStringOption(option =>
                    option.setName('sok')
                        .setDescription('Hva vil du søke etter?')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('urban')
                .setDescription('Søk på Urban Dictionary etter definisjoner')
                .addStringOption(option =>
                    option.setName('uttrykk')
                        .setDescription('Uttrykket du vil slå opp på Urban Dictionary')
                        .setRequired(true))
        ),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'definer':
                return await searchDefine.execute(interaction, config, client);
            case 'google':
                return await searchGoogle.execute(interaction, config, client);
            case 'urban':
                return await searchUrban.execute(interaction, config, client);
            default:
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Ukjent underkommando' });
        }
    }
};