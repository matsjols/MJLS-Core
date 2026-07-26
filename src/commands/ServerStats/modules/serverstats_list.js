import { getColor } from '../../../config/bot.js';
import { PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, getCounterEmoji as getCounterTypeEmoji, getCounterTypeLabel, getGuildCounterStats } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

export async function handleList(interaction, client) {
    const guild = interaction.guild;

    try {
        await InteractionHelper.safeDefer(interaction);
    } catch (error) {
        logger.error("Kunne ikke utsette svar (defer):", error);
        return;
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger tillatelsen **Manage Channels** for å se tellere.' }).catch(logger.error);
        return;
    }

    try {
        const counters = await getServerCounters(client, guild.id);
        const stats = await getGuildCounterStats(guild);

        const validCounters = [];
        const orphanedCounters = [];
        
        for (const counter of counters) {
            const channel = guild.channels.cache.get(counter.channelId);
            if (channel) {
                validCounters.push(counter);
            } else {
                orphanedCounters.push(counter);
                logger.info(`Fjerner foreldreløs teller ${counter.id} (type: ${counter.type}, slettet kanal: ${counter.channelId}) fra server ${guild.id}`);
            }
        }

        if (orphanedCounters.length > 0) {
            await saveServerCounters(client, guild.id, validCounters);
            logger.info(`Renset opp ${orphanedCounters.length} foreldreløse teller(e) fra server ${guild.id}`);
        }

        if (validCounters.length === 0) {
            const embed = createEmbed({
                title: "Serverstatistikk – Tellere",
                description: "Ingen tellere er satt opp for denne serveren ennå.\n\nBruk `/serverstatistikk opprett` for å sette opp din første teller!",
                color: getColor('warning')
            });

            embed.addFields({
                name: "**Tilgjengelige tellertyper**",
                value: "**Medlemmer + boter** - Totalt antall medlemmer på serveren\n **Kun medlemmer** - Kun menneskelige medlemmer\n **Kun boter** - Kun bot-medlemmer",
                inline: false
            });

            embed.addFields({
                name: "**Eksempler på bruk**",
                value: "`/serverstatistikk opprett type:medlemmer kanal_type:tale kategori:Statistikk`\n`/serverstatistikk opprett type:boter kanal_type:tekst kategori:Serverinfo`\n`/serverstatistikk liste`",
                inline: false
            });

            embed.setFooter({ 
                text: "Tellersystem • Automatisk oppdatering hvert 15. minutt" 
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] }).catch(logger.error);
            return;
        }

        const embed = createEmbed({
            title: `Servertellere (${validCounters.length})`,
            description: "Her er alle aktive tellere for denne serveren.\n\nTellere oppdateres automatisk hvert 15. minutt.",
            color: getColor('info')
        });

        for (let i = 0; i < validCounters.length; i++) {
            const counter = validCounters[i];
            const channel = guild.channels.cache.get(counter.channelId);
            
            if (!channel) {
                logger.warn(`Teller ${counter.id} mangler fortsatt kanal etter opprydding`);
                continue;
            }

            const currentCount = getCurrentCount(stats, counter.type);
            const status = channel.name.includes(':') ? '✅ Aktiv' : '⚠️ Ikke oppdatert';
            
            embed.addFields({
                name: `${getCounterTypeEmoji(counter.type)} Teller #${i + 1} - ${channel.name}`,
                value: `**ID:** \`${counter.id}\`\n**Type:** ${getCounterTypeDisplay(counter.type)}\n**Kanal:** ${channel}\n**Nåværende antall:** ${currentCount}\n**Status:** ${status}\n**Opprettet:** ${new Date(counter.createdAt).toLocaleDateString('no-NO')}`,
                inline: false
            });
        }

        embed.addFields({
            name: "**Statistikk**",
            value: `**Totalt antall tellere:** ${validCounters.length}\n**Aktive tellere:** ${validCounters.filter(c => {
                const channel = guild.channels.cache.get(c.channelId);
                return channel && channel.name.includes(':');
            }).length}\n**Neste oppdatering:** <t:${Math.floor(Date.now() / 1000) + 900}:R>`,
            inline: false
        });

        embed.addFields({
            name: "**Administrasjonskommandoer**",
            value: "`/serverstatistikk opprett` - Opprett ny teller\n`/serverstatistikk oppdater` - Oppdater eksisterende teller\n`/serverstatistikk slett` - Slett teller",
            inline: false
        });

        embed.setFooter({ 
            text: "Tellersystem • Automatisk oppdatering hvert 15. minutt" 
        });
        embed.setTimestamp();

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] }).catch(logger.error);

    } catch (error) {
        logger.error("Feil ved visning av tellere:", error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Det oppstod en feil under henting av tellere. Vennligst prøv igjen.' }).catch(logger.error);
    }
}

function getCounterTypeDisplay(type) {
    return `${getCounterTypeEmoji(type)} ${getCounterTypeLabel(type)}`;
}

function getCounterEmoji(type) {
    return getCounterTypeEmoji(type);
}

function getCurrentCount(stats, type) {
    switch (type) {
        case "members":
            return stats.totalCount;
        case "bots":
            return stats.botCount;
        case "members_only":
            return stats.humanCount;
        default:
            return 0;
    }
}