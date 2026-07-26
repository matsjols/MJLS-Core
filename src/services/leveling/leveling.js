import { EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig, setGuildConfig } from '../config/guildConfig.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { addXp } from './xpSystem.js';
import { getUserLevelKey } from '../../utils/database/keys.js';

const BASE_XP = 100;
const XP_MULTIPLIER = 1.5;
const MAX_LEVEL = 1000;
const MIN_LEVEL = 0;

export function getXpForLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    throw new TitanBotError(
      `Ugyldig level: ${level}. Må være mellom ${MIN_LEVEL} og ${MAX_LEVEL}`,
      ErrorTypes.VALIDATION,
      'Nivået må være et gyldig tall.'
    );
  }
  return 5 * Math.pow(level, 2) + 50 * level + 50;
}

export function getLevelFromXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new TitanBotError(
      `Ugyldig XP: ${xp}`,
      ErrorTypes.VALIDATION,
      'XP må være et positivt tall eller 0.'
    );
  }

  let level = 0;
  let xpNeeded = 0;
  
  while (xp >= getXpForLevel(level) && level < MAX_LEVEL) {
    xpNeeded = getXpForLevel(level);
    xp -= xpNeeded;
    level++;
  }
  
  return {
    level: Math.min(level, MAX_LEVEL),
    currentXp: xp,
    xpNeeded: getXpForLevel(Math.min(level, MAX_LEVEL))
  };
}

export function calculateTotalXp(level, currentXp = 0) {
  let total = currentXp;
  for (let i = 0; i < level; i++) {
    total += getXpForLevel(i);
  }
  return total;
}

export async function getLeaderboard(client, guildId, limit = 10) {
  try {
    
    if (!guildId || typeof guildId !== 'string') {
      throw new TitanBotError(
        'Ugyldig server-ID',
        ErrorTypes.VALIDATION,
        'Server-ID er påkrevd.'
      );
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      limit = Math.min(Math.max(limit, 1), 100);
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Server ${guildId} ble ikke funnet i cachen`);
      return [];
    }
    
    const members = await guild.members.fetch().catch(error => {
      logger.error(`Kunne ikke hente medlemmer for server ${guildId}:`, error);
      return new Map();
    });

    const leaderboard = [];
    
    for (const [userId, member] of members) {
      if (member.user.bot) continue;
      
      const data = await getUserLevelData(client, guildId, userId);
      if (data && (data.totalXp > 0 || data.level > 0)) {
        leaderboard.push({
          userId,
          username: member.user.username,
          discriminator: member.user.discriminator,
          ...data
        });
      }
    }
    
    leaderboard.sort((a, b) => b.totalXp - a.totalXp);
    
    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });
    
    return leaderboard.slice(0, limit);
    
  } catch (error) {
    logger.error('Feil ved henting av toppliste:', error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Kunne ikke hente toppliste: ${error.message}`,
      ErrorTypes.DATABASE,
      'Kunne ikke hente topplisten akkurat nå.'
    );
  }
}

export function createLeaderboardEmbed(leaderboard, guild) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Toppliste for ${guild.name}`)
    .setColor('#2ecc71')
    .setTimestamp();
    
  if (!leaderboard || leaderboard.length === 0) {
    embed.setDescription('Ingen brukere på topplisten enda!');
    return embed;
  }
  
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  
  const top3Text = top3.map((user, index) => {
    const medal = ['🥇', '🥈', '🥉'][index];
    return `${medal} **#${user.rank}** ${user.username} - Level ${user.level} (${user.totalXp} XP)`;
  }).join('\n');
  
  const restText = rest.map(user => {
    return `**#${user.rank}** ${user.username} - Level ${user.level} (${user.totalXp} XP)`;
  }).join('\n');
  
  embed.setDescription(
    `**Toppmedlemmer**\n${top3Text}${restText ? '\n\n' + restText : ''}`
  );
  
  return embed;
}

export async function getLevelingConfig(client, guildId) {
  try {
    const guildConfig = await getGuildConfig(client, guildId);
    return guildConfig.leveling || {
      enabled: true,
      xpPerMessage: { min: 15, max: 25 },
      xpCooldown: 20,
      levelUpMessage: '{user} har nått level {level}!',
      levelUpChannel: null,
      ignoredChannels: [],
      ignoredRoles: [],
      blacklistedUsers: [],
      roleRewards: {},
      announceLevelUp: true,
      xpMultiplier: 1
    };
  } catch (error) {
    logger.error(`Feil ved henting av leveling-konfigurasjon for server ${guildId}:`, error);
    return {
      enabled: true,
      xpPerMessage: { min: 15, max: 25 },
      xpCooldown: 20,
      levelUpMessage: '{user} har nått level {level}!',
      levelUpChannel: null,
      ignoredChannels: [],
      ignoredRoles: [],
      blacklistedUsers: [],
      roleRewards: {},
      announceLevelUp: true,
      xpMultiplier: 1
    };
  }
}

export async function getUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Server-ID og bruker-ID er påkrevd',
        ErrorTypes.VALIDATION
      );
    }

    const key = getUserLevelKey(guildId, userId);
    const data = await client.db.get(key);
    
    if (!data) {
      return {
        xp: 0,
        level: 0,
        totalXp: 0,
        lastMessage: 0,
        rank: 0
      };
    }
    
    return {
      xp: Math.max(0, data.xp || 0),
      level: Math.max(0, Math.min(data.level || 0, MAX_LEVEL)),
      totalXp: Math.max(0, data.totalXp || 0),
      lastMessage: data.lastMessage || 0,
      rank: data.rank || 0
    };
  } catch (error) {
    logger.error(`Feil ved henting av level-data for bruker ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Kunne ikke hente brukerdata: ${error.message}`,
      ErrorTypes.DATABASE,
      'Kunne ikke hente level-data akkurat nå.'
    );
  }
}

export async function saveUserLevelData(client, guildId, userId, data) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Server-ID og bruker-ID er påkrevd',
        ErrorTypes.VALIDATION
      );
    }

    if (!data || typeof data !== 'object') {
      throw new TitanBotError(
        'Ugyldig bruker level-data',
        ErrorTypes.VALIDATION
      );
    }

    const sanitizedData = {
      xp: Math.max(0, Number(data.xp) || 0),
      level: Math.max(0, Math.min(Number(data.level) || 0, MAX_LEVEL)),
      totalXp: Math.max(0, Number(data.totalXp) || 0),
      lastMessage: Number(data.lastMessage) || 0,
      rank: Number(data.rank) || 0
    };

    const key = getUserLevelKey(guildId, userId);
    await client.db.set(key, sanitizedData);
  } catch (error) {
    logger.error(`Feil ved lagring av level-data for bruker ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Kunne ikke lagre brukerdata: ${error.message}`,
      ErrorTypes.DATABASE,
      'Kunne ikke lagre level-data akkurat nå.'
    );
  }
}

export async function saveLevelingConfig(client, guildId, config) {
  try {
    if (!guildId || !config) {
      throw new TitanBotError(
        'Server-ID og konfigurasjon er påkrevd',
        ErrorTypes.VALIDATION
      );
    }

    const guildConfig = await getGuildConfig(client, guildId);

    if (config.xpCooldown && (config.xpCooldown < 0 || config.xpCooldown > 3600)) {
      throw new TitanBotError(
        'XP-nedtelling må være mellom 0 og 3600 sekunder',
        ErrorTypes.VALIDATION,
        'Nedtellingen må være mellom 0 og 3600 sekunder.'
      );
    }

    if (config.xpRange && (config.xpRange.min < 1 || config.xpRange.max < 1 || config.xpRange.min > config.xpRange.max)) {
      throw new TitanBotError(
        'Ugyldig konfigurasjon for XP-område',
        ErrorTypes.VALIDATION,
        'Minimum XP må være mindre enn maksimum XP, og begge må være positive tall.'
      );
    }

    guildConfig.leveling = config;
    await setGuildConfig(client, guildId, guildConfig);
    
    logger.info(`Leveling-konfigurasjon oppdatert for server ${guildId}`);
  } catch (error) {
    logger.error(`Feil ved lagring av leveling-konfigurasjon for server ${guildId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Kunne ikke lagre konfigurasjon: ${error.message}`,
      ErrorTypes.DATABASE,
      'Kunne ikke lagre konfigurasjonen akkurat nå.'
    );
  }
}

export async function addLevels(client, guildId, userId, levels) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling-systemet er deaktivert på denne serveren',
        ErrorTypes.CONFIGURATION,
        'Leveling-systemet er for øyeblikket deaktivert på denne serveren.'
      );
    }

    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError(
        `Ugyldig antall levels: ${levels}`,
        ErrorTypes.VALIDATION,
        'Du må legge til et positivt antall levels.'
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const newLevel = userData.level + levels;

    if (newLevel > MAX_LEVEL) {
      throw new TitanBotError(
        `Level ${newLevel} overskrider maks level ${MAX_LEVEL}`,
        ErrorTypes.VALIDATION,
        `Maksimalt level er ${MAX_LEVEL}.`
      );
    }

    const newXp = 0;
    const newTotalXp = calculateTotalXp(newLevel, newXp);

    userData.level = newLevel;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`La til ${levels} levels for bruker ${userId} i server ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Feil ved tillegg av levels for bruker ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Kunne ikke legge til levels: ${error.message}`,
      ErrorTypes.DATABASE,
      'Kunne ikke legge til levels akkurat nå.'
    );
  }
}

export async function removeLevels(client, guildId, userId, levels) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling-systemet er deaktivert på denne serveren',
        ErrorTypes.CONFIGURATION,
        'Leveling-systemet er for øyeblikket deaktivert på denne serveren.'
      );
    }

    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError(
        `Ugyldig antall levels: ${levels}`,
        ErrorTypes.VALIDATION,
        'Du må fjerne et positivt antall levels.'
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const newLevel = Math.max(MIN_LEVEL, userData.level - levels);

    const newXp = 0;
    const newTotalXp = calculateTotalXp(newLevel, newXp);

    userData.level = newLevel;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Fjernet ${levels} levels fra bruker ${userId} i server ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Feil ved fjerning av levels for bruker ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Kunne ikke fjerne levels: ${error.message}`,
      ErrorTypes.DATABASE,
      'Kunne ikke fjerne levels akkurat nå.'
    );
  }
}

export async function setUserLevel(client, guildId, userId, level) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling-systemet er deaktivert på denne serveren',
        ErrorTypes.CONFIGURATION,
        'Leveling-systemet er for øyeblikket deaktivert på denne serveren.'
      );
    }

    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      throw new TitanBotError(
        `Ugyldig level: ${level}`,
        ErrorTypes.VALIDATION,
        `Level må være mellom ${MIN_LEVEL} og ${MAX_LEVEL}.`
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    
    const newXp = 0;
    const newTotalXp = calculateTotalXp(level, newXp);

    userData.level = level;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Satte level for bruker ${userId} til ${level} i server ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Feil ved setting av level for bruker ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Kunne ikke sette level: ${error.message}`,
      ErrorTypes.DATABASE,
      'Kunne ikke sette level akkurat nå.'
    );
  }
}

export async function deleteUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Server-ID og bruker-ID er påkrevd',
        ErrorTypes.VALIDATION
      );
    }

    const key = getUserLevelKey(guildId, userId);
    await client.db.delete(key);
    
    logger.debug(`Slettet level-data for bruker ${userId} i server ${guildId}`);
  } catch (error) {
    logger.error(`Feil ved sletting av level-data for bruker ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    logger.warn(`Kunne ikke slette level-data for bruker ${userId} i server ${guildId}`);
  }
}