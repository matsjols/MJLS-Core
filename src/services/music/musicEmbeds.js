import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getPaginationRow } from '../../utils/components.js';

const QUEUE_PAGE_SIZE = 10;

export const MUSIC_BUTTON_IDS = {
    PAUSE: 'music_pause',
    RESUME: 'music_resume',
    SKIP: 'music_skip',
    STOP: 'music_stop',
    SHUFFLE: 'music_shuffle',
    LOOP: 'music_loop',
    VOL_DOWN: 'music_vol_down',
    VOL_UP: 'music_vol_up',
    QUEUE: 'music_queue',
    QUEUE_FIRST: 'music_queue_first',
    QUEUE_PREV: 'music_queue_prev',
    QUEUE_NEXT: 'music_queue_next',
    QUEUE_LAST: 'music_queue_last',
};

export function formatDuration(ms) {
    if (!ms || Number.isNaN(ms)) {
        return 'Direkte';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getTrackArtwork(track) {
    return track?.info?.artworkUrl || track?.info?.thumbnail || null;
}

function getLoopLabel(loop) {
    switch (loop) {
        case 'track':
            return 'Enkeltsang';
        case 'queue':
            return 'Kø';
        default:
            return 'Av';
    }
}

export function buildNowPlayingEmbed(track, player, guildData) {
    const requester = track?.info?.requester;
    const requesterLabel = requester
        ? (requester.username || requester.tag || 'Ukjent')
        : 'Ukjent';

    const position = formatDuration(player?.position || 0);
    const duration = formatDuration(track?.info?.length || 0);

    return createEmbed({
        title: 'Spiller nå',
        description: track?.info?.title || 'Ukjent spor',
        color: 'primary',
        fields: [
            { name: 'Artist', value: track?.info?.author || 'Ukjent', inline: true },
            { name: 'Forespurt av', value: requesterLabel, inline: true },
            { name: 'Fremdrift', value: `${position} / ${duration}`, inline: true },
            { name: 'Volum', value: `${guildData?.volume ?? 75}%`, inline: true },
            { name: 'Gjentakelse', value: getLoopLabel(guildData?.loop), inline: true },
            { name: 'Kø', value: `${player?.queue?.length || 0} spor`, inline: true },
        ],
        thumbnail: getTrackArtwork(track),
        footer: player?.paused ? 'Pauset' : 'Spiller',
    });
}

export function buildQueueEmbed(queue, currentTrack, page = 0) {
    const totalTracks = queue?.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalTracks / QUEUE_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * QUEUE_PAGE_SIZE;
    const slice = queue?.slice(start, start + QUEUE_PAGE_SIZE) || [];

    let description = '';
    if (currentTrack) {
        description += `**Spiller nå**\n${currentTrack.info?.title || 'Ukjent'} — ${currentTrack.info?.author || 'Ukjent'}\n\n`;
    }

    if (slice.length === 0) {
        description += 'Køen er tom.';
    } else {
        description += slice
            .map((track, index) => {
                const num = start + index + 1;
                return `${num}. ${track.info?.title || 'Ukjent'} — ${track.info?.author || 'Ukjent'}`;
            })
            .join('\n');
    }

    return createEmbed({
        title: 'Musikkø',
        description: description.substring(0, 4096),
        color: 'info',
        footer: `Side ${safePage + 1} av ${totalPages} • ${totalTracks} i kø`,
    });
}

export function buildPlayerButtonRows(player, guildData) {
    const paused = player?.paused;
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.PAUSE)
            .setLabel('Pause')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⏸️')
            .setDisabled(Boolean(paused)),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.RESUME)
            .setLabel('Spill')
            .setStyle(ButtonStyle.Success)
            .setEmoji('▶️')
            .setDisabled(!paused),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SKIP)
            .setLabel('Hopp over')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏭️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.STOP)
            .setLabel('Stopp')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⏹️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SHUFFLE)
            .setLabel('Stokk')
            .setStyle(guildData?.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔀'),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.LOOP)
            .setLabel('Gjenta')
            .setStyle(guildData?.loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔁'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_DOWN)
            .setLabel('Vol -')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔉'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_UP)
            .setLabel('Vol +')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔊'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.QUEUE)
            .setLabel('Kø')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋'),
    );

    return [row1, row2];
}

export function buildQueuePaginationRow(page, totalPages) {
    return getPaginationRow('music_queue', page + 1, totalPages);
}

export function getQueuePageSize() {
    return QUEUE_PAGE_SIZE;
}