import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Kaster terninger med standard notasjon (f.eks. 2d20, 1d6 + 5).")
    .addStringOption((option) =>
      option
        .setName("notation")
        .setDescription("Terningnotasjonen (f.eks. 2d6, 1d20 + 4)")
        .setRequired(true)
        .setMaxLength(50),
    ),
  category: 'Fun',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const notation = interaction.options
      .getString("notation")
      .toLowerCase()
      .replace(/\s/g, "");

    const match = notation.match(/^(\d*)d(\d+)([\+\-]\d+)?$/);

    if (!match) {
      throw new TitanBotError(
        `Ugyldig terningnotasjon: ${notation}`,
        ErrorTypes.USER_INPUT,
        'Ugyldig notasjon. Bruk et format som `1d20` eller `3d6+5`.'
      );
    }

    const numDice = parseInt(match[1] || "1", 10);
    const numSides = parseInt(match[2], 10);
    const modifier = parseInt(match[3] || "0", 10);

    if (numDice < 1 || numDice > 20) {
      throw new TitanBotError(
        `For mange terninger forespurt: ${numDice}`,
        ErrorTypes.VALIDATION,
        'Vennligst hold antall terninger mellom 1 og 20.'
      );
    }

    if (numSides < 1 || numSides > 1000) {
      throw new TitanBotError(
        `Ugyldig antall sider: ${numSides}`,
        ErrorTypes.VALIDATION,
        'Vennligst hold antall sider mellom 1 og 1000.'
      );
    }

    let rolls = [];
    let totalRoll = 0;

    for (let i = 0; i < numDice; i++) {
      const roll = Math.floor(Math.random() * numSides) + 1;
      rolls.push(roll);
      totalRoll += roll;
    }

    const finalTotal = totalRoll + modifier;

    const resultsDetail =
      numDice > 1 ? `**Kast:** ${rolls.join(" + ")}\n` : "";
    const modifierText = modifier !== 0 ? `+ (${modifier})` : "";

    const embed = successEmbed(
      `🎲 Kaster ${numDice}d${numSides}${modifier !== 0 ? match[3] : ""}`,
      `${resultsDetail}**Totalt:** ${totalRoll}${modifierText} = **${finalTotal}**`,
    );

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    logger.debug(`Roll command executed by user ${interaction.user.id} with notation ${notation} in guild ${interaction.guildId}`);
  },
};