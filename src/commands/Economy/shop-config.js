import { SlashCommandBuilder } from 'discord.js';
import shopConfigSetrole from './modules/shop_config_setrole.js';

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('butikk-konfig')
        .setDescription('Konfigurer butikkinnstillinger (Krever Administrer server).')
        .addSubcommand(subcommand =>
            subcommand
                .setName('settrolle')
                .setDescription('Sett Discord-rollen som gis ved kjøp av Premium-rolle i butikken.')
                .addRoleOption(option =>
                    option
                        .setName('rolle')
                        .setDescription('Rollen som skal gis ved kjøp av Premium-rolle.')
                        .setRequired(true),
                ),
        ),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'settrolle') {
            return shopConfigSetrole.execute(interaction, config, client);
        }
    },
};