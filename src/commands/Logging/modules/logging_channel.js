import { PermissionsBitField, ChannelType } from 'discord.js';
import { setLogChannel } from '../../../services/loggingService.js';
import { successEmbed } from '../../../utils/embeds.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

const DESTINATION_LABELS = {
  audit: 'Revisjonslogg',
  applications: 'Søknader',
  reports: 'Rapporter',
};

export default {
  prefixOnly: false,
  async execute(interaction, config, client) {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger tillatelsen **Administrer server** for å konfigurere loggkanaler.' });
      }

      await InteractionHelper.safeDefer(interaction, { ephemeral: true });

      // Endret for å matche setName i logging.js
      const destination = interaction.options.getString('destinasjon'); 
      const channel = interaction.options.getChannel('kanal');
      const disable = interaction.options.getBoolean('deaktiver') ?? false;

      if (disable) {
        await setLogChannel(client, interaction.guildId, destination, null);
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [successEmbed(
            'Kanal fjernet',
            `Kanalen for **${DESTINATION_LABELS[destination]}** har blitt fjernet.`,
          )],
        });
      }

      if (!channel || channel.type !== ChannelType.GuildText) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Vennligst oppgi en gyldig tekstkanal.' });
      }

      const botPerms = channel.permissionsFor(interaction.guild.members.me);
      if (!botPerms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: `Jeg trenger tillatelsene **Se kanal**, **Send meldinger** og **Bygg inn lenker** i ${channel}.` });
      }

      await setLogChannel(client, interaction.guildId, destination, channel.id);

      return InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed(
          'Kanal oppdatert',
          `**${DESTINATION_LABELS[destination]}**-logger vil bli sendt til ${channel}.\nBruk \`/logging kontrollpanel\` for å slå av/på handlingskategorier.`, // Endret /logging dashboard til /logging kontrollpanel
        )],
      });
    } catch (error) {
      logger.error('logging_channel error:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Klarte ikke å oppdatere loggkanalen.' });
    }
  },
};