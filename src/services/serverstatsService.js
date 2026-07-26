import { logger } from '../utils/logger.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { formatLogLine } from '../utils/logging/logEmbeds.js';
import { getServerCountersKey } from '../utils/database/keys.js';
import botConfig from '../config/bot.js';

export const COUNTER_TYPE_CONFIG = {
  members: {
    label: 'Medlemmer + Bots',
    baseName: 'Totalt',
    emoji: '👥'
  },
  members_only: {
    label: 'Kun Medlemmer',
    baseName: 'Medlemmer',
    emoji: '👤'
  },
  bots: {
    label: 'Kun Bots',
    baseName: 'Bots',
    emoji: '🤖'
  }
};

function getCounterConfig(type) {
  return COUNTER_TYPE_CONFIG[type] || {
    label: 'Ukjent',
    baseName: 'Teller',
    emoji: '❓'
  };
}

export function getCounterTypeLabel(type) {
  return getCounterConfig(type).label;
}

export function getCounterBaseName(type) {
  return getCounterConfig(type).baseName;
}

export function getCounterEmoji(type) {
  return getCounterConfig(type).emoji;
}

export function formatCounterChannelName(type, count) {
  const config = getCounterConfig(type);
  const formattedCount = typeof count === 'number' ? count.toLocaleString('no-NO') : count;
  const template = botConfig.counters?.defaults?.channelName || '{emoji}︱{name} ❯ {count}';

  return template
    .replaceAll('{emoji}', config.emoji)
    .replaceAll('{name}', config.baseName)
    .replaceAll('{count}', String(formattedCount));
}

export function getCounterActionMessage(action, values = {}) {
  const template = botConfig.counters?.messages?.[action];
  if (!template) {
    return null;
  }

  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export async function getGuildCounterStats(guild) {
  let memberCollection = guild.members.cache;

  try {
    memberCollection = await guild.members.fetch();
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Kunne ikke hente alle servermedlemmer for ${guild.id}, bruker kun hurtigbuffer`, error);
    }
  }

  const botCount = memberCollection.filter((member) => member.user.bot).size;
  const totalCount = typeof guild.memberCount === 'number' ? guild.memberCount : memberCollection.size;
  const humanCount = Math.max(totalCount - botCount, 0);

  return {
    totalCount,
    botCount,
    humanCount
  };
}

export async function getCounterCount(guild, type) {
  const stats = await getGuildCounterStats(guild);

  switch (type) {
    case 'members':
      return stats.totalCount;
    case 'bots':
      return stats.botCount;
    case 'members_only':
      return stats.humanCount;
    default:
      return null;
  }
}

function isValidCounterShape(counter) {
  return Boolean(
    counter &&
    typeof counter === 'object' &&
    typeof counter.id === 'string' &&
    counter.id.length > 0 &&
    typeof counter.type === 'string' &&
    typeof counter.channelId === 'string' &&
    counter.channelId.length > 0
  );
}

function normalizeCounter(counter, guildId) {
  const normalized = {
    id: String(counter.id),
    type: String(counter.type),
    channelId: String(counter.channelId),
    guildId: String(counter.guildId || guildId),
    createdAt: counter.createdAt || new Date().toISOString(),
    enabled: typeof counter.enabled === 'boolean' ? counter.enabled : true
  };

  if (counter.updatedAt) {
    normalized.updatedAt = counter.updatedAt;
  }

  return normalized;
}

function sanitizeCounters(counters, guildId) {
  if (!Array.isArray(counters)) {
    return [];
  }

  return counters
    .filter(isValidCounterShape)
    .map(counter => normalizeCounter(counter, guildId));
}

export async function updateCounter(client, guild, counter) {
  try {
    if (!counter || !counter.type || !counter.channelId) {
      logger.warn('Hopper over ugyldig teller i updateCounter:', counter);
      return false;
    }
    
    const { type, channelId } = counter;
    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
      try {
        channel = await guild.channels.fetch(channelId);
      } catch {
        channel = null;
      }
    }
    if (!channel) {
      logger.warn(`Tellerkanal ${channelId} ble ikke funnet i server ${guild.id}, hopper over oppdatering`);
      return false;
    }

    const count = await getCounterCount(guild, type);
    if (count === null) {
      logger.error('Ukjent tellertype:', type);
      return false;
    }

    const baseName = getCounterBaseName(type);
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Basenavn: "${baseName}", Nåværende navn: "${channel.name}"`);
    }
    
    const newName = formatCounterChannelName(type, count);
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Nytt navn vil bli: "${newName}"`);
    }
    
    if (channel.name !== newName) {
      try {
        await channel.setName(newName);
        if (process.env.NODE_ENV !== 'production') {
          logger.debug(`Oppdaterte kanalnavn til: "${newName}"`);
        }

        try {
          await logEvent({
            client,
            guildId: guild.id,
            eventType: EVENT_TYPES.COUNTER_UPDATE,
            data: {
              title: 'Teller oppdatert',
              lines: [
                formatLogLine('Type', getCounterTypeLabel(type)),
                formatLogLine('Antall', count.toString()),
                formatLogLine('Kanal', channel.toString()),
              ],
              channelId: channel.id,
            },
          });
        } catch (error) {
          logger.debug('Feil ved logging av telleroppdatering:', error);
        }

      } catch (error) {
        logger.error(`Kunne ikke oppdatere kanalnavn for ${channel.id}:`, error);
        return false;
      }
    } else {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('Kanalnavnet er allerede korrekt, ingen oppdatering nødvendig');
      }
    }
    return true;
  } catch (error) {
    logger.error("Feil ved oppdatering av teller:", error);
    return false;
  }
}

export async function getServerCounters(client, guildId) {
  try {
    if (!client || !client.db) {
      logger.warn('Databasen er ikke tilgjengelig for getServerCounters');
      return [];
    }
    
    const data = await client.db.get(getServerCountersKey(guildId));
    
    let counters = [];
    
    if (data && typeof data === 'object' && data.ok && Array.isArray(data.value)) {
      counters = data.value;
    } else if (Array.isArray(data)) {
      counters = data;
    } else if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        counters = Array.isArray(parsed) ? parsed : [];
      } catch {
        counters = [];
      }
    } else if (data && typeof data === 'object' && !data.ok && isValidCounterShape(data)) {
      counters = [data];
    } else {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('Ingen tellermeldinger funnet, returnerer tom matrise');
      }
      return [];
    }

    return sanitizeCounters(counters, guildId);
  } catch (error) {
    logger.error("Feil ved henting av servertellere:", error);
    return [];
  }
}

export async function saveServerCounters(client, guildId, counters) {
  try {
    if (!client || !client.db) {
      logger.warn('Databasen er ikke tilgjengelig for saveServerCounters');
      return false;
    }
    
    const sanitizedCounters = sanitizeCounters(counters, guildId);

    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Lagrer ${sanitizedCounters.length} tellere for server ${guildId}:`, sanitizedCounters);
    }

    await client.db.set(getServerCountersKey(guildId), sanitizedCounters);
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('Tellere ble lagret');
    }
    return true;
  } catch (error) {
    logger.error("Feil ved lagring av servertellere:", error);
    return false;
  }
}