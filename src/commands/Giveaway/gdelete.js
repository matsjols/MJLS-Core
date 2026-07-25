import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getGuildGiveaways, deleteGiveaway } from '../../utils/giveaways.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("giveaway-slett")
        .setDescription(
            "Sletter en giveaway-melding og fjerner den fra databasen.",
        )
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("Melding-ID-en til giveawayen som skal slettes.")
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
                "Du trenger 'Håndter server'-rettigheten for å slette en giveaway.",
                { userId: interaction.user.id, guildId: interaction.guildId }
            );
        }

        logger.info(`Giveaway deletion started by ${interaction.user.tag} in guild ${interaction.guildId}`);

        const messageId = interaction.options.getString("messageid");

        if (!messageId || !/^\d+$/.test(messageId)) {
            throw new TitanBotError(
                'Invalid message ID format',
                ErrorTypes.VALIDATION,
                'Vennligst oppgi en gyldig melding-ID.',
                { providedId: messageId }
            );
        }

        const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
        const giveaway = giveaways.find(g => g.messageId === messageId);

        if (!giveaway) {
            throw new TitanBotError(
                `Giveaway not found: ${messageId}`,
                ErrorTypes.VALIDATION,
                "Ingen giveaway ble funnet med den melding-ID-en.",
                { messageId, guildId: interaction.guildId }
            );
        }

        let deletedMessage = false;
        let channelName = "Ukjent kanal";

        const tryDeleteFromChannel = async (channel) => {
            if (!channel || !channel.isTextBased() || !channel.messages?.fetch) {
                return false;
            }

            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) {
                return false;
            }

            await message.delete();
            channelName = channel.name || 'ukjent-kanal';
            deletedMessage = true;
            return true;
        };

        try {
            const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
            if (await tryDeleteFromChannel(channel)) {
                logger.debug(`Deleted giveaway message ${messageId} from channel ${channelName}`);
            }

            if (!deletedMessage && interaction.guild) {
                const textChannels = interaction.guild.channels.cache.filter(
                    ch => ch.id !== giveaway.channelId && ch.isTextBased() && ch.messages?.fetch
                );

                for (const [, guildChannel] of textChannels) {
                    const foundAndDeleted = await tryDeleteFromChannel(guildChannel).catch(() => false);
                    if (foundAndDeleted) {
                        logger.debug(`Deleted giveaway message ${messageId} via fallback lookup in #${channelName}`);
                        break;
                    }
                }
            }
        } catch (error) {
            logger.warn(`Could not delete giveaway message: ${error.message}`);
        }

        const removedFromDatabase = await deleteGiveaway(
            interaction.client,
            interaction.guildId,
            messageId,
        );

        if (!removedFromDatabase) {
            throw new TitanBotError(
                `Failed to delete giveaway from database: ${messageId}`,
                ErrorTypes.UNKNOWN,
                'Giveawayen kunne ikke fjernes fra databasen. Vennligst prøv igjen.',
                { messageId, guildId: interaction.guildId }
            );
        }

        const giveawaysAfterDelete = await getGuildGiveaways(interaction.client, interaction.guildId);
        const stillExistsInDatabase = giveawaysAfterDelete.some(g => g.messageId === messageId);

        if (stillExistsInDatabase) {
            throw new TitanBotError(
                `Giveaway still exists after deletion: ${messageId}`,
                ErrorTypes.UNKNOWN,
                'Slettingen ble ikke lagret i databasen. Vennligst prøv igjen.',
                { messageId, guildId: interaction.guildId }
            );
        }

        const statusMsg = deletedMessage
            ? `og meldingen ble slettet fra #${channelName}`
            : `men meldingen var allerede slettet eller kanalen var utilgjengelig.`;

        const winnerIds = Array.isArray(giveaway.winnerIds) ? giveaway.winnerIds : [];
        const hasWinners = winnerIds.length > 0;
        const wasEnded = giveaway.ended === true || giveaway.isEnded === true || hasWinners;

        const winnerStatusMsg = hasWinners
            ? `Denne giveawayen hadde allerede ${winnerIds.length} vinner(e) valgt.`
            : wasEnded
                ? 'Denne giveawayen ble avsluttet uten gyldige vinnere.'
                : 'Ingen vinner ble trukket før sletting.';

        logger.info(`Giveaway deleted: ${messageId} in ${channelName}`);

        try {
            await logEvent({
                client: interaction.client,
                guildId: interaction.guildId,
                eventType: EVENT_TYPES.GIVEAWAY_DELETE,
                data: {
                    description: `Giveaway slettet: ${giveaway.prize}`,
                    channelId: giveaway.channelId,
                    userId: interaction.user.id,
                    fields: [
                        {
                            name: 'Premie',
                            value: giveaway.prize || 'Ukjent',
                            inline: true
                        },
                        {
                            name: 'Deltakere',
                            value: (giveaway.participants?.length || 0).toString(),
                            inline: true
                        }
                    ]
                }
            });
        } catch (logError) {
            logger.debug('Error logging giveaway deletion:', logError);
        }

        return InteractionHelper.safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Giveaway slettet",
                    `Slettet giveawayen for **${giveaway.prize}** ${statusMsg}. ${winnerStatusMsg}`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
    },
};