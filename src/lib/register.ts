import type { Client } from 'discord.js';
import { commands } from '../commands/index.js';
import { config } from '../config.js';
import { errorMessage, logger } from './logger.js';

/**
 * Daftarkan slash command.
 * - DEV_GUILD_ID terisi -> command didaftarkan per-guild (langsung muncul).
 * - Kosong               -> command global (bisa butuh hingga 1 jam untuk muncul).
 */
export async function registerCommands(client: Client): Promise<void> {
  const application = client.application;
  if (!application) {
    logger.warn('Application belum siap, pendaftaran command dilewati.');
    return;
  }

  const body = commands.map((command) => command.data.toJSON());

  try {
    if (config.discord.devGuildId) {
      const guild = await client.guilds.fetch(config.discord.devGuildId);
      await guild.commands.set(body);
      logger.info(`✅ ${body.length} slash command didaftarkan di guild "${guild.name}".`);
    } else {
      await application.commands.set(body);
      logger.info(`✅ ${body.length} slash command global didaftarkan (bisa butuh hingga 1 jam untuk muncul).`);
    }
  } catch (error) {
    logger.error('Gagal mendaftarkan slash command', errorMessage(error));
  }
}
