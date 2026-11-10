import type { Client } from 'discord.js';
import { commands } from '../commands/index.js';
import { config } from '../config.js';
import { errorMessage, logger } from './logger.js';

/**
 * Daftarkan slash command.
 *
 * **Global selalu didaftarkan**, bukan hanya saat `DEV_GUILD_ID` kosong.
 * Alasannya: command per-guild (`guild.commands.set`) **tidak pernah muncul di
 * DM bot**. Karena seluruh percakapan AI pindah ke DM, command seperti
 * `/akhiri` dan `/server` wajib ada di scope global.
 *
 * `DEV_GUILD_ID` tetap dipakai supaya command langsung muncul di satu server
 * untuk pengujian, tapi itu tambahan — bukan pengganti.
 */
export async function registerCommands(client: Client): Promise<void> {
  const application = client.application;
  if (!application) {
    logger.warn('Application belum siap, pendaftaran command dilewati.');
    return;
  }

  const body = commands.map((command) => command.data.toJSON());

  // 1. Global — satu-satunya cara command bisa dipakai di DM.
  try {
    await application.commands.set(body);
    logger.info(
      `✅ ${body.length} slash command global didaftarkan (termasuk untuk DM). ` +
        'Bisa butuh hingga 1 jam untuk muncul pertama kali.',
    );
  } catch (error) {
    logger.error('Gagal mendaftarkan slash command global', errorMessage(error));
  }

  // 2. Guild pengembangan — instan, untuk mencoba tanpa menunggu cache global.
  if (config.discord.devGuildId) {
    try {
      const guild = await client.guilds.fetch(config.discord.devGuildId);
      await guild.commands.set(body);
      logger.info(`✅ ${body.length} slash command juga didaftarkan di guild "${guild.name}" (instan).`);
    } catch (error) {
      logger.warn(
        `Gagal mendaftarkan command di DEV_GUILD_ID (${config.discord.devGuildId}) — command global tetap jalan.`,
        errorMessage(error),
      );
    }
  }
}
