import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const EMBED_DESCRIPTION_LIMIT = 4096;

export default {
  data: new SlashCommandBuilder()
    .setName("fight")
    .setDescription("Starter en simulert 1v1 tekstbasert kamp.")
    .addUserOption((option) =>
      option
        .setName("opponent")
        .setDescription("Brukeren du vil kjempe mot.")
        .setRequired(true),
    ),
  category: 'Fun',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const challenger = interaction.user;
    const opponent = interaction.options.getUser("opponent");

    if (challenger.id === opponent.id) {
      const embed = warningEmbed(
        "⚔️ Ugyldig utfordring",
        `**${challenger.username}**, du kan ikke kjempe mot deg selv! Det er uavgjort før det engang har begynt.`
      );
      return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    if (opponent.bot) {
      const embed = warningEmbed(
        "⚔️ Ugyldig motstander",
        "Du kan ikke kjempe mot boter! Utfordre en ekte person i stedet."
      );
      return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    const winner = rand(0, 1) === 0 ? challenger : opponent;
    const loser = winner.id === challenger.id ? opponent : challenger;
    const rounds = rand(3, 7);
    const damage = rand(10, 50);

    const log = [];
    log.push(
      `💥 **${challenger.username}** utfordrer **${opponent.username}** til duell! (Beste av ${rounds} runder)`,
    );

    for (let i = 1; i <= rounds; i++) {
      const attacker = rand(0, 1) === 0 ? challenger : opponent;
      const target = attacker.id === challenger.id ? opponent : challenger;
      const action = [
        "kaster et vilt slag",
        "lander et kritisk treff",
        "bruker en svak trylleformel",
        "parerer og motangriper",
      ][rand(0, 3)];
      log.push(
        `\n**Runde ${i}:** ${attacker.username} ${action} mot ${target.username} for ${rand(1, damage)} skade!`,
      );
    }

    const outcomeText = log.join("\n");
    const winnerText = `👑 **${winner.username}** har beseiret ${loser.username} og tar seieren!`;
    const fullDescription = `${outcomeText}\n\n${winnerText}`;

    const description = fullDescription.length <= EMBED_DESCRIPTION_LIMIT
      ? fullDescription
      : `${fullDescription.slice(0, EMBED_DESCRIPTION_LIMIT - 15)}\n\n...`;

    const embed = successEmbed(
      "🏆 Duell fullført!",
      description
    );

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    logger.debug(`Fight command executed between ${challenger.id} and ${opponent.id} in guild ${interaction.guildId}`);
  },
};