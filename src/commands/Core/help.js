import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from "../../utils/embeds.js";
import {
    createSelectMenu,
} from "../../utils/components.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_SELECT_ID = "help-category-select";
const ALL_COMMANDS_ID = "help-all-commands";
const BUG_REPORT_BUTTON_ID = "help-bug-report";
const HELP_MENU_TIMEOUT_MS = 5 * 60 * 1000;

// Egendefinerte norske navn for kategoriene
const CATEGORY_NAMES = {
    Core: "Kjerne",
    Moderation: "Moderering",
    Economy: "Økonomi",
    Music: "Musikk",
    Fun: "Moro",
    Leveling: "Nivåer",
    Utility: "Hjelpeverktøy",
    Ticket: "Billetter",
    Welcome: "Velkomst",
    Giveaway: "Giveaway",
    Counter: "Teller",
    Tools: "Verktøy",
    Search: "Søk",
    "Reaction Roles": "Reaksjonsroller",
    Community: "Fellesskap",
    Birthday: "Bursdag",
    "Join To Create": "Koble til for å opprette",
    Verification: "Verifisering",
};

const CATEGORY_ICONS = {
    Core: "ℹ️",
    Moderation: "🛡️",
    Economy: "💰",
    Music: "🎵",
    Fun: "🎮",
    Leveling: "📊",
    Utility: "🔧",
    Ticket: "🎫",
    Welcome: "👋",
    Giveaway: "🎉",
    Counter: "🔢",
    Tools: "🛠️",
    Search: "🔍",
    "Reaction Roles": "🎭",
    Community: "👥",
    Birthday: "🎂",
    "Join To Create": "🔌",
    Verification: "✅",
};

function formatCategoryName(rawCategory) {
    const formatted = rawCategory
        .replace(/_/g, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (char) => char.toUpperCase());

    return {
        english: formatted,
        norwegian: CATEGORY_NAMES[formatted] || formatted,
    };
}

export async function createInitialHelpMenu(client) {
    const commandsPath = path.join(__dirname, "../../commands");
    const categoryDirs = (
        await fs.readdir(commandsPath, { withFileTypes: true })
    )
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

    const options = [
        {
            label: "📋 Alle kommandoer",
            description: "Bla gjennom alle tilgjengelige kommandoer i en enkelt liste",
            value: ALL_COMMANDS_ID,
        },
        ...categoryDirs.map((category) => {
            const { english, norwegian } = formatCategoryName(category);
            const icon = CATEGORY_ICONS[english] || "🔍";
            return {
                label: `${icon} ${norwegian}`,
                description: `Vis kommandoer i kategorien ${norwegian}`,
                value: category,
            };
        }),
    ];

    const botName = client?.user?.username || "Bot";
    const embed = createEmbed({
        title: `📖 ${botName} Hjelp`,
        description: 'Sett opp serveren din, velg hva som skal aktiveres, og bla gjennom kommandoene nedenfor.',
        color: 'primary',
        thumbnail: client.user?.displayAvatarURL?.({ size: 1024 }),
        fields: [
            {
                name: '🚀 Kom i gang',
                value: [
                    '**1. Start oppsett** — Kjør `/configwizard` for å konfigurere prefiks, moderatorrolle og logger.',
                    '**2. Aktiver systemer** — Bruk `/commands dashboard` til å slå kategorier av eller på.',
                    '**3. Bla gjennom kommandoer** — Bruk menyen nedenfor for å se kategorier og kommandoer.',
                ].join('\n'),
                inline: false,
            },
            {
                name: 'ℹ️ Slik fungerer det',
                value: [
                    '• Dashbord-kommandoer administrerer hver funksjon visuelt',
                    '• Innstillinger lagres per server',
                    '• Både skråstrekkommandoer (slash commands) og prefikser fungerer når de er aktivert',
                ].join('\n'),
                inline: false,
            },
        ],
    });

    embed.setFooter({ 
        text: "Laget med ❤️" 
    });
    embed.setTimestamp();

    const bugReportButton = new ButtonBuilder()
        .setCustomId(BUG_REPORT_BUTTON_ID)
        .setLabel("Rapporter feil")
        .setStyle(ButtonStyle.Danger);

    const selectRow = createSelectMenu(
        CATEGORY_SELECT_ID,
        "Velg for å vise kommandoene",
        options,
    );

    const buttonRow = new ActionRowBuilder().addComponents([
        bugReportButton,
        supportButton,
    ]);

    return {
        embeds: [embed],
        components: [buttonRow, selectRow],
    };
}

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName("hjelp")
        .setDescription("Viser hjelpemenyen med alle tilgjengelige kommandoer"),

    async execute(interaction, guildConfig, client) {
        const { MessageFlags } = await import('discord.js');
        await InteractionHelper.safeDefer(interaction);
        
        const { embeds, components } = await createInitialHelpMenu(client);

        await InteractionHelper.safeEditReply(interaction, {
            embeds,
            components,
        });

        setTimeout(async () => {
            try {
                if (!InteractionHelper.isInteractionValid(interaction)) {
                    return;
                }

                const closedEmbed = createEmbed({
                    title: "Hjelpemenyen er lukket",
                    description: "Hjelpemenyen har blitt lukket, bruk /hjelp på nytt.",
                    color: "secondary",
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [closedEmbed],
                    components: [],
                });
            } catch (error) {
                logger.debug('Redigering for lukking av hjelpemeny feilet (interaksjonen kan ha utløpt):', error?.message);
            }
        }, HELP_MENU_TIMEOUT_MS);
    },
};