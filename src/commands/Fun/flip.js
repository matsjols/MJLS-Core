import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName("flip")
    .setDescription("Kaster en mynt (Kron eller mynt)."),
  category: 'Fun',

  async execute(interaction, config, client) {
    const result = Math.random() < 0.5 ? "Kron" : "Mynt";
    const emoji = result === "Kron" ? "🪙" : "🔮";

    const embed = successEmbed(
      "Kron eller mynt?",
      `Mynten landet på... **${result}** ${emoji}!`,
    );

    await InteractionHelper.safeReply(interaction, { embeds: [embed] });
    logger.debug(`Flip command executed by user ${interaction.user.id} in guild ${interaction.guildId}`);
  },
};