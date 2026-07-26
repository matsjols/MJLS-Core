import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { formatDuration } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { botConfig } from '../../config/bot.js';

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const DAILY_AMOUNT = botConfig.economy?.dailyAmount ?? 100;
const PREMIUM_BONUS_PERCENTAGE = 0.1;

export default {
    data: new SlashCommandBuilder()
        .setName('daglig')
        .setDescription('Hent din daglige belønning'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const now = Date.now();

        logger.debug(`[ECONOMY] Daglig belønning startet for ${userId}`, { userId, guildId });

        const userData = await getEconomyData(client, guildId, userId);
        
        if (!userData) {
            throw createError(
                "Kunne ikke laste økonomidata for daily",
                ErrorTypes.DATABASE,
                "Kunne ikke laste inn økonomidataene dine. Vennligst prøv igjen senere.",
                { userId, guildId }
            );
        }
        
        const lastDaily = userData.lastDaily || 0;

        if (now < lastDaily + DAILY_COOLDOWN) {
            const timeRemaining = lastDaily + DAILY_COOLDOWN - now;
            throw createError(
                "Daglig cooldown aktiv",
                ErrorTypes.RATE_LIMIT,
                `Du må vente før du kan hente den daglige belønningen igjen. Prøv igjen om **${formatDuration(timeRemaining)}**.`,
                { timeRemaining, cooldownType: 'daily' }
            );
        }

        const guildConfig = await getGuildConfig(client, guildId);
        const PREMIUM_ROLE_ID = guildConfig.premiumRoleId;

        let earned = DAILY_AMOUNT;
        let bonusMessage = "";
        let hasPremiumRole = false;

        if (
            PREMIUM_ROLE_ID &&
            interaction.member &&
            interaction.member.roles.cache.has(PREMIUM_ROLE_ID)
        ) {
            const bonusAmount = Math.floor(
                DAILY_AMOUNT * PREMIUM_BONUS_PERCENTAGE,
            );
            earned += bonusAmount;
            bonusMessage = `\n✨ **Premiumbonus:** +$${bonusAmount.toLocaleString()}`;
            hasPremiumRole = true;
        }

        userData.wallet = (userData.wallet || 0) + earned;
        userData.lastDaily = now;

        await setEconomyData(client, guildId, userId, userData);

        logger.info(`[ECONOMY_TRANSACTION] Daglig belønning hentet`, {
            userId,
            guildId,
            amount: earned,
            newWallet: userData.wallet,
            hasPremium: hasPremiumRole,
            timestamp: new Date().toISOString()
        });

        const embed = successEmbed(
            "✅ Daglig belønning hentet!",
            `Du har hentet dine daglige **$${earned.toLocaleString()}**!${bonusMessage}`
        )
            .addFields({
                name: "Ny kontantsaldo",
                value: `$${userData.wallet.toLocaleString()}`,
                inline: true,
            })
            .setFooter({
                text: hasPremiumRole
                    ? `Neste krav om 24 timer. (Premium aktiv)`
                    : `Neste krav om 24 timer.`,
            });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'daglig' })
};