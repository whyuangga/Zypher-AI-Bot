/**
 * Perubahan keanggotaan server: member baru (sambutan) dan member keluar
 * (salam perpisahan).
 *
 * Dua event dikumpulkan di satu file karena satu kesatuan fitur "kehadiran":
 * keadaan pengaturannya ada di halaman dashboard yang sama.
 *
 * Sambutan & perpisahan sama-sama mati secara default; admin menyalakannya di
 * dashboard → Sambutan.
 */
import type { GuildMember, PartialGuildMember } from 'discord.js';
import { config } from '../config.js';
import { errorMessage, logger } from '../lib/logger.js';
import { goodbyeMember, welcomeMember } from '../features/welcome.js';

/** Member baru bergabung → sambutan. */
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

/**
 * Member keluar → salam perpisahan.
 *
 * `PartialGuildMember` muncul kalau event terjadi saat cache belum lengkap;
 * semua field yang dipakai (`displayName`, `user`, `guild`) tetap tersedia.
 */
export async function onGuildMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  if (member.guild.id !== config.discord.homeGuildId) return;

  try {
    await goodbyeMember(member as GuildMember);
  } catch (error) {
    logger.error(`Error pada guildMemberRemove (${member.user?.tag ?? member.id})`, errorMessage(error));
  }
}
