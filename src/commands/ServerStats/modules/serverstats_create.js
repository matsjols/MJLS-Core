import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, updateCounter, getCounterBaseName, getCounterTypeLabel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

export async function handleCreate(interaction, client) {
    const guild = interaction.guild;
    const type = interaction.options.getString("type");
    const channelType = interaction.options.getString("kanal_type");
    const category = interaction.options.getChannel("kategori");

    try {
        await InteractionHelper.safeDefer(interaction);
    } catch (error) {
        logger.error("Kunne ikke utsette svar (defer):", error);
        return;
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger tillatelsen **Manage Channels** for å opprette tellere.' }).catch(logger.error);
        return;
    }

    try {
        if (!category || category.type !== ChannelType.GuildCategory) {
            await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Vennligst velg en gyldig kategori for teller-kanalen.' }).catch(logger.error);
            return;
        }

        const targetChannelType = channelType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const baseChannelName = getCounterBaseName(type);

        const counters = await getServerCounters(client, guild.id);

        const duplicateType = counters.find(counter => counter.type === type);

        if (duplicateType) {
            const duplicateChannel = guild.channels.cache.get(duplicateType.channelId);
            await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `En teller av typen **${getCounterTypeLabel(type)}** finnes allerede på denne serveren${duplicateChannel ? ` i ${duplicateChannel}` : ''}. Slett den først før du oppretter en ny.` }).catch(logger.error);
            return;
        }

        const targetChannel = await guild.channels.create({
            name: baseChannelName,
            type: targetChannelType,
            parent: category.id,
            reason: `Teller-kanal opprettet av ${interaction.user.tag}`
        });

        const existingCounter = counters.find(c => c.channelId === targetChannel.id);
        if (existingCounter) {
            await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Det finnes allerede en teller for kanalen **${targetChannel.name}**. Vennligst slett den først eller velg en annen type.` }).catch(logger.error);
            return;
        }

        const newCounter = {
            id: Date.now().toString(),
            type: type,
            channelId: targetChannel.id,
            guildId: guild.id,
            createdAt: new Date().toISOString(),
            enabled: true
        };

        counters.push(newCounter);

        const saved = await saveServerCounters(client, guild.id, counters);
        if (!saved) {
            await targetChannel.delete('Opprettelse av teller feilet under lagring').catch(() => null);
            await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Kunne ikke lagre tellerdata. Vennligst prøv igjen.' }).catch(logger.error);
            return;
        }

        const updated = await updateCounter(client, guild, newCounter);
        if (!updated) {
            await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Teller ble opprettet, men kunne ikke oppdatere kanalnavnet. Teltet vil oppdateres ved neste planlagte kjøring.' }).catch(logger.error);
            return;
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(`**Teller opprettet!**\n\n**Type:** ${getCounterTypeLabel(type)}\n**Kanaltype:** ${targetChannel.type === ChannelType.GuildVoice ? 'Talekanal' : 'Tekstkanal'}\n**Kategori:** ${category}\n**Kanal:** ${targetChannel}\n**Kanalnavn:** ${targetChannel.name}\n**Teller-ID:** \`${newCounter.id}\`\n\nTelleren vil automatisk oppdatere seg hvert 15. minutt.\n\nBruk \`/serverstatistikk liste\` for å se alle tellere.`)]
        }).catch(logger.error);

    } catch (error) {
        logger.error("Feil ved opprettelse av teller:", error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Det oppstod en feil under opprettelse av telleren. Vennligst prøv igjen.' }).catch(logger.error);
    }
}