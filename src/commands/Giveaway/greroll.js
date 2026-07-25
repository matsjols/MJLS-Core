import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getGuildGiveaways, saveGiveaway } from '../../utils/giveaways.js';
import { 
    selectWinners,
    createGiveawayEmbed, 
    createGiveawayButtons 
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("greroll")
        .setDescription("Trekker nye vinner(e) på nytt for en avsluttet giveaway.")
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("Melding-ID-en til den avsluttede giveawayen.")
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            throw new TitanBotError(
                'Giveaway command used outside guild',
                ErrorTypes.VALIDATION,
                'Denne kommandoen kan bare brukes på en server.',
                { userId: interaction.user.id }
            );
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            throw new TitanBotError(
                'User lacks ManageGuild permission',
                ErrorTypes.PERMISSION,
                "Du trenger 'Håndter server'-rettigheten for å trekke en giveaway på nytt.",
                { userId: interaction.user.id, guildId: interaction.guildId }
            );
        }

        logger.info(`Giveaway reroll initiated by ${interaction.user.tag} in guild ${interaction.guildId}`);

        const messageId = interaction.options.getString("messageid");

        if (!messageId || !/^\d+$/.test(messageId)) {
            throw new TitanBotError(
                'Invalid message ID format',
                ErrorTypes.VALIDATION,
                'Vennligst oppgi en gyldig melding-ID.',
                { providedId: messageId }
            );
        }

        const giveaways = await getGuildGiveaways(
            interaction.client,
            interaction.guildId,
        );

        const giveaway = giveaways.find(g => g.messageId === messageId);

        if (!giveaway) {
            throw new TitanBotError(
                `Giveaway not found: ${messageId}`,
                ErrorTypes.VALIDATION,
                "Ingen giveaway ble funnet med den melding-ID-en i databasen.",
                { messageId, guildId: interaction.guildId }
            );
        }

        if (!giveaway.isEnded && !giveaway.ended) {
            throw new TitanBotError(
                `Giveaway still active: ${messageId}`,
                ErrorTypes.VALIDATION,
                "Denne giveawayen er fremdeles aktiv. Vennligst bruk `/gend` for å avslutte den først.",
                { messageId, status: 'active' }
            );
        }

        const participants = giveaway.participants || [];

        if (participants.length < giveaway.winnerCount) {
            throw new TitanBotError(
                `Insufficient participants for reroll: ${participants.length} < ${giveaway.winnerCount}`,
                ErrorTypes.VALIDATION,
                "Ikke nok deltakere til å velge det nødvendige antall vinnere.",
                { participantsCount: participants.length, winnersNeeded: giveaway.winnerCount }
            );
        }

        const newWinners = selectWinners(
            participants,
            giveaway.winnerCount,
        );

        const updatedGiveaway = {
            ...giveaway,
            winnerIds: newWinners,
            rerolledAt: new Date().toISOString(),
            rerolledBy: interaction.user.id
        };

        const channel = await interaction.client.channels.fetch(
            giveaway.channelId,
        ).catch(err => {
            logger.warn(`Could not fetch channel ${giveaway.channelId}:`, err.message);
            return null;
        });

        if (!channel || !channel.isTextBased()) {

            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            logger.warn(`Could not find channel for giveaway ${messageId}, but saved new winners to database`);

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Nytt trekk fullført",
                        "De nye vinnerne har blitt valgt og lagret i databasen. Kunne ikke finne kanalen for å kunngjøre det.",
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
        }

        const message = await channel.messages
            .fetch(messageId)
            .catch(err => {
                logger.warn(`Could not fetch message ${messageId}:`, err.message);
                return null;
            });

        if (!message) {

            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            const winnerMentions = newWinners
                .map((id) => `<@${id}>`)
                .join(",");

            const existingPingMsg = giveaway.winnerPingMessageId
                ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                : null;
            if (existingPingMsg) {
                await existingPingMsg.edit({
                    content: `🔄 **GIVEAWAY NYTT TREKK** 🔄 Nye vinnere for **${giveaway.prize}**: ${winnerMentions}!`,
                });
            } else {
                const newPingMsg = await channel.send({
                    content: `🔄 **GIVEAWAY NYTT TREKK** 🔄 Nye vinnere for **${giveaway.prize}**: ${winnerMentions}!`,
                });
                updatedGiveaway.winnerPingMessageId = newPingMsg.id;
            }

            logger.info(`Giveaway rerolled (message not found, but announced): ${messageId}`);

            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                    data: {
                        description: `Giveaway trukket på nytt: ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: 'Premie',
                                value: giveaway.prize || 'Mysteriepremie!',
                                inline: true
                            },
                            {
                                name: 'Nye vinnere',
                                value: winnerMentions,
                                inline: false
                            },
                            {
                                name: 'Totalt antall deltakere',
                                value: participants.length.toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway reroll:', logError);
            }

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Nytt trekk fullført",
                        `De nye vinnerne har blitt kunngjort i ${channel}. (Originalmeldingen ble ikke funnet).`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
        }

        await saveGiveaway(
            interaction.client,
            interaction.guildId,
            updatedGiveaway,
        );

        const newEmbed = createGiveawayEmbed(updatedGiveaway, "reroll", newWinners);
        const newRow = createGiveawayButtons(true);

        await message.edit({
            content: "🔄 **GIVEAWAY TRUKKET PÅ NYTT** 🔄",
            embeds: [newEmbed],
            components: [newRow],
        });

        const winnerMentions = newWinners
            .map((id) => `<@${id}>`)
            .join(",");

        const existingPingMsg = giveaway.winnerPingMessageId
            ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
            : null;
        if (existingPingMsg) {
            await existingPingMsg.edit({
                content: `🔄 **NYTT TREKK VINNERE** 🔄 GRATULERER ${winnerMentions}! Dere er de nye vinnerne for **${giveaway.prize}**-giveawayen! Vennligst kontakt arrangøren <@${giveaway.hostId}> for å hente premien din.`,
            });
        } else {
            const newPingMsg = await channel.send({
                content: `🔄 **NYTT TREKK VINNERE** 🔄 GRATULERER ${winnerMentions}! Dere er de nye vinnerne for **${giveaway.prize}**-giveawayen! Vennligst kontakt arrangøren <@${giveaway.hostId}> for å hente premien din.`,
            });
            updatedGiveaway.winnerPingMessageId = newPingMsg.id;
        }

        logger.info(`Giveaway successfully rerolled: ${messageId} with ${newWinners.length} new winners`);

        try {
            await logEvent({
                client: interaction.client,
                guildId: interaction.guildId,
                eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                data: {
                    description: `Giveaway trukket på nytt: ${giveaway.prize}`,
                    channelId: giveaway.channelId,
                    userId: interaction.user.id,
                    fields: [
                        {
                            name: 'Premie',
                            value: giveaway.prize || 'Mysteriepremie!',
                            inline: true
                        },
                        {
                            name: 'Nye vinnere',
                            value: winnerMentions,
                            inline: false
                        },
                        {
                            name: 'Totalt antall deltakere',
                            value: participants.length.toString(),
                            inline: true
                        }
                    ]
                }
            });
        } catch (logError) {
            logger.debug('Error logging giveaway reroll event:', logError);
        }

        return InteractionHelper.safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Nytt trekk vellykket ✅",
                    `Trukket ut nye vinnere for giveawayen **${giveaway.prize}** i ${channel}. Valgte ut ${newWinners.length} ny(e) vinner(e).`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
    },
};