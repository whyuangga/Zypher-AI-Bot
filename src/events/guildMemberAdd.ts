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
  // Dicatat SEBELUM penyaringan apa pun. Tanpa baris ini, event yang tidak
  // pernah sampai (intent mati) dan event yang sengaja dilewati terlihat sama
  // persis dari log: tidak ada apa-apa. Itu yang membuat kebuntuan sebelumnya
  // mustahil didiagnosis.
  logger.info(
    `Event member masuk: ${member.user?.tag ?? member.id}` +
      `${member.user?.bot ? ' (bot)' : ''} di ${member.guild?.name ?? member.guild?.id ?? '?'}`,
  );

  // Bot ini satu server: member dari server lain tidak perlu dilayani
  // (dan seharusnya bot sudah keluar dari sana).
  if (member.guild.id !== config.discord.homeGuildId) {
    logger.info(`  ↳ dilewati: server ini bukan GUILD_ID (${config.discord.homeGuildId}).`);
    return;
  }

  try {
    const outcome = await welcomeMember(member);
    if (!outcome.sent) {
      logger.info(
        `  ↳ sambutan tidak terkirim${outcome.reason ? `: ${outcome.reason}` : ' (fitur nonaktif atau member bot).'}`,
      );
    }
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
  logger.info(
    `Event member keluar: ${member.user?.tag ?? member.id}` +
      `${member.user?.bot ? ' (bot)' : ''} dari ${member.guild?.name ?? member.guild?.id ?? '?'}`,
  );

  if (member.guild.id !== config.discord.homeGuildId) {
    logger.info(`  ↳ dilewati: server ini bukan GUILD_ID (${config.discord.homeGuildId}).`);
    return;
  }

  try {
    const sent = await goodbyeMember(member as GuildMember);
    if (!sent) logger.info('  ↳ salam perpisahan tidak terkirim (lihat alasan di atas).');
  } catch (error) {
    logger.error(`Error pada guildMemberRemove (${member.user?.tag ?? member.id})`, errorMessage(error));
  }
}
