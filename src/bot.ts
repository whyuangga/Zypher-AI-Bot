import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { closeDatabase } from './db/index.js';
import { ensureGuild, setGuildName } from './db/repo.js';
import { onChannelDelete } from './events/channelDelete.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { onMessageCreate } from './events/messageCreate.js';
import { errorMessage, logger } from './lib/logger.js';
import { startRateLimitJanitor } from './lib/ratelimit.js';
import { registerCommands } from './lib/register.js';
import { startDashboard, stopDashboard } from './web/server.js';
import { markBotOnline } from './web/status.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — aktifkan di Developer Portal
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, async (ready) => {
  logger.info(`🤖 Login sebagai ${ready.user.tag} (${ready.guilds.cache.size} server)`);
  markBotOnline(true);

  // Daftarkan semua server ke tabel `guilds` supaya dashboard langsung punya
  // daftar server yang bisa dipilih, bahkan sebelum ada room/dokumen dibuat.
  // Nama server ikut disimpan agar dropdown dashboard tidak menampilkan ID mentah.
  for (const guild of ready.guilds.cache.values()) {
    try {
      await ensureGuild(guild.id);
      await setGuildName(guild.id, guild.name);
    } catch (error) {
      logger.warn(`Gagal mendaftarkan server ${guild.id} ke database: ${errorMessage(error)}`);
    }
  }

  ready.user.setPresence({
    activities: [{ name: '/panel • room AI privat', type: ActivityType.Listening }],
    status: 'online',
  });

  await registerCommands(ready);
});

client.on(Events.InteractionCreate, (interaction) => {
  void onInteractionCreate(interaction);
});

client.on(Events.MessageCreate, (message) => {
  void onMessageCreate(message);
});

client.on(Events.ChannelDelete, (channel) => {
  void onChannelDelete(channel);
});

// Bot baru diundang ke server → langsung masuk daftar dashboard.
client.on(Events.GuildCreate, (guild) => {
  logger.info(`Bergabung ke server baru: ${guild.name} (${guild.id})`);
  void (async () => {
    await ensureGuild(guild.id);
    await setGuildName(guild.id, guild.name);
  })().catch((error: unknown) => logger.warn(`Gagal mendaftarkan server ${guild.id}: ${errorMessage(error)}`));
});

// Server di-rename (atau ikonnya diganti): nama di dashboard ikut diperbarui.
client.on(Events.GuildUpdate, (_previous, guild) => {
  void setGuildName(guild.id, guild.name).catch((error: unknown) =>
    logger.warn(`Gagal memperbarui nama server ${guild.id}: ${errorMessage(error)}`),
  );
});

client.on(Events.Error, (error) => logger.error('Discord client error', errorMessage(error)));
client.on(Events.Warn, (message) => logger.warn(`Discord warning: ${message}`));

process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', errorMessage(reason)));
process.on('uncaughtException', (error) => logger.error('Uncaught exception', errorMessage(error)));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn(`Menerima ${signal} — mematikan bot…`);
  try {
    markBotOnline(false);
    stopDashboard();
    client.destroy();
    await closeDatabase();
  } catch (error) {
    logger.error('Gagal mematikan bot dengan bersih', errorMessage(error));
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startRateLimitJanitor();
// Dashboard dinyalakan sebelum login Discord supaya tetap bisa dipakai memantau bot.
// Client dioper supaya halaman Panel bisa mengirim/menghapus panel dari browser.
startDashboard(client);

async function main(): Promise<void> {
  logger.info(`Menghubungkan ke Discord… (model AI: ${config.ai.model})`);
  try {
    await client.login(config.discord.token);
  } catch (error) {
    const message = errorMessage(error);
    logger.error('Login Discord gagal', message);
    if (message.toLowerCase().includes('token')) {
      logger.error('Cek DISCORD_TOKEN di .env — ambil ulang dari https://discord.com/developers/applications');
    }
    await closeDatabase();
    process.exit(1);
  }
}

void main();
