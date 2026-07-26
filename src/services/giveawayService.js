import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';
import { getColor, botConfig } from '../config/bot.js';
import { getEndedGiveaways, markGiveawayEnded } from '../utils/database.js';
import { checkRateLimit, getRateLimitStatus } from '../utils/rateLimiter.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';

const GIVEAWAY_CONFIG = botConfig.giveaways || {};
const GIVEAWAY_INTERACTION_COOLDOWN = 1000;

function getGiveawayInteractionKey(userId, giveawayId) {
    return `giveaway:${userId}:${giveawayId}`;
}

export function parseDuration(durationString) {
    if (!durationString || typeof durationString !== 'string') {
        throw new TitanBotError(
            'Ugyldig varighetsformat oppgitt',
            ErrorTypes.VALIDATION,
            'Vennligst oppgi en gyldig varighet (f.eks. 1h, 30m, 5d, 10s).',
            { durationString }
        );
    }

    const regex = /^(\d+)([hmds])$/i;
    const match = durationString.trim().match(regex);

    if (!match) {
        throw new TitanBotError(
            `Ugyldig varighetsformat: ${durationString}`,
            ErrorTypes.VALIDATION,
            'Ugyldig format. Bruk: 1h, 30m, 5d, 10s (min: 10s, maks: 30d)',
            { input: durationString }
        );
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (amount <= 0 || amount > 999) {
        throw new TitanBotError(
            `Varighetsverdi utenfor gyldig område: ${amount}`,
            ErrorTypes.VALIDATION,
            'Varighet må være mellom 1 og 999.',
            { amount, unit }
        );
    }

    let ms = 0;
    switch (unit) {
        case 's':
            ms = amount * 1000;
            break;
        case 'm':
            ms = amount * 60 * 1000;
            break;
        case 'h':
            ms = amount * 60 * 60 * 1000;
            break;
        case 'd':
            ms = amount * 24 * 60 * 60 * 1000;
            break;
        default:
            throw new TitanBotError(
                `Ukjent tidsenhet: ${unit}`,
                ErrorTypes.VALIDATION,
                'Bruk s (sekunder), m (minutter), h (timer) eller d (dager).',
                { unit }
            );
    }

    const maxDuration = GIVEAWAY_CONFIG.maximumDuration ?? 30 * 24 * 60 * 60 * 1000;
    if (ms > maxDuration) {
        throw new TitanBotError(
            `Varigheten overskrider maksimumsgrensen: ${ms}ms > ${maxDuration}ms`,
            ErrorTypes.VALIDATION,
            `Maksimal varighet er ${Math.floor(maxDuration / (24 * 60 * 60 * 1000))} dager.`,
            { requestedMs: ms, maxMs: maxDuration }
        );
    }

    const minDuration = GIVEAWAY_CONFIG.minimumDuration ?? 10 * 1000;
    if (ms < minDuration) {
        throw new TitanBotError(
            `Varigheten er under minstegrensen: ${ms}ms < ${minDuration}ms`,
            ErrorTypes.VALIDATION,
            `Minstegrense for varighet er ${Math.ceil(minDuration / 1000)} sekunder.`,
            { requestedMs: ms, minMs: minDuration }
        );
    }

    return ms;
}

export function validatePrize(prize) {
    if (!prize || typeof prize !== 'string') {
        throw new TitanBotError(
            'Premie må være en tekststreng',
            ErrorTypes.VALIDATION,
            'Vennligst oppgi en gyldig beskrivelse av premien.',
            { prize }
        );
    }

    const trimmed = prize.trim();
    if (trimmed.length === 0 || trimmed.length > 256) {
        throw new TitanBotError(
            `Lengden på premieteksten er ugyldig: ${trimmed.length}`,
            ErrorTypes.VALIDATION,
            'Premiebeskrivelsen må bestå av mellom 1 og 256 tegn.',
            { length: trimmed.length }
        );
    }

    return trimmed;
}

export function validateWinnerCount(winnerCount) {
    const minimumWinners = GIVEAWAY_CONFIG.minimumWinners ?? 1;
    const maximumWinners = GIVEAWAY_CONFIG.maximumWinners ?? 10;

    if (!Number.isInteger(winnerCount) || winnerCount < minimumWinners || winnerCount > maximumWinners) {
        throw new TitanBotError(
            `Ugyldig antall vinnere: ${winnerCount}`,
            ErrorTypes.VALIDATION,
            `Antall vinnere må være mellom ${minimumWinners} og ${maximumWinners}.`,
            { winnerCount, minimumWinners, maximumWinners }
        );
    }
}

export function createGiveawayEmbed(giveaway, status, winners = []) {
    try {
        const statusEmoji = status === 'ended' ? '🎉' : status === 'reroll' ? '🔄' : '🎉';
        const isEnded = status === 'ended' || status === 'reroll';
        const color = isEnded ? getColor('giveaway.ended') : getColor('giveaway.active');
        
        const embed = new EmbedBuilder()
            .setTitle(`${statusEmoji} ${giveaway.prize}`)
            .setDescription('Trykk på knappen nedenfor for å delta!')
            .setColor(color)
            .addFields(
                { name: '👤 Arrangeres av', value: `<@${giveaway.hostId}>`, inline: true },
                { name: '🏆 Vinnere', value: giveaway.winnerCount.toString(), inline: true },
                { name: '👥 Deltakere', value: giveaway.participants?.length?.toString() || '0', inline: true }
            );

        if (isEnded) {
            const winnerDisplay = winners.length > 0 
                ? winners.map(id => `<@${id}>`).join(', ')
                : 'Ingen gyldige deltakere';
            embed.addFields({ name: '🎯 Vinnere', value: winnerDisplay, inline: false });
        } else {
            const endTime = giveaway.endsAt || giveaway.endTime;
            embed.addFields({ name: '⏰ Slutter', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: false });
        }

        embed.setTimestamp();
        
        return embed;
    } catch (error) {
        logger.error('Feil ved opprettelse av giveaway-embed:', error);
        throw new TitanBotError(
            'Klarte ikke å opprette giveaway-embed',
            ErrorTypes.UNKNOWN,
            'Det oppstod en intern feil under formatering av konkurransen.',
            { error: error.message }
        );
    }
}

export function createGiveawayButtons(ended = false) {
    try {
        const row = new ActionRowBuilder();

        if (ended) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_reroll')
                    .setLabel('🎲 Trekk på nytt')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(false),
                new ButtonBuilder()
                    .setCustomId('giveaway_view')
                    .setLabel('👁️ Vis vinnere')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(false)
            );
        } else {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_join')
                    .setLabel('🎉 Bli med')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(false),
                new ButtonBuilder()
                    .setCustomId('giveaway_end')
                    .setLabel('🛑 Avslutt')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(false)
            );
        }

        return row;
    } catch (error) {
        logger.error('Feil ved opprettelse av giveaway-knapper:', error);
        throw new TitanBotError(
            'Klarte ikke å opprette intervaktive knapper',
            ErrorTypes.UNKNOWN,
            'Det oppstod en feil under opprettelsen av interaktive knapper.',
            { error: error.message }
        );
    }
}

export function selectWinners(participants, winnerCount) {
    if (!Array.isArray(participants) || participants.length === 0) {
        return [];
    }

    const uniqueParticipants = [...new Set(participants)];

    if (!Number.isInteger(winnerCount) || winnerCount < 1) {
        throw new TitanBotError(
            'Ugyldig vinnerantall for trekning',
            ErrorTypes.VALIDATION,
            'Antall vinnere må være minst 1.',
            { winnerCount }
        );
    }

    const requested = Math.min(winnerCount, uniqueParticipants.length);
    
    try {
        const shuffled = [...uniqueParticipants];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, requested);
    } catch (error) {
        logger.error('Feil ved uttrekking av vinnere:', error);
        throw new TitanBotError(
            'Klarte ikke å trekke vinnere',
            ErrorTypes.UNKNOWN,
            'En feil oppstod under trekning av vinnere.',
            { error: error.message, participantCount: participants.length }
        );
    }
}

export function isUserRateLimited(userId, giveawayId) {
    const status = getRateLimitStatus(
        getGiveawayInteractionKey(userId, giveawayId),
        GIVEAWAY_INTERACTION_COOLDOWN,
    );
    return status.attempts >= 1 && status.remaining > 0;
}

export async function recordUserInteraction(userId, giveawayId) {
    await checkRateLimit(
        getGiveawayInteractionKey(userId, giveawayId),
        1,
        GIVEAWAY_INTERACTION_COOLDOWN,
    );
}

export async function endGiveaway(client, giveaway, guildId, endedBy) {
    try {
        if (!giveaway) {
            throw new TitanBotError(
                'Giveaway-objektet er null eller udefinert',
                ErrorTypes.VALIDATION,
                'Kan ikke avslutte en konkurranse som ikke eksisterer.',
                { giveaway }
            );
        }

        if (giveaway.ended === true || giveaway.isEnded === true) {
            throw new TitanBotError(
                `Giveaway ${giveaway.messageId} er allerede avsluttet`,
                ErrorTypes.VALIDATION,
                'Denne konkurransen har allerede blitt avsluttet.',
                { giveawayId: giveaway.messageId, status: 'already_ended' }
            );
        }

        const participants = giveaway.participants || [];
        const winners = selectWinners(participants, giveaway.winnerCount || 1);

        const updatedGiveaway = {
            ...giveaway,
            ended: true,
            isEnded: true,
            winnerIds: winners,
            endedAt: new Date().toISOString(),
            endedBy: endedBy,
            participantCount: participants.length
        };

        logger.info(`Avslutter giveaway ${giveaway.messageId}: trakk ${winners.length} vinnere fra ${participants.length} deltakere`);

        return {
            giveaway: updatedGiveaway,
            winners: winners,
            participantCount: participants.length
        };
    } catch (error) {
        if (error instanceof TitanBotError) {
            logger.debug(`Valideringsfeil ved avsluttelse av giveaway: ${error.message}`, error.context || {});
            throw error;
        }
        logger.error('Feil ved avsluttelse av giveaway:', error);
        throw new TitanBotError(
            'Klarte ikke å avslutte giveaway',
            ErrorTypes.UNKNOWN,
            'Det oppstod en feil under avsluttelse av konkurransen.',
            { error: error.message, giveawayId: giveaway?.messageId }
        );
    }
}

export async function checkGiveaways(client) {
  try {
    if (!client.db) {
      logger.warn('Databasen er ikke tilgjengelig for sjekk av giveaways');
      return;
    }

    const endedGiveaways = await getEndedGiveaways(client);
    
    if (endedGiveaways.length === 0) {
      return;
    }

    logger.info(`Behandler ${endedGiveaways.length} fullførte giveaways`);

    for (const giveawayRecord of endedGiveaways) {
      try {
        const { id: giveawayId, guild_id: guildId, message_id: messageId, data: giveawayData } = giveawayRecord;
        const giveaway = typeof giveawayData === 'string' ? JSON.parse(giveawayData) : giveawayData;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          logger.debug(`Server ${guildId} ikke funnet, hopper over giveaway ${messageId}`);
          continue;
        }

        const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
        if (!channel) {
          logger.debug(`Kanal ${giveaway.channelId} ikke funnet for giveaway ${messageId}`);
          continue;
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
          logger.debug(`Melding ${messageId} ikke funnet i kanal ${giveaway.channelId}`);
          continue;
        }

        const participants = giveaway.participants || [];
        const winners = selectWinners(participants, giveaway.winnerCount || 1);

        const winnerMentions = winners.length > 0
          ? winners.map(id => `<@${id}>`).join(', ')
          : 'Ingen gyldige deltakere!';

        const endedEmbed = createGiveawayEmbed(giveaway, 'ended', winners);

        await message.edit({
          embeds: [endedEmbed],
          components: [createGiveawayButtons(true)]
        });

        giveaway.ended = true;
        giveaway.isEnded = true;
        giveaway.winnerIds = winners;
        giveaway.endedAt = new Date().toISOString();

        const markedSuccess = await markGiveawayEnded(client, giveawayId, giveaway);
        if (!markedSuccess) {
          logger.warn(`Klarte ikke å markere giveaway ${messageId} som fullført i databasen`);
        }

        if (winners.length > 0) {
          const winnerAnnouncement = `🎉 Gratulerer ${winnerMentions}! Du/dere vant **${giveaway.prize || 'konkurransen'}**! Ta kontakt med <@${giveaway.hostId}> for å hente premien.`;
          const winnerPingMsg = await channel.send({ content: winnerAnnouncement });
          giveaway.winnerPingMessageId = winnerPingMsg.id;
          await markGiveawayEnded(client, giveawayId, giveaway);

          try {
            await logEvent({
              client,
              guildId,
              eventType: EVENT_TYPES.GIVEAWAY_WINNER,
              data: {
                description: `Giveaway avsluttet med ${winners.length} vinner(e)`,
                channelId: channel.id,
                fields: [
                  {
                    name: '🎁 Premie',
                    value: giveaway.prize || 'Ukjent premie!',
                    inline: true
                  },
                  {
                    name: '🏆 Vinnere',
                    value: winners.map(id => `<@${id}>`).join(', '),
                    inline: false
                  },
                  {
                    name: '👥 Deltakere',
                    value: participants.length.toString(),
                    inline: true
                  }
                ]
              }
            });
          } catch (error) {
            logger.debug('Feil under logging av giveaway-vinner:', error);
          }
        } else {
          await channel.send({ content: `Konkurransen om **${giveaway.prize}** er avsluttet uten gyldige deltakere.` });
        }

        logger.info(`Avsluttet giveaway ${messageId} på server ${guildId}`);
      } catch (error) {
        logger.error(`Feil ved behandling av giveaway:`, error);
      }
    }
  } catch (error) {
    logger.error('Feil under kontroll av giveaways:', error);
  }
}