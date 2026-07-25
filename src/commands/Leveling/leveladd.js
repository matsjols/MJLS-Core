import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { addLevels, getLevelingConfig } from '../../services/leveling/leveling.js';
import { createEmbed } from '../../utils/embeds.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
  data: new SlashCommandBuilder()
    .setName('leveladd')
    .setDescription('Legg til levels på en bruker')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Brukeren du vil legge til levels på')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('levels')
        .setDescription('Antall levels å legge til')
        .setRequired(true)
        .setMinValue(1)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const hasPermission = await checkUserPermissions(
      interaction,
      PermissionFlagsBits.ManageGuild,
      'Du trenger tillatelsen Administrer server (ManageGuild) for å bruke denne kommandoen.'
    );
    if (!hasPermission) return;

    const levelingConfig = await getLevelingConfig(client, interaction.guildId);
    if (!levelingConfig?.enabled) {
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor('#f1c40f')
            .setDescription('Levlingssystemet er for øyeblikket deaktivert på denne serveren.')
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const targetUser = interaction.options.getUser('user');
    const levelsToAdd = interaction.options.getInteger('levels');

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      throw new TitanBotError(
        `User ${targetUser.id} not found in this guild`,
        ErrorTypes.USER_INPUT,
        'Den angitte brukeren er ikke på denne serveren.'
      );
    }

    const userData = await addLevels(client, interaction.guildId, targetUser.id, levelsToAdd);

    await InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Levels lagt til',
          description: `La til ${levelsToAdd} levels på ${targetUser.tag}.\n**Nytt level:** ${userData.level}`,
          color: 'success'
        })
      ]
    });

    logger.info(
      `[ADMIN] User ${interaction.user.tag} added ${levelsToAdd} levels to ${targetUser.tag} in guild ${interaction.guildId}`
    );
  }
};