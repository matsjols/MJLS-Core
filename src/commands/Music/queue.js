import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildQueueReply } from '../../services/music/musicActions.js';

export default {
    slashOnly: true,
    category: 'Music',
    data: new SlashCommandBuilder()
        .setName('kø')
        .setDescription('Vis den gjeldende musikkøen')
        .addIntegerOption((opt) =>
            opt.setName('side').setDescription('Sidenummer').setMinValue(1),
        ),

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        const page = (interaction.options.getInteger('side') || 1) - 1;
        const payload = buildQueueReply(client, interaction.guild.id, page);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: payload.embeds,
            components: payload.components,
        });
    },
};