import { createRequire } from 'module';
import { GatewayDispatchEvents } from 'discord.js';
import { logger } from '../../utils/logger.js';
import lavalinkConfig from '../../config/music/lavalink.js';
import { setupPlayerHandler } from './playerHandler.js';

const require = createRequire(import.meta.url);
const { Riffy } = require('riffy');

export function initializeMusic(client) {
    if (!lavalinkConfig.nodes?.length) {
        logger.error('Ingen Lavalink-noder er konfigurert. Legg til lavalink/nodes.json, sett LAVALINK_NODES, eller sett LAVALINK_HOST i miljøvariablene dine.');
        return;
    }

    client.riffy = new Riffy(client, lavalinkConfig.nodes, {
        send: (payload) => {
            const guild = client.guilds.cache.get(payload.d.guild_id);
            if (guild) {
                guild.shard.send(payload);
            }
        },
        defaultSearchPlatform: lavalinkConfig.defaultSearchPlatform,
        restVersion: lavalinkConfig.restVersion,
        bypassChecks: {
            nodeFetchInfo: true,
        },
    });

    setupPlayerHandler(client);

    client.on('raw', (packet) => {
        if (
            ![
                GatewayDispatchEvents.VoiceStateUpdate,
                GatewayDispatchEvents.VoiceServerUpdate,
            ].includes(packet.t)
        ) {
            return;
        }
        client.riffy.updateVoiceState(packet);
    });

    client.riffy.on('playerError', (player, error) => {
        logger.error(`Feil i musikkspiller for server ${player.guildId}:`, error);
    });

    logger.info(`Musikk initialisert med ${lavalinkConfig.nodes.length} Lavalink-node(r).`);
}

export function initRiffyAfterReady(client) {
    if (client.riffy && client.user?.id) {
        client.riffy.init(client.user.id);
        logger.info('Riffy tale-forbindelseshåndterer er initialisert.');
    }
}