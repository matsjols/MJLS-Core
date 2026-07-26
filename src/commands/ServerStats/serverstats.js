import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

import { handleCreate } from './modules/serverstats_create.js';
import { handleList } from './modules/serverstats_list.js';
import { handleUpdate } from './modules/serverstats_update.js';
import { handleDelete } from './modules/serverstats_delete.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName("serverstatistikk")
        .setDescription("Administrer serverstatistikk som sporer antall medlemmer og kanaldata")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand =>
            subcommand
                .setName("opprett")
                .setDescription("Opprett en ny teller-kanal for statistikk i en kategori")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Typen statistikk som skal spores")
                        .setRequired(true)
                        .addChoices(
                            { name: "medlemmer + boter", value: "members" },
                            { name: "kun medlemmer", value: "members_only" },
                            { name: "kun boter", value: "bots" }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName("kanal_type")
                        .setDescription("Kanaltypen som skal opprettes for denne telleren")
                        .setRequired(true)
                        .addChoices(
                            { name: "talekanal (anbefalt)", value: "voice" },
                            { name: "tekstkanal", value: "text" }
                        )
                )
                .addChannelOption(option =>
                    option
                        .setName("kategori")
                        .setDescription("Kategorien hvor teller-kanalen skal opprettes")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildCategory)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("liste")
                .setDescription("Vis alle statistikk-tellere for denne serveren")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("oppdater")
                .setDescription("Oppdater en eksisterende statistikk-teller")
                .addStringOption(option =>
                    option
                        .setName("teller-id")
                        .setDescription("ID-en til telleren du vil oppdatere")
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Den nye tellertypen")
                        .setRequired(false)
                        .addChoices(
                            { name: "medlemmer + boter", value: "members" },
                            { name: "kun medlemmer", value: "members_only" },
                            { name: "kun boter", value: "bots" }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("slett")
                .setDescription("Slett en eksisterende statistikk-teller")
                .addStringOption(option =>
                    option
                        .setName("teller-id")
                        .setDescription("ID-en til telleren som skal slettes")
                        .setRequired(true)
                )
        ),

    async execute(interaction, guildConfig, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case "opprett":
                await handleCreate(interaction, client);
                break;
            case "liste":
                await handleList(interaction, client);
                break;
            case "oppdater":
                await handleUpdate(interaction, client);
                break;
            case "slett":
                await handleDelete(interaction, client);
                break;
            default:
                await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Ukjent underkommando.' });
        }
    }
};