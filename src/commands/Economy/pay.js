import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, addMoney, removeMoney, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import EconomyService from '../../services/economyService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('betal')
        .setDescription('Betal en annen bruker noen av kontantene dine')
        .addUserOption(option =>
            option
                .setName('bruker')
                .setDescription('Brukeren du vil betale')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('beløp')
                .setDescription('Beløpet du vil betale')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const senderId = interaction.user.id;
            const receiver = interaction.options.getUser("bruker");
            const amount = interaction.options.getInteger("beløp");
            const guildId = interaction.guildId;

            logger.debug(`[ECONOMY] Betalingskommando startet`, { 
                senderId, 
                receiverId: receiver.id,
                amount,
                guildId
            });

            if (receiver.bot) {
                throw createError(
                    "Kan ikke betale bot",
                    ErrorTypes.VALIDATION,
                    "Du kan ikke betale penger til en bot.",
                    { receiverId: receiver.id, isBot: true }
                );
            }
            
            if (receiver.id === senderId) {
                throw createError(
                    "Kan ikke betale deg selv",
                    ErrorTypes.VALIDATION,
                    "Du kan ikke overføre penger til deg selv.",
                    { senderId, receiverId: receiver.id }
                );
            }
            
            if (amount <= 0) {
                throw createError(
                    "Ugyldig betalingsbeløp",
                    ErrorTypes.VALIDATION,
                    "Beløpet må være større enn null.",
                    { amount, senderId }
                );
            }

            const [senderData, receiverData] = await Promise.all([
                getEconomyData(client, guildId, senderId),
                getEconomyData(client, guildId, receiver.id)
            ]);

            if (!senderData) {
                throw createError(
                    "Kunne ikke laste avsenderens økonomidata",
                    ErrorTypes.DATABASE,
                    "Kunne ikke laste inn økonomidataene dine. Vennligst prøv igjen senere.",
                    { userId: senderId, guildId }
                );
            }
            
            if (!receiverData) {
                throw createError(
                    "Kunne ikke laste mottakerens økonomidata",
                    ErrorTypes.DATABASE,
                    "Kunne ikke laste inn økonomidataene til mottakeren. Vennligst prøv igjen senere.",
                    { userId: receiver.id, guildId }
                );
            }

            const result = await EconomyService.transferMoney(
                client, 
                guildId, 
                senderId, 
                receiver.id, 
                amount
            );

            const updatedSenderData = await getEconomyData(client, guildId, senderId);
            const updatedReceiverData = await getEconomyData(client, guildId, receiver.id);

            const embed = successEmbed(
                'Betaling vellykket',
                `Du har overført **$${amount.toLocaleString()}** til **${receiver.username}**!`
            )
                .addFields(
                    {
                        name: "Overført beløp",
                        value: `$${amount.toLocaleString()}`,
                        inline: true,
                    },
                    {
                        name: "Din nye saldo",
                        value: `$${updatedSenderData.wallet.toLocaleString()}`,
                        inline: true,
                    },
                )
                .setFooter({
                    text: `Betalt til ${receiver.tag}`,
                    iconURL: receiver.displayAvatarURL(),
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

            logger.info(`[ECONOMY] Betaling utført`, {
                senderId,
                receiverId: receiver.id,
                amount,
                senderBalance: updatedSenderData.wallet,
                receiverBalance: updatedReceiverData.wallet
            });

            try {
                const receiverEmbed = createEmbed({ 
                    title: "Innkommende betaling!", 
                    description: `${interaction.user.username} betalte deg **$${amount.toLocaleString()}**.` 
                }).addFields({
                    name: "Dine nye kontanter",
                    value: `$${updatedReceiverData.wallet.toLocaleString()}`,
                    inline: true,
                });
                await receiver.send({ embeds: [receiverEmbed] });
            } catch (e) {
                    logger.warn(`Kunne ikke sende DM til bruker ${receiver.id}: ${e.message}`);
            }
    }, { command: 'betal' })
};