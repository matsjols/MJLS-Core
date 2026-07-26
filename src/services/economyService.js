import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData, getMaxBankCapacity } from '../utils/economy.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { wrapServiceClassMethods } from '../utils/serviceErrorBoundary.js';

class EconomyService {

  static DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
  static WORK_COOLDOWN = 30 * 60 * 1000;
  static GAMBLE_COOLDOWN = 5 * 60 * 1000;
  static CRIME_COOLDOWN = 60 * 60 * 1000;
  static ROB_COOLDOWN = 4 * 60 * 60 * 1000;
  static MINE_COOLDOWN = 60 * 60 * 1000;
  static FISH_COOLDOWN = 45 * 60 * 1000;
  static BEG_COOLDOWN = 30 * 60 * 1000;
  
  static DAILY_AMOUNT = 1000;
  static MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

  static assertSafeBalance(value, context = {}) {
    if (!Number.isSafeInteger(value) || value < 0 || value > this.MAX_SAFE_INTEGER) {
      throw createError(
        "Ugyldig kontostatus",
        ErrorTypes.VALIDATION,
        "Handlingen ville føre til en ugyldig kontosaldo.",
        { value, ...context }
      );
    }
  }

  static async claimDaily(client, guildId, userId) {
    logger.debug(`[ECONOMY_SERVICE] claimDaily forespurt`, { userId, guildId });
    
    const userData = await getEconomyData(client, guildId, userId);
    if (!userData) {
      logger.error(`[ECONOMY_SERVICE] Klarte ikke å laste økonomidata for daglig belønning`);
      throw createError(
        "Klarte ikke å laste økonomidata",
        ErrorTypes.DATABASE,
        "Klarte ikke å laste inn dine økonomidata. Vennligst prøv igjen senere.",
        { userId, guildId }
      );
    }

    const now = Date.now();
    const lastDaily = userData.lastDaily || 0;
    const remaining = lastDaily + this.DAILY_COOLDOWN - now;

    if (remaining > 0) {
      logger.warn(`[ECONOMY_SERVICE] Cooldown for daglig belønning er aktiv`, {
        userId,
        timeRemaining: remaining
      });
      throw createError(
        "Cooldown er aktiv",
        ErrorTypes.RATE_LIMIT,
        `Du må vente før du kan hente daglig belønning igjen. Prøv igjen om **${this.formatDuration(remaining)}**.`,
        { remaining, cooldownType: 'daily' }
      );
    }

    const earned = this.DAILY_AMOUNT;
    const nextWallet = (userData.wallet || 0) + earned;
    this.assertSafeBalance(nextWallet, { operation: 'claimDaily', userId, guildId });
    userData.wallet = nextWallet;
    userData.lastDaily = now;

    try {
      await setEconomyData(client, guildId, userId, userData);
      
      logger.info(`[ECONOMY_TRANSACTION] Daglig belønning hentet`, {
        userId,
        guildId,
        amount: earned,
        newWallet: userData.wallet,
        timestamp: new Date().toISOString(),
        source: 'claim_daily'
      });

      return {
        earned,
        newWallet: userData.wallet,
        nextClaimTime: new Date(now + this.DAILY_COOLDOWN)
      };
    } catch (error) {
      logger.error(`[ECONOMY_SERVICE] Klarte ikke å lagre daglig belønning`, error, {
        userId,
        guildId,
        amount: earned
      });
      throw createError(
        "Klarte ikke å lagre belønning",
        ErrorTypes.DATABASE,
        "Feil oppstod under behandling av daglig belønning. Vennligst prøv igjen.",
        { userId, guildId }
      );
    }
  }

  static async transferMoney(client, guildId, senderId, receiverId, amount) {
    logger.debug(`[ECONOMY_SERVICE] transferMoney forespurt`, {
      senderId,
      receiverId,
      amount,
      guildId
    });

    if (amount <= 0) {
      throw createError(
        "Ugyldig overføringsbeløp",
        ErrorTypes.VALIDATION,
        "Beløpet må være større enn null.",
        { amount, senderId }
      );
    }

    if (senderId === receiverId) {
      throw createError(
        "Kan ikke overføre til deg selv",
        ErrorTypes.VALIDATION,
        "Du kan ikke sende penger til din egen konto.",
        { senderId, receiverId }
      );
    }

    this.validateAmount(amount, { operation: 'transfer', senderId, receiverId });

    const [senderData, receiverData] = await Promise.all([
      getEconomyData(client, guildId, senderId),
      getEconomyData(client, guildId, receiverId)
    ]);

    if (!senderData || !receiverData) {
      logger.error(`[ECONOMY_SERVICE] Klarte ikke å laste økonomidata for overføring`, {
        senderLoaded: !!senderData,
        receiverLoaded: !!receiverData
      });
      throw createError(
        "Klarte ikke å laste økonomidata",
        ErrorTypes.DATABASE,
        "Klarte ikke å laste økonomidata. Vennligst prøv igjen senere.",
        { senderId, receiverId, guildId }
      );
    }

    if (senderData.wallet < amount) {
      logger.warn(`[ECONOMY_SERVICE] Utilstrekkelige midler for overføring`, {
        senderId,
        required: amount,
        available: senderData.wallet
      });
      throw createError(
        "Utilstrekkelige midler",
        ErrorTypes.VALIDATION,
        `Du har bare **$${senderData.wallet.toLocaleString()}** i kontanter.`,
        { required: amount, available: senderData.wallet, senderId }
      );
    }

    const walletBefore = senderData.wallet;
    const senderNext = (senderData.wallet || 0) - amount;
    const receiverNext = (receiverData.wallet || 0) + amount;

    this.assertSafeBalance(senderNext, { operation: 'transfer.sender', senderId, amount });
    this.assertSafeBalance(receiverNext, { operation: 'transfer.receiver', receiverId, amount });

    senderData.wallet = senderNext;
    receiverData.wallet = receiverNext;

    try {
      await setEconomyData(client, guildId, senderId, senderData);
      
      try {
        await setEconomyData(client, guildId, receiverId, receiverData);
      } catch (receiverError) {
        logger.error(`[ECONOMY_CRITICAL] Klarte ikke å kreditere mottaker ${receiverId}. Forsøker å rulle tilbake for avsender ${senderId}...`, receiverError);
        
        senderData.wallet = walletBefore;
        try {
          await setEconomyData(client, guildId, senderId, senderData);
          logger.info(`[ECONOMY_ROLLBACK] Vellykket tilbakerulling for avsender ${senderId}.`);
        } catch (rollbackError) {
          logger.error(`[ECONOMY_FATAL] TILBAKERULLING MISLYKTES for avsender ${senderId}! Data er uoverensstemmende.`, rollbackError);
        }
        
        throw receiverError;
      }

      logger.info(`[ECONOMY_TRANSACTION] Penger overført`, {
        type: 'transfer',
        senderId,
        receiverId,
        guildId,
        amount,
        senderNewBalance: senderData.wallet,
        receiverNewBalance: receiverData.wallet,
        timestamp: new Date().toISOString()
      });

      return {
        senderNewBalance: senderData.wallet,
        receiverNewBalance: receiverData.wallet
      };
    } catch (error) {
      logger.error(`[ECONOMY_SERVICE] Overføring mislyktes, DATA KAN VÆRE UOVERENSSTEMMENDE`, error, {
        senderId,
        receiverId,
        amount,
        guildId,
        senderBefore: walletBefore,
        senderAfter: senderData.wallet,
        receiverAfter: receiverData.wallet
      });
      throw createError(
        "Klarte ikke å lagre overføring",
        ErrorTypes.DATABASE,
        "Det oppstod en feil under overføringen. Vennligst prøv igjen.",
        { senderId, receiverId, amount }
      );
    }
  }

  static async addMoney(client, guildId, userId, amount, source = 'unknown') {
    if (amount <= 0) {
      throw createError(
        "Ugyldig beløp",
        ErrorTypes.VALIDATION,
        "Beløpet må være positivt",
        { amount, userId, source }
      );
    }

    this.validateAmount(amount, { operation: 'addMoney', userId, source });

    const userData = await getEconomyData(client, guildId, userId);
    const balanceBefore = userData.wallet || 0;
    const nextWallet = balanceBefore + amount;
    this.assertSafeBalance(nextWallet, { operation: 'addMoney', userId, source, amount });
    userData.wallet = nextWallet;

    await setEconomyData(client, guildId, userId, userData);

    logger.info(`[ECONOMY_TRANSACTION] Penger lagt til`, {
      userId,
      guildId,
      amount,
      source,
      balanceBefore,
      balanceAfter: userData.wallet,
      delta: amount,
      timestamp: new Date().toISOString()
    });

    return userData;
  }

  static async removeMoney(client, guildId, userId, amount, reason = 'unknown') {
    if (amount <= 0) {
      throw createError(
        "Ugyldig beløp",
        ErrorTypes.VALIDATION,
        "Beløpet må være positivt",
        { amount, userId, reason }
      );
    }

    this.validateAmount(amount, { operation: 'removeMoney', userId, reason });

    const userData = await getEconomyData(client, guildId, userId);
    const balanceBefore = userData.wallet || 0;

    if (balanceBefore < amount) {
      throw createError(
        "Utilstrekkelige midler",
        ErrorTypes.VALIDATION,
        `Du har bare **$${balanceBefore.toLocaleString()}**.`,
        { required: amount, available: balanceBefore, reason }
      );
    }

    userData.wallet = balanceBefore - amount;

    await setEconomyData(client, guildId, userId, userData);

    logger.info(`[ECONOMY_TRANSACTION] Penger fjernet`, {
      userId,
      guildId,
      amount,
      reason,
      balanceBefore,
      balanceAfter: userData.wallet,
      delta: -amount,
      timestamp: new Date().toISOString()
    });

    return userData;
  }

  static async depositToBank(client, guildId, userId, amount) {
    this.validateAmount(amount, { operation: 'deposit', userId });

    const userData = await getEconomyData(client, guildId, userId);
    const maxBank = getMaxBankCapacity(userData);

    if (userData.wallet < amount) {
      throw createError(
        "Utilstrekkelige kontanter",
        ErrorTypes.VALIDATION,
        `Du har bare **$${userData.wallet.toLocaleString()}** i kontanter.`,
        { required: amount, available: userData.wallet }
      );
    }

    const currentBank = userData.bank || 0;
    if (currentBank + amount > maxBank) {
      throw createError(
        "Bankkapasitet overskredet",
        ErrorTypes.VALIDATION,
        `Banken din har maksimal plass til **$${maxBank.toLocaleString()}**. Du vil overskride kapasiteten med **$${(currentBank + amount - maxBank).toLocaleString()}**.`,
        { capacity: maxBank, current: currentBank, requested: amount }
      );
    }

    const nextWallet = userData.wallet - amount;
    const nextBank = (userData.bank || 0) + amount;

    this.assertSafeBalance(nextWallet, { operation: 'deposit.wallet', userId, amount });
    this.assertSafeBalance(nextBank, { operation: 'deposit.bank', userId, amount });

    userData.wallet = nextWallet;
    userData.bank = nextBank;

    await setEconomyData(client, guildId, userId, userData);

    logger.info(`[ECONOMY_TRANSACTION] Penger satt inn i banken`, {
      userId,
      guildId,
      amount,
      walletAfter: userData.wallet,
      bankAfter: userData.bank,
      timestamp: new Date().toISOString()
    });

    return userData;
  }

  static async withdrawFromBank(client, guildId, userId, amount) {
    this.validateAmount(amount, { operation: 'withdraw', userId });

    const userData = await getEconomyData(client, guildId, userId);
    const bank = userData.bank || 0;

    if (bank < amount) {
      throw createError(
        "Utilstrekkelig bankbalanse",
        ErrorTypes.VALIDATION,
        `Du har bare **$${bank.toLocaleString()}** i banken.`,
        { required: amount, available: bank }
      );
    }

    const nextWallet = (userData.wallet || 0) + amount;
    const nextBank = bank - amount;

    this.assertSafeBalance(nextWallet, { operation: 'withdraw.wallet', userId, amount });
    this.assertSafeBalance(nextBank, { operation: 'withdraw.bank', userId, amount });

    userData.wallet = nextWallet;
    userData.bank = nextBank;

    await setEconomyData(client, guildId, userId, userData);

    logger.info(`[ECONOMY_TRANSACTION] Penger tatt ut fra banken`, {
      userId,
      guildId,
      amount,
      walletAfter: userData.wallet,
      bankAfter: userData.bank,
      timestamp: new Date().toISOString()
    });

    return userData;
  }

  static checkCooldown(userData, action, cooldownMs) {
    const lastActionField = `last${action.charAt(0).toUpperCase() + action.slice(1)}`;
    const lastTime = userData[lastActionField] || 0;
    const now = Date.now();
    const remaining = Math.max(0, lastTime + cooldownMs - now);

    return {
      isOnCooldown: remaining > 0,
      remaining,
      formatted: this.formatDuration(remaining),
      nextAvailable: new Date(lastTime + cooldownMs)
    };
  }

  static validateAmount(amount, context = {}) {
    if (!Number.isInteger(amount)) {
      throw createError(
        "Ugyldig beløp - må være et heltall",
        ErrorTypes.VALIDATION,
        "Beløpet må være et heltall",
        context
      );
    }

    if (amount <= 0) {
      throw createError(
        "Ugyldig beløp - må være positivt",
        ErrorTypes.VALIDATION,
        "Beløpet må være større enn 0",
        context
      );
    }

    if (amount > this.MAX_SAFE_INTEGER) {
      logger.error(`[ECONOMY] Beløpet overskrider MAX_SAFE_INTEGER`, { amount, context });
      throw createError(
        "Beløpet er for stort",
        ErrorTypes.VALIDATION,
        "Beløpet er for høyt til å kunne behandles",
        context
      );
    }
  }

  static formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}t ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  static formatCooldownDisplay(ms) {
    const duration = this.formatDuration(ms);
    return `**${duration}**`;
  }
}

wrapServiceClassMethods(EconomyService, (methodName) => ({
  service: 'EconomyService',
  operation: methodName,
  message: `Feil under økonomihåndtering: ${methodName}`,
  userMessage: 'Det oppstod en feil i økonomisystemet. Vennligst prøv igjen om et øyeblikk.'
}));

export default EconomyService;