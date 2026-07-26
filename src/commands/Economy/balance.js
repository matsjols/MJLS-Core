import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, getMaxBankCapacity } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('saldo')
        .setDescription('Sjekk din eller noen andres saldo')
        .addUserOption(option =>
            option
                .setName('bruker')
                .setDescription('Bruker du vil sjekke saldoen til')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userOption = interaction.options.getUser("bruker");
        const targetUser = userOption || interaction.user;
        const guildId = interaction.guildId;

        logger.info(`[ECONOMY] Saldoesjekk - userOption: ${userOption?.id || 'null'}, targetUser: ${targetUser.id}, guildId: ${guildId}, isPrefix: ${!!interaction._commandStartTime}`);

        logger.debug(`[ECONOMY] Saldoesjekk for ${targetUser.id}`, { userId: targetUser.id, guildId });

        if (targetUser.bot) {
            throw createError(
                "Bot user queried for balance",
                ErrorTypes.VALIDATION,
                "Bots har ikke økonomisalder."
            );
        }

        const userData = await getEconomyData(client, guildId, targetUser.id);

        logger.info(`[ECONOMY] Økonomidata hentet - userData:`, userData);

        if (!userData) {
            throw createError(
                "Kunne ikke laste økonomidata",
                ErrorTypes.DATABASE,
                "Kunne ikke laste inn økonomidata. Vennligst prøv igjen senere.",
                { userId: targetUser.id, guildId }
            );
        }

        const maxBank = getMaxBankCapacity(userData);

        const wallet = typeof userData.wallet === 'number' ? userData.wallet : 0;
        const bank = typeof userData.bank === 'number' ? userData.bank : 0;

        const embed = createEmbed({
            title: `Saldoen til ${targetUser.username}`,
            description: `Her er den nåværende finansielle statusen til ${targetUser.username}.`,
        })
            .addFields(
                {
                    name: "💵 Kontanter",
                    value: `$${wallet.toLocaleString()}`,
                    inline: true,
                },
                {
                    name: "🏦 Bank",
                    value: `$${bank.toLocaleString()} / $${maxBank.toLocaleString()}`,
                    inline: true,
                },
                {
                    name: "💰 Totalt",
                    value: `$${(wallet + bank).toLocaleString()}`,
                    inline: true,
                }
            )
            .setFooter({
                text: `Forespurt av ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL(),
            });

        logger.info(`[ECONOMY] Saldo hentet`, { userId: targetUser.id, wallet, bank });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'saldo' })
};