import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const CRIME_COOLDOWN = 60 * 60 * 1000;
const JAIL_TIME = 2 * 60 * 60 * 1000;
const FINE_RATE = 0.2;

const CRIME_TYPES = [
    { name: "Lommetyveri", min: 100, max: 500, risk: 0.3 },
    { name: "Innbrudd", min: 300, max: 1000, risk: 0.4 },
    { name: "Bankran", min: 1000, max: 5000, risk: 0.6 },
    { name: "Kunsttyveri", min: 2000, max: 10000, risk: 0.7 },
    { name: "Datakriminalitet", min: 5000, max: 20000, risk: 0.8 },
];

export default {
    data: new SlashCommandBuilder()
        .setName('krim')
        .setDescription('Begå en forbrytelse for å tjene penger (risikabelt)')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Type forbrytelse du vil begå')
                .setRequired(true)
                .addChoices(
                    { name: 'Lommetyveri', value: 'lommetyveri' },
                    { name: 'Innbrudd', value: 'innbrudd' },
                    { name: 'Bankran', value: 'bankran' },
                    { name: 'Kunsttyveri', value: 'kunsttyveri' },
                    { name: 'Datakriminalitet', value: 'datakriminalitet' },
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        await InteractionHelper.safeDefer(interaction);
            
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const now = Date.now();

        const userData = await getEconomyData(client, guildId, userId);
        const lastCrime = userData.cooldowns?.crime || 0;
        const isJailed = userData.jailedUntil && userData.jailedUntil > now;

        if (isJailed) {
            const timeLeft = Math.ceil((userData.jailedUntil - now) / (1000 * 60));
            throw createError(
                "Brukeren er i fengsel",
                ErrorTypes.RATE_LIMIT,
                `Du sitter i fengsel i ${timeLeft} minutter til!`,
                { jailTimeRemaining: userData.jailedUntil - now }
            );
        }

        if (now < lastCrime + CRIME_COOLDOWN) {
            const timeLeft = Math.ceil((lastCrime + CRIME_COOLDOWN - now) / (1000 * 60));
            throw createError(
                "Cooldown for kriminalitet aktiv",
                ErrorTypes.RATE_LIMIT,
                `Du må vente ${timeLeft} minutter til før du kan begå en ny forbrytelse.`,
                { remaining: lastCrime + CRIME_COOLDOWN - now, cooldownType: 'crime' }
            );
        }

        const crimeType = interaction.options.getString("type").toLowerCase();
        const crimeMap = {
            'lommetyveri': 'Lommetyveri',
            'innbrudd': 'Innbrudd',
            'bankran': 'Bankran',
            'kunsttyveri': 'Kunsttyveri',
            'datakriminalitet': 'Datakriminalitet'
        };

        const targetCrimeName = crimeMap[crimeType];
        const crime = CRIME_TYPES.find(c => c.name === targetCrimeName);

        if (!crime) {
            throw createError(
                "Ugyldig type forbrytelse",
                ErrorTypes.VALIDATION,
                "Vennligst velg en gyldig type forbrytelse.",
                { crimeType }
            );
        }

        const isSuccess = Math.random() > crime.risk;
        const amountEarned = isSuccess
            ? Math.floor(Math.random() * (crime.max - crime.min + 1)) + crime.min
            : 0;

        userData.cooldowns = userData.cooldowns || {};
        userData.cooldowns.crime = now;

        if (isSuccess) {
            userData.wallet = (userData.wallet || 0) + amountEarned;
            
            await setEconomyData(client, guildId, userId, userData);
            
            const embed = successEmbed(
                "🕵️ Vellykket brekk!",
                `Du gjennomførte **${crime.name}** og tjente **$${amountEarned.toLocaleString()}**!`
            );
            
            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        } else {
            const potentialHaul = Math.floor((crime.min + crime.max) / 2);
            const fine = Math.min(Math.floor(potentialHaul * FINE_RATE), userData.wallet || 0);
            userData.wallet = Math.max(0, (userData.wallet || 0) - fine);
            userData.jailedUntil = now + JAIL_TIME;
            
            await setEconomyData(client, guildId, userId, userData);
            
            const embed = warningEmbed(
                "🚔 Forbrytelsen mislyktes!",
                `Du ble tatt mens du forsøkte å begå **${crime.name}** og ble sendt i fengsel! ` +
                `Du fikk en bot på **$${fine.toLocaleString()}** og må sitte i fengsel i 2 timer.`
            );
            
            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }
    }, { command: 'krim' })
};