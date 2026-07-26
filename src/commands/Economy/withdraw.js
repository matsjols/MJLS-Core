import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData, getMaxBankCapacity } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('ta-ut')
        .setDescription('Ta ut penger fra banken til lommeboka di')
        .addIntegerOption(option =>
            option
                .setName('beløp')
                .setDescription('Beløp som skal tas ut')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        await InteractionHelper.safeDefer(interaction);
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const amountInput = interaction.options.getInteger("beløp");

            const userData = await getEconomyData(client, guildId, userId);
            
            if (!userData) {
                throw createError(
                    "Kunne ikke laste økonomidata",
                    ErrorTypes.DATABASE,
                    "Kunne ikke laste inn økonomidataene dine. Vennligst prøv igjen senere.",
                    { userId, guildId }
                );
            }

            let withdrawAmount = amountInput;

            if (withdrawAmount <= 0) {
                throw createError(
                    "Ugyldig uttaksbeløp",
                    ErrorTypes.VALIDATION,
                    "Du må ta ut et positivt beløp.",
                    { amount: withdrawAmount, userId }
                );
            }

            if (withdrawAmount > userData.bank) {
                withdrawAmount = userData.bank;
            }

            if (withdrawAmount === 0) {
                throw createError(
                    "Tom bankkonto",
                    ErrorTypes.VALIDATION,
                    "Bankkontoen din er tom.",
                    { userId, bankBalance: userData.bank }
                );
            }

            userData.wallet += withdrawAmount;
            userData.bank -= withdrawAmount;

            await setEconomyData(client, guildId, userId, userData);

            const embed = successEmbed(
                'Uttak vellykket',
                `Du har tatt ut **$${withdrawAmount.toLocaleString()}** fra banken.`
            )
                .addFields(
                    {
                        name: "Ny kontantsaldo",
                        value: `$${userData.wallet.toLocaleString()}`,
                        inline: true,
                    },
                    {
                        name: "Ny banksaldo",
                        value: `$${userData.bank.toLocaleString()}`,
                        inline: true,
                    },
                );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'ta-ut' })
};