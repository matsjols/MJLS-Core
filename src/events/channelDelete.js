import { 
    getJoinToCreateConfig, 
    removeJoinToCreateTrigger,
    unregisterTemporaryChannel,
    getTicketData,
    saveTicketData
} from '../utils/database.js';
import { getServerCounters, saveServerCounters } from '../services/serverstatsService.js';
import { logger } from '../utils/logger.js';

export default {
    name: 'channelDelete',
    async execute(channel, client) {
        
        if (channel.type === 0 && channel.guild) {
            try {
                const ticketData = await getTicketData(channel.guild.id, channel.id);
                if (ticketData && ticketData.status === 'open') {
                    ticketData.status = 'deleted';
                    ticketData.closedAt = new Date().toISOString();
                    await saveTicketData(channel.guild.id, channel.id, ticketData);
                    logger.info(`Ticketkanal ${channel.id} ble manuelt slettet i server ${channel.guild.id}, markert som slettet`);
                }
            } catch (err) {
                logger.warn(`Kunne ikke rydde opp ticketen for slettet kanal ${channel.id}:`, err);
            }
        }

        if (channel.type !== 2 && channel.type !== 4) {
            return;
        }

        const guildId = channel.guild.id;

        try {
            
            const counters = await getServerCounters(client, guildId);
            const orphanedCounter = counters.find(c => c.channelId === channel.id);
            
            if (orphanedCounter) {
                logger.info(`Teller-kanal ${channel.name} (${channel.id}) ble slettet, fjerner teller ${orphanedCounter.id} fra databasen`);
                
                const updatedCounters = counters.filter(c => c.channelId !== channel.id);
                const success = await saveServerCounters(client, guildId, updatedCounters);
                
                if (success) {
                    logger.info(`Fjernet foreldreløs teller ${orphanedCounter.id} (type: ${orphanedCounter.type}) fra server ${guildId}`);
                } else {
                    logger.warn(`Kunne ikke fjerne foreldreløs teller ${orphanedCounter.id} fra server ${guildId}`);
                }
            }

            const config = await getJoinToCreateConfig(client, guildId);

            if (!config.enabled) {
                return;
            }

            if (config.triggerChannels.includes(channel.id)) {
                logger.info(`TempVoice trigger-kanal ${channel.name} (${channel.id}) ble slettet, fjerner fra konfigurasjonen`);
                
                const success = await removeJoinToCreateTrigger(client, guildId, channel.id);
                if (success) {
                    logger.info(`Fjernet trigger-kanal ${channel.id} fra TempVoice-konfigurasjonen`);
                } else {
                    logger.warn(`Kunne ikke fjerne trigger-kanal ${channel.id} fra TempVoice-konfigurasjonen`);
                }
            }

            if (config.temporaryChannels[channel.id]) {
                logger.info(`TempVoice midlertidig kanal ${channel.name} (${channel.id}) ble slettet, rydder opp i databasen`);
                
                const success = await unregisterTemporaryChannel(client, guildId, channel.id);
                if (success) {
                    logger.info(`Ryddet opp midlertidig kanal ${channel.id} fra databasen`);
                } else {
                    logger.warn(`Kunne ikke rydde opp midlertidig kanal ${channel.id} fra databasen`);
                }
            }

            if (config.categoryId === channel.id) {
                logger.warn(`Kategori ${channel.name} (${channel.id}) brukt for TempVoice midlertidige kanaler ble slettet. TempVoice vil bli deaktivert.`);
                
                config.categoryId = null;
                config.enabled = false;
                
                try {
                    await client.db.set(`guild:${guildId}:jointocreate`, config);
                    logger.info(`Deaktiverte TempVoice for server ${guildId} på grunn av sletting av kategori`);
                } catch (error) {
                    logger.error(`Kunne ikke deaktivere TempVoice for server ${guildId}:`, error);
                }
            }

        } catch (error) {
            logger.error(`Feil i channelDelete-hendelsen for server ${guildId}:`, error);
        }
    }
};