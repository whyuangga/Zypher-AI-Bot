import type { DMChannel, GuildBasedChannel, NonThreadGuildBasedChannel } from 'discord.js';
import { clearHistory, deleteRoom, getRoomByChannel } from '../db/repo.js';
import { logger } from '../lib/logger.js';

/** Bersihkan data room ketika channel dihapus manual (bukan lewat tombol). */
export async function onChannelDelete(channel: DMChannel | NonThreadGuildBasedChannel): Promise<void> {
  if (channel.isDMBased()) return;

  const guildChannel = channel as GuildBasedChannel;
  const room = await getRoomByChannel(guildChannel.id);
  if (!room) return;

  await deleteRoom(guildChannel.id);
  await clearHistory(guildChannel.id);
  logger.info(`Room AI #${guildChannel.name} dihapus manual — data room dibersihkan.`);
}
