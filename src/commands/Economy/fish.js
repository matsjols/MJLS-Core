import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const FISH_COOLDOWN = 45 * 60 * 1000; 
const BASE_MIN_REWARD = 300;
const BASE_MAX_REWARD = 900;
const FISHING_ROD_MULTIPLIER = 1.5;

const FISH_TYPES = [
    { name: 'Åbbor', emoji: '🐟', rarity: 'vanlig' },
    { name: 'Laks', emoji: '🐟', rarity: 'vanlig' },
    { name: 'Ørret', emoji: '🐟', rarity: 'vanlig' },
    { name: 'Tunfisk', emoji: '🐠', rarity: 'usikker' },
    { name: 'Sverdfisk', emoji: '🐠', rarity: 'usikker' },
    { name: 'Akkar', emoji: '🐙', rarity: 'sjelden' },
    { name: 'Hummer', emoji: '🦞', rarity: 'sjelden' },
    { name: 'Hai', emoji: '🦈', rarity: 'episk' },
    { name: 'Hval', emoji: '🐋', rarity: 'legendarisk' },
];

const CATCH_MESSAGES = [
    "Du kaster snøret ut i det krystallklare vannet...",
    "Du venter tålmodig mens duppen dupper i vannet...",
    "Etter noen minutters ventetid merker du et rykk...",
    "Vannet kraser idet noe biter på agnet...",
    "Du haler inn fangsten med ekspert presisjon...",
];

export default {
    data: new SlashCommandBuilder()
        .setName('fisk')
        .setDescription('Gå og fisk for å fange fisk og tjene penger'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            const userData = await getEconomyData(client, guildId, userId);
            const lastFish = userData.lastFish || 0;
            const hasFishingRod = userData.inventory["fishing_rod"] || 0;

            if (now < lastFish + FISH_COOLDOWN) {
                const remaining = lastFish + FISH_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor(
                    (remaining % (1000 * 60 * 60)) / (1000 * 60),
                );

                throw createError(
                    "Cooldown for fisking aktiv",
                    ErrorTypes.RATE_LIMIT,
                    `Du er for sliten til å fiske akkurat nå. Hvil i **${hours}t ${minutes}m** før du fisker igjen.`,
                    { remaining, cooldownType: 'fish' }
                );
            }

            const rand = Math.random();
            let fishCaught;
            
            if (rand < 0.5) {
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'vanlig')[Math.floor(Math.random() * 3)];
            } else if (rand < 0.75) {
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'usikker')[Math.floor(Math.random() * 2)];
            } else if (rand < 0.9) {
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'sjelden')[Math.floor(Math.random() * 2)];
            } else if (rand < 0.98) {
                fishCaught = FISH_TYPES.find(f => f.rarity === 'episk');
            } else {
                fishCaught = FISH_TYPES.find(f => f.rarity === 'legendarisk');
            }

            const baseEarned = Math.floor(
                Math.random() * (BASE_MAX_REWARD - BASE_MIN_REWARD + 1)
            ) + BASE_MIN_REWARD;

            let finalEarned = baseEarned;
            let multiplierMessage = "";

            if (hasFishingRod > 0) {
                finalEarned = Math.floor(baseEarned * FISHING_ROD_MULTIPLIER);
                multiplierMessage = `\n🎣 **Fiskestang-bonus: +50%**`;
            }

            const catchMessage = CATCH_MESSAGES[Math.floor(Math.random() * CATCH_MESSAGES.length)];

            userData.wallet += finalEarned;
            userData.lastFish = now;

            await setEconomyData(client, guildId, userId, userData);

            const rarityColors = {
                vanlig: '#95A5A6',
                usikker: '#2ECC71',
                sjelden: '#3498DB',
                episk: '#9B59B6',
                legendarisk: '#F1C40F'
            };

            const embed = createEmbed({
                title: 'Fiskelykke!',
                description: `${catchMessage}\n\nDu fanget en **${fishCaught.emoji} ${fishCaught.name}**! Du solgte den for **$${finalEarned.toLocaleString()}**!${multiplierMessage}`,
                color: rarityColors[fishCaught.rarity]
            })
                .addFields(
                    {
                        name: "Ny kontantsaldo",
                        value: `$${userData.wallet.toLocaleString()}`,
                        inline: true,
                    },
                    {
                        name: "Sjeldenhet",
                        value: fishCaught.rarity.charAt(0).toUpperCase() + fishCaught.rarity.slice(1),
                        inline: true,
                    }
                )
                .setFooter({ text: `Neste fisketur er tilgjengelig om 45 minutter.` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'fisk' })
};