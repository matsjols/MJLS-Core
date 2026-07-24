import { EmbedBuilder } from 'discord.js';
import { setBirthday } from '../../../services/birthdayService.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const month = interaction.options.getInteger("måned");
        const day = interaction.options.getInteger("dato");
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        const result = await setBirthday(client, guildId, userId, month, day);

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('Bursdag registrert!')
            .setDescription(`Fødselsdatoen din er satt til **${result.data.day} ${result.data.monthName}**!`);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed]
        });
    }
};