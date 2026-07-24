import { EmbedBuilder } from 'discord.js';
import { getUpcomingBirthdays } from '../../../services/birthdayService.js';
import { deleteBirthday } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const next5 = await getUpcomingBirthdays(client, interaction.guildId, 5);

        if (next5.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Ingen bursdager funnet')
                .setDescription('Det er ikke registrert noen bursdager på denne serveren ennå. Bruk `/bursdag registrer` for å legge til bursdager!');
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });
        }

        let displayIndex = 0;
        for (const birthday of next5) {
            const member = await interaction.guild.members.fetch(birthday.userId).catch(() => null);
            if (!member) {
                deleteBirthday(client, interaction.guildId, birthday.userId).catch(() => null);
                continue;
            }
            displayIndex++;

            let timeUntil = '';
            if (birthday.daysUntil === 0) {
                timeUntil = '🎉 **Idag!**';
            } else if (birthday.daysUntil === 1) {
                timeUntil = '📅 **Imorgen!**';
            } else {
                timeUntil = `Om ${birthday.daysUntil} dager${birthday.daysUntil > 1 ? 's' : ''}`;
            }
        }

        if (displayIndex === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Ingen kommende bursdager')
                .setDescription('Ingen kommende bursdager funnet for nåværende servermedlemmer.');
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });
        }

        let birthdayList = `🎂 **De neste 5 kommende bursdagene**\n\nHer er de neste 5 bursdagene i ${interaction.guild.name}:\n\n`;
        displayIndex = 0;
        for (const birthday of next5) {
            const member = await interaction.guild.members.fetch(birthday.userId).catch(() => null);
            if (!member) {
                continue;
            }
            displayIndex++;

            let timeUntil = '';
            if (birthday.daysUntil === 0) {
                timeUntil = '🎉 **Idag!**';
            } else if (birthday.daysUntil === 1) {
                timeUntil = '📅 **Imorgen!**';
            } else {
                timeUntil = `Om ${birthday.daysUntil} dager${birthday.daysUntil > 1 ? 's' : ''}`;
            }

            birthdayList += `${displayIndex}. **${member.displayName}**\n<@${birthday.userId}>\n📅 **Dato:** ${birthday.day} ${birthday.monthName}\n⏰ **Tid igjen:** ${timeUntil}\n\n`;
        }

        birthdayList += `Use /birthday set to add your birthday!`;

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('De neste 5 kommende bursdagene')
            .setDescription(birthdayList);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed]
        });

        logger.info('Neste bursdager hentet uten problemer', {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            upcomingCount: displayIndex,
            commandName: 'next_birthdays'
        });
    }
};