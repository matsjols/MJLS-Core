import { getColor } from '../../../config/bot.js';
import { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, getCounterEmoji, getCounterTypeLabel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes, createError, wrapServiceBoundary } from '../../../utils/errorHandler.js';

export async function handleDelete(interaction, client) {
    const guild = interaction.guild;
    const counterId = interaction.options.getString("teller-id");

    try {
        await InteractionHelper.safeDefer(interaction);
    } catch (error) {
        logger.error("Kunne ikke utsette svar (defer):", error);
        return;
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger tillatelsen **Manage Channels** for å slette tellere.' }).catch(logger.error);
        return;
    }

    try {
        const counters = await getServerCounters(client, guild.id);

        if (counters.length === 0) {
            await replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Ingen tellere ble funnet å slette.' }).catch(logger.error);
            return;
        }

        const counterToDelete = counters.find(c => c.id === counterId);
        if (!counterToDelete) {
            await replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: `Teller med ID \`${counterId}\` ble ikke funnet. Bruk \`/serverstatistikk liste\` for å se alle tellere.` }).catch(logger.error);
            return;
        }

        const channel = guild.channels.cache.get(counterToDelete.channelId);

        const embed = createEmbed({
            title: "Slett teller og kanal",
            description: `Er du sikker på at du vil slette denne telleren og tilhørende kanal?\n\n**ID:** \`${counterToDelete.id}\`\n**Type:** ${getCounterTypeDisplay(counterToDelete.type)}\n**Kanal:** ${channel || 'Slettet kanal'}\n\n **Kanalen vil bli permanent slettet!**`,
            color: getColor('error')
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`counter-delete:confirm:${counterToDelete.id}:${interaction.user.id}`)
                .setLabel("Bekreft sletting")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`counter-delete:cancel:${counterToDelete.id}:${interaction.user.id}`)
                .setLabel("Avbryt")
                .setStyle(ButtonStyle.Secondary)
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components: [row] }).catch(logger.error);

    } catch (error) {
        logger.error("Feil i handleDelete:", error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Det oppstod en feil under henting av tellere. Vennligst prøv igjen.' }).catch(logger.error);
    }
}

export const performDeletionByCounterId = wrapServiceBoundary(async function performDeletionByCounterId(client, guild, counterId) {
    const counters = await getServerCounters(client, guild.id);

    const counter = counters.find(c => c.id === counterId);
    if (!counter) {
        throw createError(
            'Teller ikke funnet',
            ErrorTypes.USER_INPUT,
            `Teller med ID \`${counterId}\` ble ikke funnet.`,
            { guildId: guild.id, counterId, operation: 'performDeletionByCounterId' }
        );
    }

    const updatedCounters = counters.filter(c => c.id !== counter.id);

    const saved = await saveServerCounters(client, guild.id, updatedCounters);
    if (!saved) {
        throw createError(
            'Sletting av teller feilet',
            ErrorTypes.DATABASE,
            'Kunne ikke slette telleren. Vennligst prøv igjen.',
            { guildId: guild.id, counterId, operation: 'performDeletionByCounterId' }
        );
    }

    const channel = guild.channels.cache.get(counter.channelId);
    let channelDeleted = false;

    if (channel) {
        try {
            await channel.delete(`Teller slettet - fjerner kanal: ${counter.id}`);
            channelDeleted = true;
        } catch (error) {
            logger.error("Feil ved sletting av kanal:", error);
        }
    }

    let message = `✅ **Teller slettet!**\n\n**ID:** \`${counter.id}\`\n**Type:** ${getCounterTypeDisplay(counter.type)}`;

    if (channelDeleted) {
        message += `\n**Kanal:** ${channel.name} (slettet)`;
    } else if (channel) {
        message += `\n**Kanal:** ${channel.name} (kunne ikke slettes)`;
    } else {
        message += `\n**Kanal:** Allerede slettet`;
    }

    return { message };
}, {
    service: 'serverstats',
    operation: 'performDeletionByCounterId',
    userMessage: 'Det oppstod en feil under sletting av telleren. Vennligst prøv igjen.',
});

function getCounterTypeDisplay(type) {
    return `${getCounterEmoji(type)} ${getCounterTypeLabel(type)}`;
}