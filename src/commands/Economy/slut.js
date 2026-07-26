import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const SLUT_COOLDOWN = 45 * 60 * 1000;

const SLUT_ACTIVITIES = [
    { name: "Kamerastreaming", min: 120, max: 450, risk: 0.2 },
    { name: "Privat dansesession", min: 220, max: 700, risk: 0.25 },
    { name: "Vert på nattklubb", min: 320, max: 900, risk: 0.3 },
    { name: "VIP-selskapsbooking", min: 550, max: 1400, risk: 0.35 },
    { name: "Eksklusiv direktesending", min: 850, max: 2200, risk: 0.4 },
];

const POSITIVE_OUTCOMES = [
    "Sendingen din tok av og tipsene rant inn.",
    "En VIP-booking betalte langt over gjennomsnittet.",
    "Nattskiftet ditt var stappfullt og svært lønnsomt.",
    "Premium-forespørsler strømmet inn og utbetalingen økte.",
];

const FINE_OUTCOMES = [
    "Sikkerhetspersonell ga deg et gebyr for regelbrudd.",
    "En moderatørstengning utløste et plattformgebyr.",
    "Du ble rapportert og måtte betale et straffegebyr.",
];

const ROBBED_OUTCOMES = [
    "En falsk kjøper ba om tilbakeføring av penger og svekket inntekten din.",
    "En svindelskift tømte en god del av kontantene dine.",
    "Du ble lurt av en falsk konto og tapte penger.",
];

const LOSS_OUTCOMES = [
    "Opplegget floppet og du måtte dekke driftskostnadene selv.",
    "Du brukte penger på forberedelser uten å få noe igjen.",
    "Skiftet gikk helt feil vei og etterlot deg i minus.",
];

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function resolveOutcome(activity, wallet) {
    const successChance = Math.max(0.35, 0.55 - activity.risk * 0.2);
    const fineChance = 0.22;
    const robbedChance = 0.2;
    const roll = Math.random();

    if (roll < successChance) {
        const amount = randomInt(activity.min, activity.max);
        return {
            type: 'payout',
            delta: amount,
            message: randomChoice(POSITIVE_OUTCOMES),
            title: `${activity.name} - Utbetaling`
        };
    }

    const remainingAfterSuccess = roll - successChance;

    if (remainingAfterSuccess < fineChance) {
        const maxFine = Math.min(wallet, Math.max(150, Math.floor(activity.max * 0.4)));
        const minFine = Math.min(maxFine, Math.max(50, Math.floor(activity.min * 0.2)));
        const amount = maxFine > 0 ? randomInt(minFine, maxFine) : 0;
        return {
            type: 'fine',
            delta: -amount,
            message: randomChoice(FINE_OUTCOMES),
            title: `${activity.name} - Ilagt bot`
        };
    }

    if (remainingAfterSuccess < fineChance + robbedChance) {
        const maxRobbed = Math.min(wallet, Math.max(200, Math.floor(wallet * 0.35)));
        const minRobbed = Math.min(maxRobbed, Math.max(75, Math.floor(wallet * 0.1)));
        const amount = maxRobbed > 0 ? randomInt(minRobbed, maxRobbed) : 0;
        return {
            type: 'robbed',
            delta: -amount,
            message: randomChoice(ROBBED_OUTCOMES),
            title: `${activity.name} - Ranet`
        };
    }

    const maxLoss = Math.min(wallet, Math.max(100, Math.floor(activity.max * 0.3)));
    const minLoss = Math.min(maxLoss, Math.max(40, Math.floor(activity.min * 0.15)));
    const amount = maxLoss > 0 ? randomInt(minLoss, maxLoss) : 0;
    return {
        type: 'loss',
        delta: -amount,
        message: randomChoice(LOSS_OUTCOMES),
        title: `${activity.name} - Tap`
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('voksenjobb')
        .setDescription('Ta en dristig og risikabel jobb for tilfeldig utbetaling eller tap'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            logger.debug(`[ECONOMY] Voksenjobb-kommando startet for ${userId}`, { userId, guildId });

            const userData = await getEconomyData(client, guildId, userId);

            if (!userData) {
                throw createError(
                    "Kunne ikke laste økonomidata for voksenjobb",
                    ErrorTypes.DATABASE,
                    "Kunne ikke laste inn økonomidataene dine. Vennligst prøv igjen senere.",
                    { userId, guildId }
                );
            }

            const lastSlut = userData.lastSlut || 0;

            if (now - lastSlut < SLUT_COOLDOWN) {
                const remainingTime = lastSlut + SLUT_COOLDOWN - now;
                throw createError(
                    "Cooldown for voksenjobb aktiv",
                    ErrorTypes.RATE_LIMIT,
                    `Du må vente før du kan jobbe igjen! Prøv igjen om **${Math.ceil(remainingTime / 60000)}** minutter.`,
                    { timeRemaining: remainingTime, cooldownType: 'slut' }
                );
            }

            const activity = randomChoice(SLUT_ACTIVITIES);

            const outcome = resolveOutcome(activity, userData.wallet || 0);

            userData.lastSlut = now;
            userData.totalSluts = (userData.totalSluts || 0) + 1;
            userData.totalSlutEarnings = (userData.totalSlutEarnings || 0) + Math.max(0, outcome.delta);
            userData.totalSlutLosses = (userData.totalSlutLosses || 0) + Math.max(0, -outcome.delta);

            if (outcome.type !== 'payout') {
                userData.failedSluts = (userData.failedSluts || 0) + 1;
            }

            userData.wallet = Math.max(0, (userData.wallet || 0) + outcome.delta);

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Voksenjobb fullført`, {
                userId,
                guildId,
                activity: activity.name,
                outcomeType: outcome.type,
                amountDelta: outcome.delta,
                newWallet: userData.wallet,
                timestamp: new Date().toISOString()
            });

            const amountLabel = `${outcome.delta >= 0 ? '+' : '-'}$${Math.abs(outcome.delta).toLocaleString()}`;
            const summaryLines = [
                `${outcome.message}`,
                `💸 **Netto resultat:** ${amountLabel}`,
                `💳 **Nåværende saldo:** $${userData.wallet.toLocaleString()}`,
                `📊 **Totale økter:** ${userData.totalSluts}`,
                `💵 **Totalt tjent:** $${(userData.totalSlutEarnings || 0).toLocaleString()}`,
                `🧾 **Totalt tapt:** $${(userData.totalSlutLosses || 0).toLocaleString()}`
            ];

            const embed = createEmbed({
                title: outcome.title,
                description: summaryLines.join('\n'),
                color: outcome.delta >= 0 ? 'success' : 'error',
                timestamp: true
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'voksenjobb' })
};