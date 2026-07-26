import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { playQuery, replyMusicSuccess } from '../../services/music/musicActions.js';

export default {
    slashOnly: true,
    category: 'Music',
    data: new SlashCommandBuilder()
        .setName('spill-av')
        .setDescription('Spill av en sang eller legg den til i køen')
        .addStringOption((opt) =>
            opt.setName('søk').setDescription('Sangnavn eller lenke').setRequired(true),
        ),

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        const result = await playQuery(client, interaction, interaction.options.getString('søk'));
        await replyMusicSuccess(interaction, result.embed);
    },
};