import { SlashCommandBuilder } from 'discord.js';
import shopBrowse from './modules/shop_browse.js';

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('butikk')
        .setDescription('Bla gjennom butikken.'),

    async execute(interaction, config, client) {
        return shopBrowse.execute(interaction, config, client);
    },
};