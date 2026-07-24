import { PermissionsBitField, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../../services/config/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Tilgang nektet')
                .setDescription('Du trenger **Manage Server** for å konfigurere bursdagskanalen.');
            return InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        }

        try {
            const channel = interaction.options.getChannel('kanal');
            const guildId = interaction.guildId;
            const guildConfig = await getGuildConfig(client, guildId);

            if (channel) {
                guildConfig.birthdayChannelId = channel.id;
                await setGuildConfig(client, guildId, guildConfig);
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('Kunngjøring av bursdager aktivert')
                    .setDescription(`Bursdagsmeldinger vil nå bli lagt ut i ${channel}.`);
                return InteractionHelper.safeReply(interaction, {
                    embeds: [embed],
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                guildConfig.birthdayChannelId = null;
                await setGuildConfig(client, guildId, guildConfig);
                const embed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('Kunngjøring av bursdager deaktivert')
                    .setDescription('Ingen kanal angitt – kunngjøringer om bursdager er deaktivert.');
                return InteractionHelper.safeReply(interaction, {
                    embeds: [embed],
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            logger.error('birthday_setchannel error:', error);
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('⚠️ Konfigurasjonsfeil')
                .setDescription('Kunne ikke lagre konfigurasjonen for bursdagskanalen.');
            return InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};