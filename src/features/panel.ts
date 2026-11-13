/**
 * Panel "Chat via DM": kirim, pindahkan, dan hapus dari dashboard.
 *
 * Aturan produknya sederhana: **satu panel per server**, di satu channel.
 * Mengirim panel ke channel lain otomatis menghapus panel lama supaya member
 * tidak melihat dua tombol yang sama di dua tempat.
 *
 * Dashboard berjalan di proses yang sama dengan bot, jadi modul ini memakai
 * `Client` yang dioper dari `bot.ts`. Di mode dashboard-saja tidak ada client —
 * semua aksi yang butuh Discord akan melempar `PanelError` dengan pesan yang
 * jelas, bukan gagal diam-diam.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  type TextChannel,
} from 'discord.js';
import { getPanel, setPanelMessage, type PanelState } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';
import { panelEmbed, panelRow } from './ui.js';

/** Kesalahan yang aman ditampilkan ke admin dashboard apa adanya. */
export class PanelError extends Error {}

export interface PanelPublishResult {
  channelId: string;
  messageId: string;
  /** Pesan panel lama yang berhasil dihapus (kalau ada). */
  removedPrevious: boolean;
}

export interface PanelRemovalResult {
  removed: boolean;
  channelId: string | null;
}

export function requireReadyClient(client: Client | null | undefined): Client {
  if (!client || !client.isReady()) {
    throw new PanelError(
      'Bot Discord sedang offline. Panel hanya bisa dikirim/dihapus saat bot berjalan (npm run dev atau node dist/index.js) — mode dashboard saja tidak punya akses ke Discord.',
    );
  }
  return client;
}

async function fetchGuild(client: Client, guildId: string): Promise<Guild> {
  try {
    return await client.guilds.fetch(guildId);
  } catch (error) {
    throw new PanelError(`Bot tidak bisa membuka server ${guildId} (${errorMessage(error)}). Pastikan bot masih ada di server itu.`);
  }
}

async function fetchTextChannel(guild: Guild, channelId: string): Promise<TextChannel> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    throw new PanelError('Channel tidak ditemukan. Mungkin sudah dihapus — pilih channel lain.');
  }

  if (channel.type !== ChannelType.GuildText) {
    throw new PanelError('Panel hanya bisa dikirim ke channel teks biasa (bukan voice, forum, atau thread).');
  }

  return channel;
}

/** Izin bot di channel tujuan — dicek lebih dulu supaya errornya bisa dijelaskan. */
function assertCanSend(channel: TextChannel): void {
  // `guild.members.me` null saat cache belum siap — jangan menghalangi pengiriman.
  const me = channel.guild?.members?.me ?? null;
  if (!me) return;

  const permissions = channel.permissionsFor(me);
  if (!permissions) return;

  const missing: string[] = [];
  if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
  if (!permissions.has(PermissionFlagsBits.SendMessages)) missing.push('Send Messages');
  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) missing.push('Embed Links');

  if (missing.length > 0) {
    throw new PanelError(`Bot kurang izin di #${channel.name}: ${missing.join(', ')}.`);
  }
}

/** Hapus pesan panel lama. Tidak pernah melempar — panel lama boleh saja sudah hilang. */
async function deleteMessage(guild: Guild, channelId: string | null, messageId: string | null): Promise<boolean> {
  if (!channelId || !messageId) return false;

  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return false;

    const message = await (channel as GuildTextBasedChannel).messages.fetch(messageId);
    await message.delete();
    return true;
  } catch (error) {
    // 10008 Unknown Message / izin kurang: panel lama sudah tidak ada, bukan masalah.
    logger.debug(`Panel lama tidak bisa dihapus: ${errorMessage(error)}`);
    return false;
  }
}

/**
 * Kirim (atau kirim ulang) panel ke satu channel.
 *
 * Panel lama di channel mana pun milik server ini akan dihapus lebih dulu,
 * jadi jumlah panel aktif selalu satu.
 */
export async function publishPanel(client: Client, guildId: string, channelId: string): Promise<PanelPublishResult> {
  const ready = requireReadyClient(client);
  const guild = await fetchGuild(ready, guildId);
  const channel = await fetchTextChannel(guild, channelId);

  assertCanSend(channel);

  const previous = await getPanel(guildId);
  const removedPrevious = await deleteMessage(guild, previous.channelId, previous.messageId);

  let message;
  try {
    message = await channel.send({ embeds: [panelEmbed()], components: [panelRow()] });
  } catch (error) {
    throw new PanelError(`Gagal mengirim panel ke #${channel.name}: ${errorMessage(error)}`);
  }

  await setPanelMessage(guildId, channel.id, message.id);

  return { channelId: channel.id, messageId: message.id, removedPrevious };
}

/** Hapus panel aktif. Pesan yang sudah dihapus manual tetap membersihkan catatannya. */
export async function removePanel(client: Client, guildId: string): Promise<PanelRemovalResult> {
  const ready = requireReadyClient(client);
  const guild = await fetchGuild(ready, guildId);
  const state = await getPanel(guildId);

  if (!state.messageId) {
    await setPanelMessage(guildId, null, null);
    return { removed: false, channelId: null };
  }

  const removed = await deleteMessage(guild, state.channelId, state.messageId);
  await setPanelMessage(guildId, null, null);

  return { removed, channelId: state.channelId };
}

export interface PanelChannelOption {
  id: string;
  name: string;
  /**
   * true = ini thread/forum post yang SUDAH ada, bukan channel teks biasa.
   *
   * Discohook bisa mengirim ke thread yang sudah ada (`?thread_id=` pada URL
   * webhook). Padanannya di sini adalah channel tujuan yang berupa thread:
   * pesan dikirim ke dalamnya, bukan membuat thread baru.
   */
  thread?: boolean;
}

/** Channel teks yang bisa dipakai panel — untuk dropdown di dashboard. */
export async function listPanelChannels(client: Client, guildId: string): Promise<PanelChannelOption[]> {
  const ready = requireReadyClient(client);
  const guild = await fetchGuild(ready, guildId);

  const channels = await guild.channels.fetch();
  return [...channels.values()]
    .filter((channel): channel is TextChannel => Boolean(channel) && channel!.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .slice(0, 200)
    .map((channel) => ({ id: channel.id, name: channel.name }));
}

/** Jenis channel yang bisa menerima pesan bot (teks + thread/forum post). */
const JENIS_TEKS = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

/**
 * Tujuan kirim `/pesan`: channel teks **dan** thread yang sudah ada.
 *
 * Kenapa thread ikut: banyak pengumuman sebenarnya ditujukan ke thread yang
 * sudah berjalan (thread rilis, thread tiket, forum post). Tanpa thread di
 * daftar, admin harus menempel ID secara manual — dan di dashboard ID itu
 * memang tidak bisa ditempel (isiannya berupa pilihan).
 *
 * Thread yang DIARSIPKAN tetap ditampilkan: Discord membuka arsipnya sendiri
 * saat bot mengirim, dan menyembunyikannya membuat tujuan yang sah terlihat
 * hilang. Namanya diberi awalan induk supaya jelas di daftar.
 */
export async function listKirimTargets(client: Client, guildId: string): Promise<PanelChannelOption[]> {
  const ready = requireReadyClient(client);
  const guild = await fetchGuild(ready, guildId);

  const channels = await guild.channels.fetch();
  const options: PanelChannelOption[] = [];
  for (const channel of channels.values() as Iterable<
    { id: string; name: string; type: ChannelType; isThread(): boolean } | null
  >) {
    if (!channel || !JENIS_TEKS.has(channel.type)) continue;
    if (!channel.isThread() && channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      continue;
    }
    /*
     * Nama thread diberi awalan induknya: daftar berisi puluhan channel, dan
     * thread bernama "Rilis" tidak bisa dibedakan dari thread "Rilis" di
     * channel lain tanpa awalan itu.
     */
    const induk = channel.isThread()
      ? (channel as unknown as { parent?: { name?: string } | null }).parent?.name ?? 'thread'
      : '';
    options.push({
      id: channel.id,
      name: induk ? `${induk} › ${channel.name}` : channel.name,
      ...(induk ? { thread: true } : {}),
    });
    if (options.length >= 300) break;
  }
  return options.sort((a, b) => Number(Boolean(a.thread)) - Number(Boolean(b.thread)) || a.name.localeCompare(b.name));
}

/** Status panel untuk dashboard (tanpa akses Discord). */
export async function panelState(guildId: string): Promise<PanelState> {
  return getPanel(guildId);
}
