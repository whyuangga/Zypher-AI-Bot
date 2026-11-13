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
import type { Client, GuildMember, PartialGuildMember } from 'discord.js';
import { config } from '../config.js';
import { errorMessage, logger } from '../lib/logger.js';
import { goodbyeMember, welcomeMember } from '../features/welcome.js';
import { runTriggers } from '../features/post-trigger.js';

/**
 * Member baru bergabung → sambutan + pesan /pesan ber-pemicu `member_add`.
 *
 * `client` opsional supaya pemanggil lama (dan test) tetap jalan: tanpa client,
 * hanya sambutan yang diproses.
 */
export async function onGuildMemberAdd(member: GuildMember, client?: Client | null): Promise<void> {
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

  /*
   * Pesan /pesan ber-pemicu. Dijalankan SESUDAH sambutan dan di luar
   * try/catch-nya: kegagalan sambutan tidak boleh menahan pesan pemicu, dan
   * sebaliknya. Pesan dari bot lain (`member.user.bot`) tetap dilayani —
   * admin yang memasang pemicu "member masuk" memang menginginkan tiap
   * anggota baru, termasuk bot, sama seperti Discohook.
   */
  if (!client) return;
  try {
    await runTriggers({ client, guildId: member.guild.id, trigger: 'member_add' });
  } catch (error) {
    logger.error(`Error pada pemicu member_add (${member.user?.tag ?? member.id})`, errorMessage(error));
  }
}

/**
 * Member keluar → salam perpisahan.
 *
 * `PartialGuildMember` muncul kalau event terjadi saat cache belum lengkap;
 * semua field yang dipakai (`displayName`, `user`, `guild`) tetap tersedia.
 */
export async function onGuildMemberRemove(
  member: GuildMember | PartialGuildMember,
  client?: Client | null,
): Promise<void> {
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

  if (!client) return;
  try {
    await runTriggers({ client, guildId: member.guild.id, trigger: 'member_remove' });
  } catch (error) {
    logger.error(`Error pada pemicu member_remove (${member.user?.tag ?? member.id})`, errorMessage(error));
  }
}
