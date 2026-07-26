import { SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { joinVoiceChannel, replyMusicSuccess } from '../../services/music/musicActions.js';
import { deferMusicCommand } from '../../services/music/prefixSupport.js';

export default {
    category: 'Music',
    data: new SlashCommandBuilder()
        .setName('musikk-join')
        .setDescription('Bli med i talekanalen din uten å starte avspilling'),

    async execute(interaction, config, client) {
        await deferMusicCommand(interaction);
        const embed = await joinVoiceChannel(client, interaction);
        await replyMusicSuccess(interaction, embed);
    },
};