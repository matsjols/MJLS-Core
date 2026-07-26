import { getGuildConfig } from './config/guildConfig.js';
import { getGuildBirthdays, setBirthday as dbSetBirthday, deleteBirthday as dbDeleteBirthday, getMonthName, getBirthdayTrackingKey } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';

export function validateBirthday(month, day) {
  if (typeof month !== 'number' || typeof day !== 'number') {
    return {
      isValid: false,
      error: 'Måned og dag må være tall'
    };
  }

  if (month < 1 || month > 12) {
    return {
      isValid: false,
      error: 'Måned må være mellom 1 og 12'
    };
  }

  if (day < 1 || day > 31) {
    return {
      isValid: false,
      error: 'Dag må være mellom 1 og 31'
    };
  }

  const currentYear = new Date().getFullYear();
  const date = new Date(currentYear, month - 1, day);
  
  if (isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return {
      isValid: false,
      error: 'Ugyldig dato. Sjekk at kombinasjonen av måned og dag er korrekt (f.eks. finnes 29. februar kun i skuddår).'
    };
  }

  return { isValid: true };
}

export async function setBirthday(client, guildId, userId, month, day) {
  try {
    const validation = validateBirthday(month, day);
    if (!validation.isValid) {
      logger.warn('Validering av fødselsdag mislyktes', {
        userId,
        guildId,
        month,
        day,
        error: validation.error
      });
      
      throw new TitanBotError(
        validation.error,
        ErrorTypes.VALIDATION,
        validation.error,
        { month, day, userId, guildId }
      );
    }

    const success = await dbSetBirthday(client, guildId, userId, month, day);
    
    if (!success) {
      throw new TitanBotError(
        'Klarte ikke å lagre fødselsdag i databasen',
        ErrorTypes.DATABASE,
        'Klarte ikke å registrere fødselsdagen din. Vennligst prøv igjen senere.',
        { userId, guildId, month, day }
      );
    }

    logger.info('Fødselsdag registrert', {
      userId,
      guildId,
      month,
      day,
      monthName: getMonthName(month)
    });

    return {
      data: {
        month,
        day,
        monthName: getMonthName(month)
      }
    };
  } catch (error) {
    logger.error('Feil i setBirthday-tjenesten', {
      error: error.message,
      stack: error.stack,
      userId,
      guildId,
      month,
      day
    });
    
    throw error;
  }
}

export async function getUserBirthday(client, guildId, userId) {
  try {
    const birthdays = await getGuildBirthdays(client, guildId);
    const birthdayData = birthdays[userId];
    
    if (!birthdayData) {
      return null;
    }

    return {
      month: birthdayData.month,
      day: birthdayData.day,
      monthName: getMonthName(birthdayData.month)
    };
  } catch (error) {
    logger.error('Feil i getUserBirthday-tjenesten', {
      error: error.message,
      userId,
      guildId
    });
    throw error;
  }
}

export async function getAllBirthdays(client, guildId) {
  try {
    const birthdays = await getGuildBirthdays(client, guildId);
    
    if (!birthdays || Object.keys(birthdays).length === 0) {
      return [];
    }

    const sortedBirthdays = Object.entries(birthdays)
      .map(([userId, data]) => ({
        userId,
        month: data.month,
        day: data.day,
        monthName: getMonthName(data.month)
      }))
      .sort((a, b) => {
        if (a.month !== b.month) return a.month - b.month;
        return a.day - b.day;
      });

    return sortedBirthdays;
  } catch (error) {
    logger.error('Feil i getAllBirthdays-tjenesten', {
      error: error.message,
      guildId
    });
    throw error;
  }
}

export async function deleteBirthday(client, guildId, userId) {
  try {
    const birthday = await getUserBirthday(client, guildId, userId);
    
    if (!birthday) {
      return {
        status: 'not_found',
      };
    }

    const success = await dbDeleteBirthday(client, guildId, userId);
    
    if (!success) {
      throw new TitanBotError(
        'Klarte ikke å slette fødselsdag fra databasen',
        ErrorTypes.DATABASE,
        'Klarte ikke å fjerne fødselsdagen din. Vennligst prøv igjen.',
        { userId, guildId }
      );
    }

    logger.info('Fødselsdag fjernet', {
      userId,
      guildId
    });

    return {
      status: 'removed',
    };
  } catch (error) {
    logger.error('Feil i deleteBirthday-tjenesten', {
      error: error.message,
      userId,
      guildId
    });
    throw error;
  }
}

export async function getUpcomingBirthdays(client, guildId, limit = 5) {
  try {
    const birthdays = await getGuildBirthdays(client, guildId);
    
    if (!birthdays || Object.keys(birthdays).length === 0) {
      return [];
    }

    const today = new Date();
    const currentYear = today.getFullYear();
    
    const upcomingBirthdays = [];
    
    for (const [userId, userData] of Object.entries(birthdays)) {
      let nextBirthday = new Date(currentYear, userData.month - 1, userData.day);

      if (nextBirthday < today) {
        nextBirthday = new Date(currentYear + 1, userData.month - 1, userData.day);
      }
      
      const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
      
      upcomingBirthdays.push({
        userId,
        month: userData.month,
        day: userData.day,
        monthName: getMonthName(userData.month),
        date: nextBirthday,
        daysUntil
      });
    }

    upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil);

    return upcomingBirthdays.slice(0, limit);
  } catch (error) {
    logger.error('Feil i getUpcomingBirthdays-tjenesten', {
      error: error.message,
      guildId,
      limit
    });
    throw error;
  }
}

export async function getTodaysBirthdays(client, guildId) {
  try {
    const birthdays = await getGuildBirthdays(client, guildId);
    const today = new Date();
    const currentMonth = today.getUTCMonth() + 1;
    const currentDay = today.getUTCDate();

    const todaysBirthdays = [];

    for (const [userId, userData] of Object.entries(birthdays)) {
      if (userData.month === currentMonth && userData.day === currentDay) {
        todaysBirthdays.push({
          userId,
          month: userData.month,
          day: userData.day,
          monthName: getMonthName(userData.month)
        });
      }
    }

    return todaysBirthdays;
  } catch (error) {
    logger.error('Feil i getTodaysBirthdays-tjenesten', {
      error: error.message,
      guildId
    });
    throw error;
  }
}

export async function checkBirthdays(client) {
  const today = new Date();
  const currentMonth = today.getUTCMonth() + 1;
  const currentDay = today.getUTCDate();

  if (process.env.NODE_ENV !== 'production') {
    logger.debug(`🎂 Kjører daglig fødselsdagsjekk for UTC: ${currentMonth}/${currentDay}.`);
  }

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const config = await getGuildConfig(client, guildId);
      const { birthdayChannelId, birthdayRoleId } = config;

      if (!birthdayChannelId) {
        if (process.env.NODE_ENV !== 'production') {
          logger.debug(`Hopper over fødselsdagsjekk for ${guild.name}: Mangler kanal-konfigurasjon.`);
        }
        continue;
      }

      const channel = await guild.channels.fetch(birthdayChannelId).catch(() => null);
      if (!channel) continue;

      const trackingKey = getBirthdayTrackingKey(guildId);
      const trackingData = (await client.db.get(trackingKey)) || {};
      const updatedTrackingData = { ...trackingData };
      
      for (const userId of Object.keys(trackingData)) {
        try {
          if (birthdayRoleId) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member && member.roles.cache.has(birthdayRoleId)) {
              await member.roles.remove(birthdayRoleId, "Fødselsdagsrolle utløpt");
            }
          }
          delete updatedTrackingData[userId];
        } catch (error) {
           logger.error(`Feil ved fjerning av fødselsdagsrolle fra ${userId}:`, error);
        }
      }

      if (Object.keys(updatedTrackingData).length !== Object.keys(trackingData).length) {
        await client.db.set(trackingKey, updatedTrackingData);
      }

      const birthdays = (await getGuildBirthdays(client, guildId)) || {};
      const birthdayMembers = [];
      for (const [userId, userData] of Object.entries(birthdays)) {
        if (userData.month === currentMonth && userData.day === currentDay) {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            birthdayMembers.push(member);
            if (birthdayRoleId) {
              try {
                await member.roles.add(birthdayRoleId, "Gratulerer med dagen! 🎉");
                updatedTrackingData[userId] = true;
              } catch (error) {
                  logger.error(`Feil ved tildeling av fødselsdagsrolle til ${member.user.tag}:`, error);
              }
            }
          }
        }
      }

      if (birthdayMembers.length > 0) {
        await client.db.set(trackingKey, updatedTrackingData);
        const mentionList = birthdayMembers.map(m => m.toString()).join(', ');
        
        await channel.send({
          embeds: [{
            title: '🎉 Gratulerer med dagen! 🎂',
            description: `En ekstra hyggelig gratulasjon går til ${mentionList}! Håper du får en fantastisk dag! 🎈`,
            color: 0xff69b4,
            footer: { text: 'Fødselsdagsbot' },
            timestamp: new Date()
          }]
        });
      }
    } catch (error) {
      logger.error(`Feil ved behandling av fødselsdager for server ${guildId}:`, error);
    }
  }
}