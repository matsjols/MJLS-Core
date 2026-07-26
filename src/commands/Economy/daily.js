import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const DAILY_REWARD = 1000;
const DAILY_STREAK_BONUS = 100;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000; 

export default {
    data: new SlashCommandBuilder()
        .setName('daglig')
        .setDescription('Hent din daglige belønning'),

    execute: withErrorHandling(async (interaction, config, client) => {
        // flags: 64 gjør at responsen blir ephemeral (kun synlig for brukeren)
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: 64 });
        if (!deferred) return;

            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            logger.debug(`[ECONOMY] Daglig belønning forespurt for ${userId}`, { userId, guildId });

            const userData = await getEconomyData(client, guildId, userId);

            if (!userData) {
                throw createError(
                    "Kunne ikke laste økonomidata for daglig belønning",
                    ErrorTypes.DATABASE,
                    "Kunne ikke laste inn økonomidataene dine. Vennligst prøv igjen senere.",
                    { userId, guildId }
                );
            }

            const lastDaily = userData.lastDaily || 0;
            const currentStreak = userData.dailyStreak || 0;

            if (now < lastDaily + DAILY_COOLDOWN) {
                const remaining = lastDaily + DAILY_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor(
                    (remaining % (1000 * 60 * 60)) / (1000 * 60),
                );

                throw createError(
                    "Daglig belønning er allerede hentet",
                    ErrorTypes.RATE_LIMIT,
                    `Du har allerede hentet din daglige belønning i dag. Kom tilbake om **${hours}t ${minutes}m**.`,
                    { remaining, cooldownType: 'daily' }
                );
            }

            let newStreak = currentStreak;
            if (now > lastDaily + DAILY_COOLDOWN * 2) {
                newStreak = 1;
            } else {
                newStreak += 1;
            }

            const streakBonus = (newStreak - 1) * DAILY_STREAK_BONUS;
            const totalReward = DAILY_REWARD + streakBonus;

            userData.wallet += totalReward;
            userData.lastDaily = now;
            userData.dailyStreak = newStreak;

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY] Daglig belønning hentet`, {
                userId,
                guildId,
                reward: totalReward,
                streak: newStreak,
                newWallet: userData.wallet
            });

            const embed = successEmbed(
                "🎁 Daglig belønning mottatt!",
                `Du mottok **$${DAILY_REWARD.toLocaleString()}**${streakBonus > 0 ? ` + **$${streakBonus.toLocaleString()}** i streak-bonus` : ''}!`,
            )
                .addFields(
                    {
                        name: "Ny kontantsaldo",
                        value: `$${userData.wallet.toLocaleString()}`,
                        inline: true,
                    },
                    {
                        name: "Daglig streak",
                        value: `🔥 ${newStreak} dag(er)`,
                        inline: true,
                    },
                )
                .setFooter({
                    text: `Husk å hente belønningen din igjen om 24 timer!`,
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'daglig' })
};