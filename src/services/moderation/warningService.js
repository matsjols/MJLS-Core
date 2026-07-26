import { db, getFromDb, setInDb, getWarningsKey, getWarningsPrefix } from '../../utils/database.js';
import { logger } from '../../utils/logger.js';
import { createError, ErrorTypes, wrapServiceClassMethods } from '../../utils/errorHandler.js';

class WarningService {

  static async addWarning({
    guildId,
    userId,
    moderatorId,
    reason,
    timestamp = Date.now()
  }) {
    const key = getWarningsKey(guildId, userId);
    const warnings = await getFromDb(key, []);

    if (!Array.isArray(warnings)) {
      logger.warn(`Advarsler for ${userId} i ${guildId} er korrupte, tilbakestiller`);
      await setInDb(key, []);
      throw createError(
        'Korrupte advarselsdata',
        ErrorTypes.DATABASE,
        'Advarselsdata var korrupt og har blitt tilbakestilt. Vennligst prøv igjen.',
        { guildId, userId, service: 'warningService', operation: 'addWarning' }
      );
    }

    const warning = {
      id: Date.now(),
      guildId,
      userId,
      moderatorId,
      reason,
      timestamp,
      status: 'active'
    };

    warnings.push(warning);
    await setInDb(key, warnings);

    logger.info(`Advarsel lagt til: ${userId} i ${guildId} av ${moderatorId}`);

    return {
      id: warning.id,
      totalCount: warnings.length
    };
  }

  static async getWarnings(guildId, userId) {
    const key = getWarningsKey(guildId, userId);
    const warnings = await getFromDb(key, []);

    return Array.isArray(warnings)
      ? warnings.filter(w => w && w.status !== 'deleted')
      : [];
  }

  static async getWarningCount(guildId, userId) {
    const warnings = await this.getWarnings(guildId, userId);
    return warnings.length;
  }

  static async removeWarning(guildId, userId, warningId) {
    const key = getWarningsKey(guildId, userId);
    const warnings = await getFromDb(key, []);

    const index = warnings.findIndex(w => w.id === warningId);
    if (index === -1) {
      throw createError(
        'Advarsel ikke funnet',
        ErrorTypes.USER_INPUT,
        'Finner ikke den advarselen. Den kan allerede ha blitt fjernet.',
        { guildId, userId, warningId, service: 'warningService', operation: 'removeWarning' }
      );
    }

    warnings[index].status = 'deleted';
    await setInDb(key, warnings);

    logger.info(`Advarsel fjernet: ${warningId} for ${userId} i ${guildId}`);
    return { removed: true };
  }

  static async clearWarnings(guildId, userId) {
    const key = getWarningsKey(guildId, userId);
    const warnings = await getFromDb(key, []);
    const count = warnings.length;

    await setInDb(key, []);

    logger.info(`Advarsler slettet for ${userId} i ${guildId} (${count} fjernet)`);
    return { count };
  }

  static async getGuildWarnings(guildId, filters = {}) {
    const { moderatorId, limit = 100 } = filters;
    const prefix = getWarningsPrefix(guildId);

    const keys = await db.list(prefix);
    const allWarnings = [];

    for (const key of Array.isArray(keys) ? keys : []) {
      const warnings = await getFromDb(key, []);
      if (!Array.isArray(warnings)) continue;

      for (const warning of warnings) {
        if (!warning || warning.status === 'deleted') continue;
        if (moderatorId && warning.moderatorId !== moderatorId) continue;
        allWarnings.push(warning);
      }
    }

    allWarnings.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    logger.debug(`Hentet serveradvarsler for ${guildId} med totalt ${allWarnings.length}`);
    return allWarnings.slice(0, limit);
  }
}

wrapServiceClassMethods(WarningService);

export { WarningService };