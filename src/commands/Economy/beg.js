import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { botConfig } from '../../config/bot.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const COOLDOWN = 30 * 60 * 1000;
const MIN_WIN = Number(botConfig?.economy?.begMin) || 50;
const MAX_WIN = Number(botConfig?.economy?.begMax) || 200;
const SUCCESS_CHANCE = 0.7;

export default {
    data: new SlashCommandBuilder()
        .setName('tigg')
        .setDescription('Tigg om litt penger'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        let userData = await getEconomyData(client, guildId, userId);
        
        if (!userData) {
            throw createError(
                "Kunne ikke laste økonomidata",
                ErrorTypes.DATABASE,
                "Kunne ikke laste inn økonomidataene dine. Vennligst prøv igjen senere.",
                { userId, guildId }
            );
        }

        const lastBeg = userData.lastBeg || 0;
        const remainingTime = lastBeg + COOLDOWN - Date.now();

        if (remainingTime > 0) {
            const minutes = Math.floor(remainingTime / 60000);
            const seconds = Math.floor((remainingTime % 60000) / 1000);

            let timeMessage =
                minutes > 0 ? `${minutes} minutt(er)` : `${seconds} sekund(er)`;

            throw createError(
                "Cooldown for tigging aktiv",
                ErrorTypes.RATE_LIMIT,
                `Du er sliten etter å ha tigget! Prøv igjen om **${timeMessage}**.`,
                { remainingTime, minutes, seconds, cooldownType: 'beg' }
            );
        }

        const success = Math.random() < SUCCESS_CHANCE;

        let replyEmbed;
        let newCash = userData.wallet;

        if (success) {
            const amountWon =
                Math.floor(Math.random() * (MAX_WIN - MIN_WIN + 1)) + MIN_WIN;

            newCash += amountWon;

            const successMessages = [
                `En snill fremmed slapp **$${amountWon.toLocaleString()}** oppi koppen din.`,
                `Du oppdaget en ubevoktet lommebok! Du tok **$${amountWon.toLocaleString()}** og løp.`,
                `Noen syntes synd på deg og ga deg **$${amountWon.toLocaleString()}**!`,
                `Du fant **$${amountWon.toLocaleString()}** under en parkbenk.`,
            ];

            replyEmbed = successEmbed(
                'Tigging vellykket',
                successMessages[
                    Math.floor(Math.random() * successMessages.length)
                ]
            );
        } else {
            const failMessages = [
                "Politiet jaget deg vekk. Du fikk ingenting.",
                "Noen ropte: 'Skaff deg en jobb!' og gikk forbi.",
                "Et ekorn stjal den eneste mynten du hadde.",
                "Du prøvde å tigge, men du ble for flau og ga opp.",
            ];

            replyEmbed = warningEmbed(
                'Ingen gevinst',
                failMessages[Math.floor(Math.random() * failMessages.length)]
            );
        }

        userData.wallet = newCash;
        userData.lastBeg = Date.now();

        await setEconomyData(client, guildId, userId, userData);

        await InteractionHelper.safeEditReply(interaction, { embeds: [replyEmbed] });
    }, { command: 'tigg' })
};