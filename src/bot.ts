import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type GuildBasedChannel,
} from 'discord.js';
import { config } from './config.js';
import { closeDatabase } from './db/index.js';
import { ensureGuild, setGuildName } from './db/repo.js';
import { onGuildMemberAdd, onGuildMemberRemove } from './events/guildMemberAdd.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { onMessageCreate } from './events/messageCreate.js';
import { handleQuietChannel, pruneAgentState } from './features/agent.js';
import { runDueFlowSessions } from './features/post-action-runner.js';
import { runDueSchedules } from './features/post-scheduler.js';
import { pruneFlowSessions } from './db/repo.js';
import { getAgentSettings } from './db/repo.js';
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
    // Sambutan member baru.
    GatewayIntentBits.GuildMembers, // privileged — aktifkan di Developer Portal
    // Reaksi AI terhadap emoji/sticker/gambar di channel agent.
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once(Events.ClientReady, async (ready) => {
  const homeId = config.discord.homeGuildId;
  const home = ready.guilds.cache.get(homeId);
  logger.info(`🤖 Login sebagai ${ready.user.tag} — server: ${home ? home.name : `GUILD_ID ${homeId} (belum diundang)`}`);

  if (!home) {
    logger.error(
      `Bot tidak ada di server GUILD_ID=${homeId}. ` +
        'Undang bot ke server itu, atau perbaiki GUILD_ID di .env.',
    );
  }

  // Bot ini untuk satu server: keluarkan diri dari server lain yang tidak sengaja
  // mengundangnya. Tanpa ini, orang lain bisa memakai bot beserta API key pemilik.
  await leaveOtherGuilds(ready);

  try {
    await ensureGuild(homeId);
    if (home) await setGuildName(homeId, home.name);
  } catch (error) {
    logger.warn(`Gagal mendaftarkan server ${homeId} ke database: ${errorMessage(error)}`);
  }

  markBotOnline(true);

  // Diagnostik intent: tanpa GuildMembers (privileged), Discord tidak pernah
  // mengirim event member join/leave — sambutan & perpisahan diam total tanpa
  // satu pun error di log. Tanpa baris ini, penyebabnya mustahil ditebak dari
  // log; dulu user hanya melihat "bot tidak bereaksi" padahal semuanya benar.
  const hasMembersIntent = ready.options.intents.has(GatewayIntentBits.GuildMembers);
  if (hasMembersIntent) {
    logger.info('✓ Intent Server Members aktif — sambutan & perpisahan bisa menerima event.');
  } else {
    logger.warn(
      '✗ Intent Server Members NONAKTIF — event member join/leave TIDAK akan pernah diterima, ' +
        'sehingga sambutan & salam perpisahan tidak akan terkirim. ' +
        'Nyalakan di Discord Developer Portal → Bot → Privileged Gateway Intents → Server Members Intent, ' +
        'lalu RESTART bot.',
    );
  }

  ready.user.setPresence({
    activities: [{ name: '/panel • chat AI via DM', type: ActivityType.Listening }],
    status: 'online',
  });

  await registerCommands(ready);
});

client.on(Events.InteractionCreate, (interaction) => {
  // `client` diteruskan supaya aksi "kirim pesan tersimpan" bisa mengirim pesan.
  void onInteractionCreate(interaction, client);
});

client.on(Events.MessageCreate, (message) => {
  void onMessageCreate(message);
});

/**
 * Keluarkan bot dari semua server selain `GUILD_ID`.
 *
 * Bot ini dirancang untuk satu server: satu token, satu set API key. Kalau
 * diundang ke server lain, biaya API dan data server itu bercampur — jadi
 * lebih aman menolak dengan sopan lalu keluar.
 */
async function leaveOtherGuilds(client: Client): Promise<void> {
  const homeId = config.discord.homeGuildId;

  for (const guild of client.guilds.cache.values()) {
    if (guild.id === homeId) continue;

    logger.warn(`Keluar dari server lain: ${guild.name} (${guild.id}) — bot ini hanya untuk satu server.`);

    // Cari channel tempat bot boleh menulis, supaya alasannya bisa dibaca admin.
    const me = guild.members.me;
    const channel = guild.channels.cache.find(
      (candidate): candidate is GuildBasedChannel & { send: (content: string) => Promise<unknown> } =>
        Boolean(
          me &&
            candidate.isTextBased() &&
            !candidate.isDMBased() &&
            candidate.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages),
        ),
    );

    if (channel) {
      await channel
        .send(
          [
            '👋 Bot ini **hanya untuk satu server**.',
            '',
            'Kalau ingin memakai versi sendiri: fork repo-nya, pakai API key dan token milikmu,',
            'lalu isi `GUILD_ID` dengan ID server kamu. Bot akan keluar dari server ini sekarang.',
          ].join('\n'),
        )
        .catch(() => undefined);
    }

    await guild.leave().catch((error: unknown) => {
      logger.warn(`Gagal keluar dari server ${guild.id}: ${errorMessage(error)}`);
    });
  }
}

// Member baru bergabung → sambutan + pesan /pesan ber-pemicu `member_add`.
client.on(Events.GuildMemberAdd, (member) => {
  void onGuildMemberAdd(member, client);
});

// Member keluar → salam perpisahan + pesan /pesan ber-pemicu `member_remove`.
client.on(Events.GuildMemberRemove, (member) => {
  void onGuildMemberRemove(member, client);
});

/**
 * Timer "channel sepi".
 *
 * Dicek tiap menit, tapi keputusan menyapa ada di `shouldBreakSilence()`
 * supaya tidak pernah menyapa lebih cepat dari `quietMinutes`. Hanya server
 * rumah yang diperiksa — bot ini memang satu server.
 */
const QUIET_CHECK_MS = 60_000;
let quietTimer: NodeJS.Timeout | undefined;

function startQuietWatcher(target: Client): void {
  quietTimer = setInterval(() => {
    void (async () => {
      try {
        const guildId = config.discord.homeGuildId;
        const settings = await getAgentSettings(guildId);
        // Fitur mati atau timer tidak diaktifkan: tidak perlu memanggil model.
        if (!settings.channelId || settings.quietMinutes <= 0) return;
        await handleQuietChannel(target, guildId);
        pruneAgentState();
      } catch (error) {
        logger.warn('Pemeriksaan channel sepi gagal', errorMessage(error));
      }
    })();
  }, QUIET_CHECK_MS);
  quietTimer.unref?.();
}

/**
 * Timer flow `/pesan` yang sedang menunggu (aksi "Tunggu").
 *
 * Beberapa keputusan di sini disengaja:
 *
 *   - Diperiksa tiap 15 detik, bukan tiap detik: penantian dijanjikan dalam
 *     satuan detik/menit, dan query tiap detik hanya membebani database.
 *     Konsekuensinya aksi bisa berjalan beberapa detik terlambat — itu
 *     disebutkan di dokumentasi, bukan disembunyikan.
 *   - Putaran PERTAMA dijalankan 5 detik sesudah bot hidup, supaya penantian
 *     yang jatuh tempo saat bot mati (deploy) tidak menunggu 15 detik lagi.
 *   - Pemangkasan sesi kedaluwarsa (lebih dari 30 hari) ikut di sini: pengingat
 *     selama itu sudah tidak berguna, dan menjalankannya mendadak setelah bot
 *     lama mati hanya membingungkan member.
 */
const FLOW_CHECK_MS = 15_000;
const FLOW_PRUNE_MS = 6 * 60 * 60 * 1000;
const FLOW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let flowTimer: NodeJS.Timeout | undefined;
let pruneTimer: NodeJS.Timeout | undefined;

function startFlowWatcher(target: Client): void {
  const putaran = (): void => {
    void (async () => {
      try {
        const jumlah = await runDueFlowSessions(target);
        if (jumlah > 0) logger.info(`Flow /pesan: ${jumlah} penantian dilanjutkan.`);
        // Jadwal kirim memakai putaran yang sama: dua timer terpisah hanya
        // menambah keadaan yang harus dijelaskan saat ada masalah.
        const terkirim = await runDueSchedules(target, config.discord.homeGuildId);
        if (terkirim > 0) logger.info(`Jadwal /pesan: ${terkirim} pesan terkirim.`);
      } catch (error) {
        logger.warn('Pemeriksaan flow /pesan gagal', errorMessage(error));
      }
    })();
  };

  flowTimer = setInterval(putaran, FLOW_CHECK_MS);
  flowTimer.unref?.();
  // Sesi yang jatuh tempo selagi bot mati dijalankan segera, tanpa menunggu
  // interval pertama.
  const awal = setTimeout(putaran, 5_000);
  awal.unref?.();

  const pangkas = (): void => {
    void pruneFlowSessions(Date.now() - FLOW_MAX_AGE_MS)
      .then((jumlah) => {
        if (jumlah > 0) logger.info(`Flow /pesan: ${jumlah} penantian kedaluwarsa dibuang.`);
      })
      .catch((error: unknown) => logger.warn('Gagal memangkas sesi flow', errorMessage(error)));
  };
  pruneTimer = setInterval(pangkas, FLOW_PRUNE_MS);
  pruneTimer.unref?.();
}

// Bot diundang ke server: kalau bukan server rumah, tolak dengan sopan.
client.on(Events.GuildCreate, (guild) => {
  if (guild.id === config.discord.homeGuildId) {
    logger.info(`Bergabung ke server rumah: ${guild.name} (${guild.id})`);
    void (async () => {
      await ensureGuild(guild.id);
      await setGuildName(guild.id, guild.name);
    })().catch((error: unknown) => logger.warn(`Gagal mendaftarkan server ${guild.id}: ${errorMessage(error)}`));
    return;
  }

  logger.warn(`Diundang ke server lain: ${guild.name} (${guild.id}) — keluar.`);
  void leaveOtherGuilds(client).catch((error: unknown) =>
    logger.warn(`Gagal keluar dari server ${guild.id}: ${errorMessage(error)}`),
  );
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
    if (quietTimer) clearInterval(quietTimer);
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

// Timer dipasang setelah login (butuh client yang sudah siap).
client.once(Events.ClientReady, () => {
  startQuietWatcher(client);
  startFlowWatcher(client);
});
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
