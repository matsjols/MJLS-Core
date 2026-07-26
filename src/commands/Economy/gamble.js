import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const BASE_WIN_CHANCE = 0.4;
const CLOVER_WIN_BONUS = 0.1;
const CHARM_WIN_BONUS = 0.08;
const PAYOUT_MULTIPLIER = 2.0;

export default {
    data: new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Gamble pengene dine for en sjanse til å vinne mer')
        .addIntegerOption(option =>
            option
                .setName('beløp')
                .setDescription('Beløp i kontanter du vil satse')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const betAmount = interaction.options.getInteger("beløp");

            const userData = await getEconomyData(client, guildId, userId);
            let cloverCount = userData.inventory["lucky_clover"] || 0;
            let charmCount = userData.inventory["lucky_charm"] || 0;

            if (userData.wallet < betAmount) {
                throw createError(
                    "Utilstrekkelige kontanter for pengespill",
                    ErrorTypes.VALIDATION,
                    `Du har bare $${userData.wallet.toLocaleString()} i kontanter, men prøver å satse $${betAmount.toLocaleString()}.`,
                    { required: betAmount, current: userData.wallet }
                );
            }

            let winChance = BASE_WIN_CHANCE;
            let cloverMessage = "";
            let usedClover = false;
            let usedCharm = false;

            if (cloverCount > 0) {
                winChance += CLOVER_WIN_BONUS;
                userData.inventory["lucky_clover"] -= 1;
                cloverMessage = `\n🍀 **Firkløver brukt:** Vinnermuligheten din ble økt!`;
                usedClover = true;
            }
            else if (charmCount > 0) {
                winChance += CHARM_WIN_BONUS;
                userData.inventory["lucky_charm"] -= 1;
                cloverMessage = `\n🧿 **Lykkeamulering brukt (${charmCount - 1} bruk gjenstår):** Vinnermuligheten din ble økt!`;
                usedCharm = true;
            }

            const win = Math.random() < winChance;
            let cashChange = 0;
            let resultEmbed;

            if (win) {
                const amountWon = Math.floor(betAmount * PAYOUT_MULTIPLIER);
                cashChange = amountWon - betAmount;

                resultEmbed = successEmbed(
                    "🎉 Du vant!",
                    `Du satset og gjorde din **$${betAmount.toLocaleString()}**-innsats om til **$${amountWon.toLocaleString()}**!${cloverMessage}`,
                );
            } else {
                cashChange = -betAmount;

                resultEmbed = warningEmbed(
                    "📉 Du tapte...",
                    `Terningene gikk mot deg. Du tapte din innsats på **$${betAmount.toLocaleString()}**.`,
                );
            }

            userData.wallet = (userData.wallet || 0) + cashChange;

            await setEconomyData(client, guildId, userId, userData);

            const newCash = userData.wallet;

            resultEmbed.addFields({
                name: "Ny kontantsaldo",
                value: `$${newCash.toLocaleString()}`,
                inline: true,
            });

            if (usedClover) {
                resultEmbed.setFooter({
                    text: `Du har ${userData.inventory["lucky_clover"]} firkløvere igjen. Vinnersjansen var ${Math.round(winChance * 100)}%.`,
                });
            } else if (usedCharm) {
                resultEmbed.setFooter({
                    text: `Du har ${userData.inventory["lucky_charm"]} bruk av lykkeamulering igjen. Vinnersjansen var ${Math.round(winChance * 100)}%.`,
                });
            } else {
                resultEmbed.setFooter({
                    text: `Basissjanse: ${Math.round(BASE_WIN_CHANCE * 100)}%.`,
                });
            }

            await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'gamble' })
};