import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { shopItems } from '../../config/shop/items.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const SHOP_ITEMS = shopItems;

export default {
    data: new SlashCommandBuilder()
        .setName('kjøp')
        .setDescription('Kjøp en gjenstand fra butikken')
        .addStringOption(option =>
            option
                .setName('gjenstand_id')
                .setDescription('ID-en til gjenstanden du vil kjøpe')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('antall')
                .setDescription('Antall du vil kjøpe (standard: 1)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const itemId = interaction.options.getString("gjenstand_id").toLowerCase();
        const quantity = interaction.options.getInteger("antall") || 1;

        const item = SHOP_ITEMS.find(i => i.id === itemId);

        if (!item) {
            throw createError(
                `Gjenstand ${itemId} ikke funnet`,
                ErrorTypes.VALIDATION,
                `Gjenstands-ID-en \`${itemId}\` finnes ikke i butikken.`,
                { itemId }
            );
        }

        if (quantity < 1) {
            throw createError(
                "Ugyldig antall",
                ErrorTypes.VALIDATION,
                "Du må kjøpe et antall på 1 eller mer.",
                { quantity }
            );
        }

        const totalCost = item.price * quantity;

        const guildConfig = await getGuildConfig(client, guildId);
        const PREMIUM_ROLE_ID = guildConfig.premiumRoleId;

        const userData = await getEconomyData(client, guildId, userId);

        if (userData.wallet < totalCost) {
            throw createError(
                "Utilstrekkelige midler",
                ErrorTypes.VALIDATION,
                `Du trenger **$${totalCost.toLocaleString()}** for å kjøpe ${quantity}x **${item.name}**, men du har bare **$${userData.wallet.toLocaleString()}** i kontanter.`,
                { required: totalCost, current: userData.wallet, itemId, quantity }
            );
        }

        if (item.type === "role" && itemId === "premium_role") {
            if (!PREMIUM_ROLE_ID) {
                throw createError(
                    "Premiumrolle ikke konfigurert",
                    ErrorTypes.CONFIGURATION,
                    "**Premiumbutikk-rollen** har ikke blitt konfigurert av en administrator ennå.",
                    { itemId }
                );
            }
            if (interaction.member.roles.cache.has(PREMIUM_ROLE_ID)) {
                throw createError(
                    "Rolle allerede eid",
                    ErrorTypes.VALIDATION,
                    `Du har allerede rollen **${item.name}**.`,
                    { itemId, roleId: PREMIUM_ROLE_ID }
                );
            }
            if (quantity > 1) {
                throw createError(
                    "Ugyldig antall for rolle",
                    ErrorTypes.VALIDATION,
                    `Du kan bare kjøpe rollen **${item.name}** én gang.`,
                    { itemId, quantity }
                );
            }
        }

        userData.wallet -= totalCost;

        let successDescription = `Du har kjøpt ${quantity}x **${item.name}** for **$${totalCost.toLocaleString()}**!`;

        if (item.type === "role" && itemId === "premium_role") {
            const member = interaction.member;

            const role = interaction.guild.roles.cache.get(PREMIUM_ROLE_ID);

            if (!role) {
                throw createError(
                    "Rolle ikke funnet",
                    ErrorTypes.CONFIGURATION,
                    "Den konfigurerte premiumrollen finnes ikke lenger på denne serveren.",
                    { roleId: PREMIUM_ROLE_ID }
                );
            }

            try {
                await member.roles.add(
                    role,
                    `Kjøpt rolle: ${item.name}`,
                );
                successDescription += `\n\n**👑 Rollen ${role.toString()} har blitt tildelt deg!**`;
            } catch (roleError) {
                userData.wallet += totalCost;
                await setEconomyData(client, guildId, userId, userData);
                throw createError(
                    "Rolletildeling mislyktes",
                    ErrorTypes.DISCORD_API,
                    "Penger ble trukket, men kunne ikke tildele rollen. Kontantene dine er refundert.",
                    { roleId: PREMIUM_ROLE_ID, originalError: roleError.message }
                );
            }
        } else if (item.type === "upgrade") {
            userData.upgrades[itemId] = true;
            successDescription += `\n\n**✨ Oppgraderingen din er nå aktiv!**`;
        } else if (item.type === "consumable" || item.type === "tool") {
            userData.inventory[itemId] =
                (userData.inventory[itemId] || 0) + quantity;
            if (item.type === "tool") {
                successDescription += `\n\n**🛠️ ${item.name} har blitt lagt til i lageret ditt!**`;
            }
        }

        await setEconomyData(client, guildId, userId, userData);

        const embed = successEmbed(
            "💰 Kjøp vellykket",
            successDescription,
        ).addFields({
            name: "Ny saldo",
            value: `$${userData.wallet.toLocaleString()}`,
            inline: true,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: [MessageFlags.Ephemeral] });
    }, { command: 'kjøp' })
};