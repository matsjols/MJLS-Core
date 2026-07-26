import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { logModerationAction } from '../../utils/moderation.js';

function getTargetLabel(target) {
  return target.user?.tag ?? target.displayName ?? 'denne brukeren';
}

function getHighestRole(member) {
  return member?.roles?.highest ?? null;
}

export class ModerationService {

  static buildHierarchyMessage({ actor, actorRole, targetRole, targetLabel, action }) {
    if (actor === 'moderator') {
      return (
        `Du kan ikke utføre **${action}** på **${targetLabel}** — rollen deres **${targetRole.name}** er lik eller høyere enn din (**${actorRole.name}**). ` +
        `I **Serverinnstillinger → Roller**, dra moderatorrollen din over **${targetRole.name}**.`
      );
    }

    return (
      `Jeg kan ikke utføre **${action}** på **${targetLabel}** — min rolle **${actorRole.name}** er lik eller lavere enn deres (**${targetRole.name}**). ` +
      `I **Serverinnstillinger → Roller**, dra botrollen min over **${targetRole.name}**.`
    );
  }

  static buildHierarchySkipReason(moderator, target, action, actor = 'moderator') {
    const targetLabel = getTargetLabel(target);
    const targetRole = getHighestRole(target);

    if (actor === 'bot') {
      const botMember = target.guild?.members?.me;
      const botRole = getHighestRole(botMember);
      if (!botRole || !targetRole) {
        return `Botens rolle-hierarki blokkerte ${action} for ${targetLabel}`;
      }
      return `Botens rolle **${botRole.name}** er for lav for **${targetRole.name}** — flytt botrollen høyere`;
    }

    const modRole = getHighestRole(moderator);
    if (!modRole || !targetRole) {
      return `Rolle-hierarkiet blokkerte ${action} for ${targetLabel}`;
    }
    return `Rollen din **${modRole.name}** er for lav for **${targetRole.name}** — flytt rollen din høyere`;
  }

  static validateHierarchy(moderator, target, action) {
    if (!moderator || !target) {
      return { valid: false, error: 'Ugyldig moderator eller mål' };
    }

    if (moderator.guild?.ownerId === moderator.id) {
      return { valid: true };
    }

    const modRole = getHighestRole(moderator);
    const targetRole = getHighestRole(target);

    if (!modRole || !targetRole) {
      return {
        valid: false,
        error: 'Kunne ikke fastslå rolle-hierarki. Prøv å nevne brukeren eller bruk skråstrek-kommandoen (slash command).',
      };
    }

    if (modRole.position <= targetRole.position) {
      return {
        valid: false,
        error: this.buildHierarchyMessage({
          actor: 'moderator',
          actorRole: modRole,
          targetRole,
          targetLabel: getTargetLabel(target),
          action,
        }),
      };
    }

    return { valid: true };
  }

  static validateBotHierarchy(target, action) {
    if (!target) {
      return { valid: false, error: 'Ugyldig mål' };
    }

    const botMember = target.guild?.members?.me;
    if (!botMember) {
      return { valid: false, error: 'Boten er ikke i serveren' };
    }

    const botRole = getHighestRole(botMember);
    const targetRole = getHighestRole(target);

    if (!botRole || !targetRole) {
      return {
        valid: false,
        error: 'Kunne ikke fastslå botens rolle-hierarki. Sjekk at rollen min er konfigurert i denne serveren.',
      };
    }

    if (botRole.position <= targetRole.position) {
      return {
        valid: false,
        error: this.buildHierarchyMessage({
          actor: 'bot',
          actorRole: botRole,
          targetRole,
          targetLabel: getTargetLabel(target),
          action,
        }),
      };
    }

    return { valid: true };
  }

  static assertModerationHierarchy(moderator, target, action) {
    const botCheck = this.validateBotHierarchy(target, action);
    if (!botCheck.valid) {
      throw new TitanBotError(botCheck.error, ErrorTypes.PERMISSION, botCheck.error);
    }

    const modCheck = this.validateHierarchy(moderator, target, action);
    if (!modCheck.valid) {
      throw new TitanBotError(modCheck.error, ErrorTypes.PERMISSION, modCheck.error);
    }
  }

  static async banUser({
    guild,
    user,
    moderator,
    reason = 'Ingen grunn oppgitt',
    deleteDays = 0
  }) {
    try {
      if (!guild || !user || !moderator) {
        throw new TitanBotError(
          'Mangler obligatoriske parametere',
          ErrorTypes.VALIDATION,
          'Server (guild), bruker og moderator kreves'
        );
      }

      let targetMember = null;
      try {
        targetMember = await guild.members.fetch(user.id).catch(() => null);
      } catch (err) {
        logger.debug('Målet er ikke i serveren, fortsetter med utvisning (ban)');
      }

      if (targetMember) {
        this.assertModerationHierarchy(moderator, targetMember, 'ban');
      } else {

        const isOwner = guild.ownerId === moderator.id;
        const hasHighPerms = moderator.permissions.has([
            PermissionFlagsBits.ManageGuild,
            PermissionFlagsBits.Administrator
        ]);

        if (!isOwner && !hasHighPerms) {
            throw new TitanBotError(
                'Du har ikke tilstrekkelige rettigheter til å bannlyse brukere som ikke er i serveren.',
                ErrorTypes.PERMISSION,
                'Du trenger rettighetene "Administrer server" eller "Administrator" for å bannlyse brukere som ikke er i serveren.'
            );
        }
      }

      await guild.members.ban(user.id, { reason });

      const caseId = await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Medlem utvist (Banned)',
          target: `${user.tag} (${user.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          metadata: {
            userId: user.id,
            moderatorId: moderator.id,
            permanent: true,
            deleteDays
          }
        }
      });

      logger.info(`Bruker utvist: ${user.tag} av ${moderator.user.tag} i ${guild.name}`);
      
      return {
        caseId,
        user: user.tag,
        reason
      };
    } catch (error) {
      logger.error('Feil ved utvisning av bruker:', error);
      throw error;
    }
  }

  static async kickUser({
    guild,
    member,
    moderator,
    reason = 'Ingen grunn oppgitt'
  }) {
    try {
      if (!guild || !member || !moderator) {
        throw new TitanBotError(
          'Mangler obligatoriske parametere',
          ErrorTypes.VALIDATION,
          'Server (guild), medlem og moderator kreves'
        );
      }

      this.assertModerationHierarchy(moderator, member, 'sparke ut');

      if (!member.kickable) {
        const targetLabel = getTargetLabel(member);
        throw new TitanBotError(
          'Kan ikke sparke ut medlem',
          ErrorTypes.PERMISSION,
          `Jeg kan ikke sparke ut **${targetLabel}**. De har kanskje **Administrator**-rettighet eller en administrert/integrasjonsrolle. ` +
          'Sørg for at botrollen min er over deres i **Serverinnstillinger → Roller** og at de ikke har Administrator.'
        );
      }

      await member.kick(reason);

      const caseId = await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Medlem sparket ut (Kicked)',
          target: `${member.user.tag} (${member.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          metadata: {
            userId: member.id,
            moderatorId: moderator.id
          }
        }
      });

      logger.info(`Bruker sparket ut: ${member.user.tag} av ${moderator.user.tag} i ${guild.name}`);
      
      return {
        caseId,
        user: member.user.tag,
        reason
      };
    } catch (error) {
      logger.error('Feil ved utsparking av bruker:', error);
      throw error;
    }
  }

  static async timeoutUser({
    guild,
    member,
    moderator,
    durationMs,
    reason = 'Ingen grunn oppgitt'
  }) {
    try {
      if (!guild || !member || !moderator || !durationMs) {
        throw new TitanBotError(
          'Mangler obligatoriske parametere',
          ErrorTypes.VALIDATION,
          'Server, medlem, moderator og varighet kreves'
        );
      }

      this.assertModerationHierarchy(moderator, member, 'gi timeout til');

      if (!member.moderatable) {
        const targetLabel = getTargetLabel(member);
        throw new TitanBotError(
          'Kan ikke gi medlem timeout',
          ErrorTypes.PERMISSION,
          `Jeg kan ikke gi **${targetLabel}** timeout. De har kanskje **Administrator**-rettighet eller en administrert/integrasjonsrolle. ` +
          'Sørg for at botrollen min er over deres i **Serverinnstillinger → Roller** og at de ikke har Administrator.'
        );
      }

      await member.timeout(durationMs, reason);

      const durationMinutes = Math.floor(durationMs / 60000);
      const caseId = await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Medlem gitt timeout',
          target: `${member.user.tag} (${member.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          duration: `${durationMinutes} minutter`,
          metadata: {
            userId: member.id,
            moderatorId: moderator.id,
            durationMs
          }
        }
      });

      logger.info(`Bruker gitt timeout: ${member.user.tag} av ${moderator.user.tag} i ${guild.name}`);
      
      return {
        caseId,
        user: member.user.tag,
        duration: durationMinutes,
        reason
      };
    } catch (error) {
      logger.error('Feil ved timeout på bruker:', error);
      throw error;
    }
  }

  static async removeTimeoutUser({
    guild,
    member,
    moderator,
    reason = 'Timeout fjernet av moderator'
  }) {
    try {
      if (!guild || !member || !moderator) {
        throw new TitanBotError(
          'Mangler obligatoriske parametere',
          ErrorTypes.VALIDATION,
          'Server, medlem og moderator kreves'
        );
      }

      this.assertModerationHierarchy(moderator, member, 'fjerne timeout fra');

      if (!member.moderatable) {
        const targetLabel = getTargetLabel(member);
        throw new TitanBotError(
          'Kan ikke endre medlem',
          ErrorTypes.PERMISSION,
          `Jeg kan ikke endre **${targetLabel}**. De har kanskje **Administrator**-rettighet eller en administrert/integrasjonsrolle. ` +
          'Sørg for at botrollen min er over deres i **Serverinnstillinger → Roller**.'
        );
      }

      if (!member.isCommunicationDisabled()) {
        throw new TitanBotError(
          'Brukeren har ikke timeout',
          ErrorTypes.VALIDATION,
          `${member.user.tag} har for øyeblikket ikke timeout`
        );
      }

      await member.timeout(null, reason);

      await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Timeout fjernet fra medlem',
          target: `${member.user.tag} (${member.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          metadata: {
            userId: member.id,
            moderatorId: moderator.id
          }
        }
      });

      logger.info(`Timeout fjernet: ${member.user.tag} av ${moderator.user.tag} i ${guild.name}`);
      
      return {
        user: member.user.tag
      };
    } catch (error) {
      logger.error('Feil ved fjerning av timeout:', error);
      throw error;
    }
  }

  static async unbanUser({
    guild,
    user,
    moderator,
    reason = 'Ingen grunn oppgitt'
  }) {
    try {
      if (!guild || !user || !moderator) {
        throw new TitanBotError(
          'Mangler obligatoriske parametere',
          ErrorTypes.VALIDATION,
          'Server, bruker og moderator kreves'
        );
      }

      const bans = await guild.bans.fetch();
      const banInfo = bans.get(user.id);

      if (!banInfo) {
        throw new TitanBotError(
          'Bruker ikke bannlyst',
          ErrorTypes.VALIDATION,
          `${user.tag} er for øyeblikket ikke utvist fra denne serveren`
        );
      }

      await guild.members.unban(user.id, reason);

      const caseId = await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Medlem opphevet utvisning (Unbanned)',
          target: `${user.tag} (${user.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          metadata: {
            userId: user.id,
            moderatorId: moderator.id
          }
        }
      });

      logger.info(`Utvisning opphevet for bruker: ${user.tag} av ${moderator.user.tag} i ${guild.name}`);
      
      return {
        caseId,
        user: user.tag,
        reason
      };
    } catch (error) {
      logger.error('Feil ved oppheving av utvisning:', error);
      throw error;
    }
  }
}