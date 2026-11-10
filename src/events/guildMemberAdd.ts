/**
 * Member baru bergabung → kirim sambutan.
 *
 * Dipisah dari `bot.ts` supaya alur sambutan mudah ditelusuri. Sambutan
 * dimatikan secara default; admin menyalakannya di dashboard → Sambutan.
 */
import type { GuildMember } from 'discord.js';
import { config } from '../config.js';
import { errorMessage, logger } from '../lib/logger.js';
import { welcomeMember } from '../features/welcome.js';

export async function onGuildMemberAdd(member: GuildMember): Promise<void> {
  // Bot ini satu server: member dari server lain tidak perlu dilayani
  // (dan seharusnya bot sudah keluar dari sana).
  if (member.guild.id !== config.discord.homeGuildId) return;

  try {
    await welcomeMember(member);
  } catch (error) {
    logger.error(`Error pada guildMemberAdd (${member.user?.tag ?? member.id})`, errorMessage(error));
  }
}
