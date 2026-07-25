import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { setUserLevel, getLevelingConfig } from '../../services/leveling/leveling.js';
import { createEmbed } from '../../utils/embeds.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
  data: new SlashCommandBuilder()
    .setName('sett-level')
    .setDescription("Sett en brukers level til en bestemt verdi")
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Brukeren du vil sette levelet til')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Levelet som skal settes')
        .setRequired(true)
        .setMinValue(0)
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
    const newLevel = interaction.options.getInteger('level');

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      throw new TitanBotError(
        `User ${targetUser.id} not found in this guild`,
        ErrorTypes.USER_INPUT,
        'Den angitte brukeren er ikke på denne serveren.'
      );
    }

    const userData = await setUserLevel(client, interaction.guildId, targetUser.id, newLevel);

    await InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Level satt',
          description: `Satte ${targetUser.tag} sitt level til **${newLevel}**.\n**Total XP:** ${userData.totalXp}`,
          color: 'success'
        })
      ]
    });

    logger.info(
      `[ADMIN] User ${interaction.user.tag} set ${targetUser.tag}'s level to ${newLevel} in guild ${interaction.guildId}`
    );
  }
};