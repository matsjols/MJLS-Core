import { PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, updateCounter, getCounterEmoji, getCounterTypeLabel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

export async function handleUpdate(interaction, client) {
    const guild = interaction.guild;
    const counterId = interaction.options.getString("teller-id");
    const newType = interaction.options.getString("type");

    try {
        await InteractionHelper.safeDefer(interaction);
    } catch (error) {
        logger.error("Kunne ikke utsette svar (defer):", error);
        return;
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger tillatelsen **Manage Channels** for å oppdatere tellere.' }).catch(logger.error);
        return;
    }

    if (!newType) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Du må oppgi en ny tellertype for å oppdatere.' }).catch(logger.error);
        return;
    }

    try {
        const counters = await getServerCounters(client, guild.id);

        const counterIndex = counters.findIndex(c => c.id === counterId);
        if (counterIndex === -1) {
            await replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: `Teller med ID \`${counterId}\` ble ikke funnet. Bruk \`/serverstatistikk liste\` for å se alle tellere.` }).catch(logger.error);
            return;
        }

        const counter = counters[counterIndex];
        const oldChannel = guild.channels.cache.get(counter.channelId);

        if (!oldChannel) {
            await replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Kanalen for denne telleren eksisterer ikke lenger. Du kan ikke oppdatere en teller for en slettet kanal.' }).catch(logger.error);
            return;
        }

        if (newType !== counter.type) {
            const existingTypeCounter = counters.find(c => c.type === newType && c.id !== counter.id);
            if (existingTypeCounter) {
                const existingChannel = guild.channels.cache.get(existingTypeCounter.channelId);
                await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `En teller av typen **${getCounterTypeLabel(newType)}** finnes allerede på denne serveren${existingChannel ? ` i ${existingChannel}` : ''}. Slett den først før du gjenbruker den typen.` }).catch(logger.error);
                return;
            }
        }

        const oldType = counter.type;

        counter.type = newType;
        counter.updatedAt = new Date().toISOString();

        const saved = await saveServerCounters(client, guild.id, counters);
        if (!saved) {
            await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Kunne ikke lagre oppdaterte tellerdata. Vennligst prøv igjen.' }).catch(logger.error);
            return;
        }

        const updatedCounter = counters[counterIndex];
        const updated = await updateCounter(client, guild, updatedCounter);
        if (!updated) {
            await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Teller ble oppdatert, men kunne ikke oppdatere kanalnavnet. Teltet vil oppdateres ved neste planlagte kjøring.' }).catch(logger.error);
            return;
        }

        const finalChannel = guild.channels.cache.get(updatedCounter.channelId);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(`**Teller oppdatert!**\n\n**Teller-ID:** \`${counterId}\`\n**Endret type:** ${getCounterEmoji(oldType)} ${getCounterTypeLabel(oldType)} → ${getCounterEmoji(newType)} ${getCounterTypeLabel(newType)}\n\n**Nåværende innstillinger:**\n**Type:** ${getCounterEmoji(updatedCounter.type)} ${getCounterTypeLabel(updatedCounter.type)}\n**Kanal:** ${finalChannel}\n**Kanalnavn:** ${finalChannel.name}\n\nTelleren vil automatisk oppdatere seg hvert 15. minutt.`)]
        }).catch(logger.error);

    } catch (error) {
        logger.error("Feil ved oppdatering av teller:", error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Det oppstod en feil under oppdatering av telleren. Vennligst prøv igjen.' }).catch(logger.error);
    }
}