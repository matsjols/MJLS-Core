import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { successEmbed, buildUserErrorEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData, getMaxBankCapacity } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('innskudd')
        .setDescription('Sett inn penger fra lommeboka til banken')
        .addStringOption(option =>
            option
                .setName('beløp')
                .setDescription('Beløp å sette inn (tall eller "alt")')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
        
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const amountInput = interaction.options.getString("beløp");

        const userData = await getEconomyData(client, guildId, userId);
        
        if (!userData) {
            throw createError(
                "Kunne ikke laste økonomidata",
                ErrorTypes.DATABASE,
                "Kunne ikke laste inn økonomidataene dine. Vennligst prøv igjen senere.",
                { userId, guildId }
            );
        }
        
        const maxBank = getMaxBankCapacity(userData);
        let depositAmount;

        if (amountInput.toLowerCase() === "all" || amountInput.toLowerCase() === "alt") {
            depositAmount = userData.wallet;
        } else {
            depositAmount = parseInt(amountInput);

            if (isNaN(depositAmount) || depositAmount <= 0) {
                throw createError(
                    "Ugyldig innskuddsbeløp",
                    ErrorTypes.VALIDATION,
                    `Vennligst oppgi et gyldig tall eller 'alt'. Du skrev: \`${amountInput}\``,
                    { amountInput, userId }
                );
            }
        }

        if (depositAmount === 0) {
            throw createError(
                "Innskuddsbeløp er null",
                ErrorTypes.VALIDATION,
                "Du har ingen kontanter å sette inn.",
                { userId, walletBalance: userData.wallet }
            );
        }

        if (depositAmount > userData.wallet) {
            depositAmount = userData.wallet;
            await interaction.followUp({
                embeds: [
                    buildUserErrorEmbed(
                        'validation',
                        `Du prøvde å sette inn mer enn du har. Setter inn dine gjenværende kontanter: **$${depositAmount.toLocaleString()}**`
                    )
                ],
                flags: MessageFlags.Ephemeral,
            });
        }

        const availableSpace = maxBank - userData.bank;

        if (availableSpace <= 0) {
            throw createError(
                "Banken er full",
                ErrorTypes.VALIDATION,
                `Banken din er for øyeblikket full (Maks kapasitet: $${maxBank.toLocaleString()}). Kjøp en **Bankoppgradering** for å øke grensen din.`,
                { maxBank, currentBank: userData.bank, userId }
            );
        }

        if (depositAmount > availableSpace) {
            const originalDepositAmount = depositAmount;
            depositAmount = availableSpace;

            if (amountInput.toLowerCase() !== "all" && amountInput.toLowerCase() !== "alt") {
                await interaction.followUp({
                    embeds: [
                        buildUserErrorEmbed(
                            'validation',
                            `Du hadde bare plass til **$${depositAmount.toLocaleString()}** i bankkontoen din (Maks: $${maxBank.toLocaleString()}). Resten blir stående i kontanter.`
                        )
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }
        }

        if (depositAmount === 0) {
            throw createError(
                "Ingen plass eller kontanter for innskudd",
                ErrorTypes.VALIDATION,
                "Beløpet du prøvde å sette inn var enten 0 eller overskred bankkapasiteten din etter kontroll av kontantsaldoen.",
                { depositAmount, availableSpace, walletBalance: userData.wallet }
            );
        }

        userData.wallet -= depositAmount;
        userData.bank += depositAmount;

        await setEconomyData(client, guildId, userId, userData);

        const embed = successEmbed(
            'Innskudd vellykket',
            `Du har satt inn **$${depositAmount.toLocaleString()}** i banken din.`
        )
            .addFields(
                {
                    name: "Ny kontantsaldo",
                    value: `$${userData.wallet.toLocaleString()}`,
                    inline: true,
                },
                {
                    name: "Ny banksaldo",
                    value: `$${userData.bank.toLocaleString()} / $${maxBank.toLocaleString()}`,
                    inline: true,
                },
            );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'innskudd' })
};