import { MessageFlags } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getGuildMusicData, clearUpdateInterval } from './playerStore.js';
import { canControlMusic, requireVoiceChannel, VOICE_CHANNEL_DENIAL } from './permissions.js';
import {
    buildNowPlayingEmbed,
    buildQueueEmbed,
    buildQueuePaginationRow,
    getQueuePageSize,
} from './musicEmbeds.js';
import { refreshPlayerMessage } from './playerHandler.js';

const YOUTUBE_URL_PATTERN = /(?:youtube\.com|youtu\.be)/i;

export function getPlayer(client, guildId) {
    return client.riffy?.players?.get(guildId) || null;
}

export function assertRiffyAvailable(client) {
    if (!client.riffy) {
        throw new TitanBotError(
            'Lavalink er ikke konfigurert',
            ErrorTypes.CONFIGURATION,
            'Musikk er utilgjengelig — Lavalink er ikke konfigurert.',
        );
    }
}

export function assertInVoice(member) {
    if (!requireVoiceChannel(member)) {
        throw new TitanBotError(
            'Ikke i en talekanal',
            ErrorTypes.USER_INPUT,
            'Du må være i en talekanal.',
        );
    }
}

export function assertCanControl(member, player) {
    if (!canControlMusic(member, player)) {
        throw new TitanBotError(
            'Feil talekanal',
            ErrorTypes.PERMISSION,
            VOICE_CHANNEL_DENIAL,
        );
    }
}

export async function ensurePlayer(client, interaction) {
    assertRiffyAvailable(client);
    assertInVoice(interaction.member);

    const guildId = interaction.guild.id;
    const guildData = getGuildMusicData(guildId);
    let player = getPlayer(client, guildId);

    if (!player) {
        player = client.riffy.createConnection({
            guildId,
            voiceChannel: interaction.member.voice.channel.id,
            textChannel: interaction.channel.id,
            deaf: true,
        });
        guildData.playerChannelId = interaction.channel.id;
    }

    player.setVolume(guildData.volume);
    return { player, guildData };
}

function isDuplicateTrack(player, track) {
    const uri = track?.info?.uri;
    if (!uri) {
        return false;
    }
    if (player.current?.info?.uri === uri) {
        return true;
    }
    return player.queue.some((existing) => existing.info?.uri === uri);
}

export async function joinVoiceChannel(client, interaction) {
    assertRiffyAvailable(client);
    assertInVoice(interaction.member);

    const guildId = interaction.guild.id;
    const guildData = getGuildMusicData(guildId);
    const channel = interaction.member.voice.channel;
    let player = getPlayer(client, guildId);

    if (player && player.voiceChannel !== channel.id) {
        try {
            player.destroy();
        } catch {
            // Avspilleren er kanskje allerede borte
        }
        player = null;
    }

    if (!player) {
        player = client.riffy.createConnection({
            guildId,
            voiceChannel: channel.id,
            textChannel: interaction.channel.id,
            deaf: true,
        });
        guildData.playerChannelId = interaction.channel.id;
    }

    player.setVolume(guildData.volume);

    return successEmbed(
        'Koblede til talekanal',
        `Koblede til **${channel.name}**. Bruk /play for å starte musikk, eller /music for avspillingskontroller.`,
    );
}

export async function playQuery(client, interaction, query) {
    if (YOUTUBE_URL_PATTERN.test(query)) {
        throw new TitanBotError(
            'YouTube-lenke blokkert',
            ErrorTypes.USER_INPUT,
            'YouTube-lenker støttes ikke. Prøv et sangnavn i stedet.',
        );
    }

    const { player, guildData } = await ensurePlayer(client, interaction);

    const result = await client.riffy.resolve({
        query,
        requester: interaction.user,
    });

    const { loadType, tracks, playlistInfo } = result;

    if (loadType === 'playlist' || loadType === 'PLAYLIST_LOADED') {
        let added = 0;
        let skipped = 0;

        for (const track of tracks) {
            track.info.requester = interaction.user;
            if (isDuplicateTrack(player, track)) {
                skipped += 1;
                continue;
            }
            player.queue.add(track);
            added += 1;
        }

        if (!player.playing && !player.paused) {
            player.play();
        }

        return {
            embed: successEmbed(
                'Spilleliste lagt til',
                `**${playlistInfo?.name || 'Spilleliste'}**\nLagt til ${added} av ${tracks.length} spor.${skipped ? ` Hoppet over ${skipped} duplikat(er).` : ''}`,
            ),
        };
    }

    if (
        loadType === 'search'
        || loadType === 'track'
        || loadType === 'SEARCH_RESULT'
        || loadType === 'TRACK_LOADED'
    ) {
        const track = tracks?.[0];
        if (!track) {
            throw new TitanBotError('Ingen resultater', ErrorTypes.USER_INPUT, 'Ingen resultater funnet for søket.');
        }

        if (isDuplicateTrack(player, track)) {
            throw new TitanBotError(
                'Duplisert spor',
                ErrorTypes.USER_INPUT,
                `**${track.info.title}** spilles allerede eller ligger i køen.`,
            );
        }

        track.info.requester = interaction.user;

        const willPlayNow = !player.playing && !player.paused;
        player.queue.add(track);
        const queuePosition = player.queue.length;

        if (willPlayNow) {
            player.play();
        }

        return {
            embed: successEmbed(
                willPlayNow ? 'Spiller nå' : 'Spor lagt til',
                willPlayNow
                    ? `**${track.info.title}**\n${track.info.author}`
                    : `**${track.info.title}**\n${track.info.author}\nPosisjon: #${queuePosition} i køen`,
            ),
        };
    }

    throw new TitanBotError('Ingen resultater', ErrorTypes.USER_INPUT, `Ingen resultater funnet. (loadType: ${loadType})`);
}

export async function skipTrack(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingenting spilles akkurat nå.');
    }
    assertCanControl(interaction.member, player);
    const title = player.current.info?.title || 'Ukjent';
    if (player.loop === 'track') {
        player.setLoop('none');
    }
    player.stop();
    return successEmbed('Hoppet over', `Hoppet over **${title}**.`);
}

export async function stopPlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingen aktiv musikkavspiller.');
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    const queueLength = player.queue?.length || 0;

    if (queueLength >= 5 && guildData.stopConfirmPending !== interaction.user.id) {
        guildData.stopConfirmPending = interaction.user.id;
        setTimeout(() => {
            if (guildData.stopConfirmPending === interaction.user.id) {
                guildData.stopConfirmPending = null;
            }
        }, 15000);
        return successEmbed(
            'Bekreft stopp',
            `Det er **${queueLength}** spor i køen. Kjør **/music stop** igjen innen 15 sekunder for å bekrefte.`,
        );
    }

    guildData.stopConfirmPending = null;
    await destroyPlayerSession(client, interaction.guild.id, player, guildData);
    return successEmbed('Stoppet', 'Avspilling stoppet og køen ble tømt.');
}

export async function applyPause(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current || player.paused) {
        return false;
    }

    player.pause(true);
    await refreshPlayerMessage(client, guildId);
    return true;
}

export async function applyResume(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current || !player.paused) {
        return false;
    }

    player.pause(false);
    await refreshPlayerMessage(client, guildId);
    return true;
}

export async function pausePlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingenting spilles akkurat nå.');
    }
    assertCanControl(interaction.member, player);

    if (player.paused) {
        throw new TitanBotError('Allerede satt på pause', ErrorTypes.USER_INPUT, 'Avspillingen er allerede satt på pause.');
    }

    await applyPause(client, interaction.guild.id);
    return successEmbed('Pauset', 'Avspilling satt på pause.');
}

export async function resumePlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingenting spilles akkurat nå.');
    }
    assertCanControl(interaction.member, player);

    if (!player.paused) {
        throw new TitanBotError('Ikke pauset', ErrorTypes.USER_INPUT, 'Avspillingen er ikke satt på pause.');
    }

    await applyResume(client, interaction.guild.id);
    return successEmbed('Gjenopptatt', 'Avspilling gjenopptatt.');
}

export async function shuffleQueue(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Tom kø', ErrorTypes.USER_INPUT, 'Køen er tom.');
    }
    assertCanControl(interaction.member, player);
    player.queue.shuffle();
    getGuildMusicData(interaction.guild.id).shuffle = true;
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Stokket', 'Køen har blitt stokket.');
}

export async function setLoopMode(client, interaction, mode) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingen aktiv musikkavspiller.');
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.loop = mode;
    player.setLoop(mode);

    const labels = { none: 'Av', track: 'Enkeltsang', queue: 'Kø' };
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Gjentakelse oppdatert', `Gjentakelsesmodus satt til **${labels[mode] || mode}**.`);
}

export async function toggleLoop(client, interaction) {
    const guildData = getGuildMusicData(interaction.guild.id);
    const next = guildData.loop === 'none' ? 'track' : guildData.loop === 'track' ? 'queue' : 'none';
    return setLoopMode(client, interaction, next);
}

export async function setVolume(client, interaction, volume) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingen aktiv musikkavspiller.');
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.volume = Math.max(0, Math.min(100, volume));
    player.setVolume(guildData.volume);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Lydvolum oppdatert', `Lydvolum satt til **${guildData.volume}%**.`);
}

export async function adjustVolume(client, interaction, delta) {
    const guildData = getGuildMusicData(interaction.guild.id);
    return setVolume(client, interaction, guildData.volume + delta);
}

export async function seekTrack(client, interaction, seconds) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingenting spilles akkurat nå.');
    }
    assertCanControl(interaction.member, player);

    const info = player.current.info || {};
    if (info.isStream || info.isSeekable === false) {
        throw new TitanBotError(
            'Kan ikke spole',
            ErrorTypes.USER_INPUT,
            'Dette sporet kan ikke spoles i (det kan være en direktesending).',
        );
    }

    const position = Math.max(0, seconds * 1000);
    if (info.length && position > info.length) {
        throw new TitanBotError(
            'Spoling utenfor rekkevidde',
            ErrorTypes.USER_INPUT,
            `Du kan bare spole opp til ${Math.floor(info.length / 1000)}s for dette sporet.`,
        );
    }

    player.seek(position);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Spolt', `Spolt til **${seconds}s**.`);
}

export async function removeFromQueue(client, interaction, index) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Tom kø', ErrorTypes.USER_INPUT, 'Køen er tom.');
    }
    assertCanControl(interaction.member, player);

    const queueIndex = index - 1;
    if (queueIndex < 0 || queueIndex >= player.queue.length) {
        throw new TitanBotError('Ugyldig indeks', ErrorTypes.USER_INPUT, `Ugyldig køposisjon. Køen har ${player.queue.length} spor.`);
    }

    const removed = player.queue[queueIndex];
    player.queue.remove(queueIndex);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Fjernet', `Fjernet **${removed.info?.title || 'spor'}** fra køen.`);
}

export async function moveInQueue(client, interaction, from, to) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Tom kø', ErrorTypes.USER_INPUT, 'Køen er tom.');
    }
    assertCanControl(interaction.member, player);

    const fromIndex = from - 1;
    const toIndex = to - 1;
    if (fromIndex < 0 || fromIndex >= player.queue.length || toIndex < 0 || toIndex >= player.queue.length) {
        throw new TitanBotError('Ugyldig indeks', ErrorTypes.USER_INPUT, 'Ugyldige køposisjoner.');
    }

    const track = player.queue[fromIndex];
    player.queue.remove(fromIndex);
    player.queue.splice(toIndex, 0, track);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Flyttet', `Flyttet **${track.info?.title || 'spor'}** til posisjon #${to}.`);
}

export async function clearQueue(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Tom kø', ErrorTypes.USER_INPUT, 'Køen er allerede tom.');
    }
    assertCanControl(interaction.member, player);
    player.queue.clear();
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Kø tømt', 'Alle spor i køen ble fjernet.');
}

export async function setTwentyFourSeven(client, interaction, enabled) {
    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.twentyFourSeven = enabled;
    return successEmbed(
        '24/7 Modus',
        enabled
            ? '24/7-modus aktivert. Boten vil bli værende i talekanalen når køen er ferdig.'
            : '24/7-modus deaktivert. Boten vil forlate kanalen etter 30 sekunder med inaktivitet.',
    );
}

export function buildNowPlayingReply(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingenting spilles akkurat nå.');
    }
    const guildData = getGuildMusicData(guildId);
    return {
        embeds: [buildNowPlayingEmbed(player.current, player, guildData)],
    };
}

export function buildQueueReply(client, guildId, page = 0) {
    const player = getPlayer(client, guildId);
    if (!player) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Ingen aktiv musikkavspiller.');
    }

    const totalPages = Math.max(1, Math.ceil((player.queue?.length || 0) / getQueuePageSize()));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);

    return {
        embeds: [buildQueueEmbed(player.queue, player.current, safePage)],
        components: totalPages > 1 ? [buildQueuePaginationRow(safePage, totalPages)] : [],
        page: safePage,
        totalPages,
    };
}

export async function destroyPlayerSession(client, guildId, player, guildData, { forceDisconnect = false } = {}) {
    clearUpdateInterval(guildData);
    if (guildData.idleTimeout) {
        clearTimeout(guildData.idleTimeout);
        guildData.idleTimeout = null;
    }

    guildData.previousTracks = [];
    guildData.stopConfirmPending = null;
    guildData.autoPaused = false;
    guildData.queuePages?.clear();

    if (guildData.playerMessageId && guildData.playerChannelId) {
        try {
            const channel = client.channels.cache.get(guildData.playerChannelId);
            if (channel) {
                const msg = await channel.messages.fetch(guildData.playerMessageId);
                await msg.delete();
            }
        } catch {
            // Meldingen er allerede slettet
        }
    }

    guildData.playerMessageId = null;
    guildData.playerChannelId = null;

    if (player) {
        player.queue.clear();
        player.stop();
        if (forceDisconnect || !guildData.twentyFourSeven) {
            player.destroy();
        }
    }
}

export async function leaveVoiceChannel(client, interaction) {
    assertRiffyAvailable(client);

    const guildId = interaction.guild.id;
    const player = getPlayer(client, guildId);
    if (!player) {
        throw new TitanBotError('Ingen avspiller', ErrorTypes.USER_INPUT, 'Jeg er ikke i en talekanal.');
    }
    assertCanControl(interaction.member, player);

    const channel = interaction.guild.channels.cache.get(player.voiceChannel);
    const channelName = channel?.name || 'talekanal';
    const guildData = getGuildMusicData(guildId);

    await destroyPlayerSession(client, guildId, player, guildData, { forceDisconnect: true });

    return successEmbed('Forlot talekanalen', `Koblede fra **${channelName}**.`);
}

export async function replyMusicSuccess(interaction, embed) {
    if (interaction.deferred || interaction.replied) {
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}