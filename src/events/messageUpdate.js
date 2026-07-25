import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { formatLogLine } from '../utils/logging/logEmbeds.js';

const MAX_LOGGED_EDIT_CONTENT_LENGTH = 512;

export default {
  name: Events.MessageUpdate,
  once: false,

  async execute(oldMessage, newMessage) {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;

      if (oldMessage.content === newMessage.content) return;

      const metaLines = [
        formatLogLine('Kanal', newMessage.channel ? `${newMessage.channel.name} ${newMessage.channel.toString()}` : 'Ukjent'),
        formatLogLine('Meldings-ID', `\`${newMessage.id}\``),
        formatLogLine('Meldingsforfatter', newMessage.author ? newMessage.author.toString() : 'Ukjent'),
        formatLogLine('Melding opprettet', `<t:${Math.floor(newMessage.createdTimestamp / 1000)}:R>`),
      ];

      const oldContent = oldMessage.content || '*(tom melding)*';
      const newContent = newMessage.content || '*(tom melding)*';
      const oldContentTruncated = oldContent.length > MAX_LOGGED_EDIT_CONTENT_LENGTH
        ? `${oldContent.substring(0, MAX_LOGGED_EDIT_CONTENT_LENGTH - 3)}...`
        : oldContent;
      const newContentTruncated = newContent.length > MAX_LOGGED_EDIT_CONTENT_LENGTH
        ? `${newContent.substring(0, MAX_LOGGED_EDIT_CONTENT_LENGTH - 3)}...`
        : newContent;

      await logEvent({
        client: newMessage.client,
        guildId: newMessage.guild.id,
        eventType: EVENT_TYPES.MESSAGE_EDIT,
        data: {
          title: 'Melding redigert',
          lines: metaLines,
          quoted: true,
          fields: [
            { name: 'Før', value: oldContentTruncated, inline: true },
            { name: 'Etter', value: newContentTruncated, inline: true },
          ],
          userId: newMessage.author?.id,
          channelId: newMessage.channel.id,
        }
      });

    } catch (error) {
      logger.error('Error in messageUpdate event:', error);
    }
  }
};