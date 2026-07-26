import { SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    skipTrack,
    stopPlayback,
    pausePlayback,
    resumePlayback,
    shuffleQueue,
    setLoopMode,
    setVolume,
    seekTrack,
    removeFromQueue,
    moveInQueue,
    clearQueue,
    setTwentyFourSeven,
    leaveVoiceChannel,
    replyMusicSuccess,
} from '../../services/music/musicActions.js';
import { deferMusicCommand } from '../../services/music/prefixSupport.js';

export default {
    category: 'Music',
    data: new SlashCommandBuilder()
        .setName('musikk')
        .setDescription('Administrer avspilling, kø og innstillinger for talekanal')
        .addSubcommand((sub) =>
            sub.setName('pause').setDescription('Sett avspillingen på pause'),
        )
        .addSubcommand((sub) =>
            sub.setName('fortsett').setDescription('Gjenoppta avspillingen'),
        )
        .addSubcommand((sub) =>
            sub.setName('hopp-over').setDescription('Hopp over gjeldende sang'),
        )
        .addSubcommand((sub) =>
            sub.setName('stopp').setDescription('Stopp avspillingen og tøm køen'),
        )
        .addSubcommand((sub) =>
            sub.setName('shuffle').setDescription('Miks / stokk om på køen'),
        )
        .addSubcommand((sub) =>
            sub
                .setName('loop')
                .setDescription('Velg repeteringsmodus')
                .addStringOption((opt) =>
                    opt
                        .setName('modus')
                        .setDescription('Repeteringsmodus')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Av', value: 'none' },
                            { name: 'Sang', value: 'track' },
                            { name: 'Kø', value: 'queue' },
                        ),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('volum')
                .setDescription('Endre avspillingsvolum')
                .addIntegerOption((opt) =>
                    opt.setName('niva').setDescription('Volum (0-100)').setRequired(true).setMinValue(0).setMaxValue(100),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('spol')
                .setDescription('Spol til et tidspunkt i sangen')
                .addIntegerOption((opt) =>
                    opt.setName('sekunder').setDescription('Posisjon i sekunder').setRequired(true).setMinValue(0),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('fjern')
                .setDescription('Fjern en sang fra køen')
                .addIntegerOption((opt) =>
                    opt.setName('posisjon').setDescription('Køposisjon').setRequired(true).setMinValue(1),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('flytt')
                .setDescription('Flytt en sang i køen')
                .addIntegerOption((opt) =>
                    opt.setName('fra').setDescription('Nåværende posisjon').setRequired(true).setMinValue(1),
                )
                .addIntegerOption((opt) =>
                    opt.setName('til').setDescription('Ny posisjon').setRequired(true).setMinValue(1),
                ),
        )
        .addSubcommand((sub) =>
            sub.setName('tøm').setDescription('Tøm hele køen'),
        )
        .addSubcommand((sub) =>
            sub.setName('forlat').setDescription('Koble boten fra talekanalen'),
        )
        .addSubcommand((sub) =>
            sub
                .setName('247')
                .setDescription('Slå på/av 24/7-modus (bli i talekanalen når inaktiv)')
                .addBooleanOption((opt) =>
                    opt.setName('aktivert').setDescription('Aktiver eller deaktiver 24/7-modus').setRequired(true),
                ),
        ),

    async execute(interaction, config, client) {
        await deferMusicCommand(interaction);
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'pause': {
                const embed = await pausePlayback(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'fortsett': {
                const embed = await resumePlayback(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'hopp-over': {
                const embed = await skipTrack(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'stopp': {
                const embed = await stopPlayback(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'shuffle': {
                const embed = await shuffleQueue(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'loop': {
                const embed = await setLoopMode(client, interaction, interaction.options.getString('modus'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'volum': {
                const embed = await setVolume(client, interaction, interaction.options.getInteger('niva'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'spol': {
                const embed = await seekTrack(client, interaction, interaction.options.getInteger('sekunder'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'fjern': {
                const embed = await removeFromQueue(client, interaction, interaction.options.getInteger('posisjon'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'flytt': {
                const embed = await moveInQueue(
                    client,
                    interaction,
                    interaction.options.getInteger('fra'),
                    interaction.options.getInteger('til'),
                );
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'tøm': {
                const embed = await clearQueue(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'forlat': {
                const embed = await leaveVoiceChannel(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case '247': {
                const embed = await setTwentyFourSeven(client, interaction, interaction.options.getBoolean('aktivert'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            default:
                await InteractionHelper.safeEditReply(interaction, {
                    content: 'Ukjent musikk-underkommando.',
                });
        }
    },
};