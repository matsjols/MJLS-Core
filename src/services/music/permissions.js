export const VOICE_CHANNEL_DENIAL =
    'Du må være i samme talekanal som boten for å bruke musikkontrollene.';

export function canControlMusic(member, player) {
    const memberChannel = member?.voice?.channel;
    if (!memberChannel || !player?.voiceChannel) {
        return false;
    }
    return memberChannel.id === player.voiceChannel;
}

export function requireVoiceChannel(member) {
    return Boolean(member?.voice?.channel);
}