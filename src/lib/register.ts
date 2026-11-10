import type { Client } from 'discord.js';
import { commands } from '../commands/index.js';
import { config } from '../config.js';
import { errorMessage, logger } from './logger.js';

/**
 * Daftarkan slash command.
 *
 * **Global selalu didaftarkan**.
 * Alasannya: command per-guild (`guild.commands.set`) **tidak pernah muncul di
 * DM bot**. Karena seluruh percakapan AI pindah ke DM, command seperti
 * `/akhiri` wajib ada di scope global.
 *
 * Command juga didaftarkan di server rumah (`GUILD_ID`) supaya langsung muncul
 * tanpa menunggu cache global — itu tambahan, bukan pengganti.
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

  // 2. Server rumah — didaftarkan juga per-guild supaya muncul instan tanpa
  //    menunggu cache global Discord (bisa sampai 1 jam).
  try {
    const guild = await client.guilds.fetch(config.discord.homeGuildId);
    await guild.commands.set(body);
    logger.info(`✅ ${body.length} slash command juga didaftarkan di guild "${guild.name}" (instan).`);
  } catch (error) {
    logger.warn(
      `Gagal mendaftarkan command di GUILD_ID (${config.discord.homeGuildId}) — command global tetap jalan.`,
      errorMessage(error),
    );
  }
}
