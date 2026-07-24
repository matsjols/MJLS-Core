import { SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import birthdaySet from './modules/birthday_set.js';
import birthdayInfo from './modules/birthday_info.js';
import birthdayList from './modules/birthday_list.js';
import birthdayRemove from './modules/birthday_remove.js';
import nextBirthdays from './modules/next_birthdays.js';
import birthdaySetchannel from './modules/birthday_setchannel.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName('bursdag')
        .setDescription('Systemkommandoer for bursdager')
        .addSubcommand(subcommand =>
            subcommand
                .setName('registrer')
                .setDescription('Registrer bursdagen din')
                .addIntegerOption(option =>
                    option
                        .setName('måned')
                        .setDescription('Fødselsmåned (1-12)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(12)
                )
                .addIntegerOption(option =>
                    option
                        .setName('dato')
                        .setDescription('Fødselsdatoen (1-31)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(31)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Se bursdagsinformasjon')
                .addUserOption(option =>
                    option
                        .setName('bruker')
                        .setDescription('Brukeren du sjekker bursdag for')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('liste')
                .setDescription('List opp alle bursdager på serveren')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('slett')
                .setDescription('Slett bursdagen din')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('kommende')
                .setDescription('Vis kommende bursdager')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('angi-bursdagskanal')
                .setDescription('Angi eller deaktiver kanalen for bursdagsmeldinger. (Krever tillatelse til å administrere serveren)')
                .addChannelOption(option =>
                    option
                        .setName('kanal')
                        .setDescription('Tekstkanalen for kunngjøringer. La stå tom for å deaktivere.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        ),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'registrer':
                return await birthdaySet.execute(interaction, config, client);
            case 'info':
                return await birthdayInfo.execute(interaction, config, client);
            case 'liste':
                return await birthdayList.execute(interaction, config, client);
            case 'slett':
                return await birthdayRemove.execute(interaction, config, client);
            case 'kommende':
                return await nextBirthdays.execute(interaction, config, client);
            case 'angi-bursdagskanal':
                return await birthdaySetchannel.execute(interaction, config, client);
            default:
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Unknown subcommand' });
        }
    }
};