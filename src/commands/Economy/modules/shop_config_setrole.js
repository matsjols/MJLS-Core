import { PermissionsBitField } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { getGuildConfig, setGuildConfig } from '../../../services/config/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Du trenger **Administrer server**-rettigheter for å angi premiumrollen.' });
        }

        const role = interaction.options.getRole('role');
        const guildId = interaction.guildId;

        try {
            const currentConfig = await getGuildConfig(client, guildId);
            currentConfig.premiumRoleId = role.id;
            await setGuildConfig(client, guildId, currentConfig);

            return InteractionHelper.safeReply(interaction, {
                embeds: [successEmbed('Premiumrolle angitt', `**Premiumbutikk-rollen** har blitt satt til ${role.toString()}. Medlemmer som kjøper Premiumrolle-gjenstanden vil få tildelt denne rollen.`)],
                ephemeral: true,
            });
        } catch (error) {
            logger.error('shop_config_setrole feil:', error);
            return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Kunne ikke lagre serverkonfigurasjonen.' });
        }
    },
};