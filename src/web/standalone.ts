/**
 * Jalankan dashboard saja (tanpa bot Discord).
 *
 * Berguna untuk: pratinjau tampilan, cek data SQLite, upload dokumen RAG
 * saat bot sedang offline, atau sekadar memastikan dashboard bisa diakses
 * dari hosting sebelum bot di-deploy.
 *
 *   npm run dashboard
 *
 * Variabel yang belum diisi mendapat nilai contoh supaya config lolos validasi.
 */
await import('../lib/runtime-check.js');

// Muat .env LEBIH DULU, supaya nilai asli tidak tertimpa nilai contoh di bawah.
// (`dotenv` tidak menimpa variabel yang sudah ada, jadi urutan ini penting.)
await import('dotenv/config');

/** Isi nilai contoh hanya kalau variabelnya kosong/tidak ada (bukan menimpa isi .env). */
function fillIfEmpty(key: string, fallback: string): void {
  const current = process.env[key];
  if (!current || current.trim() === '') process.env[key] = fallback;
}

fillIfEmpty('DISCORD_TOKEN', 'dashboard-standalone-token-000000');
fillIfEmpty('CLIENT_ID', '123456789012345678');
fillIfEmpty('GUILD_ID', '123456789012345678');
fillIfEmpty('AI_API_KEY', 'dashboard-standalone-key');
fillIfEmpty('DASHBOARD_TOKEN', 'preview-token-1234');
fillIfEmpty('DATABASE_PATH', './data/zypher.db');

const { config } = await import('../config.js');
const { logger } = await import('../lib/logger.js');
const { closeDatabase } = await import('../db/index.js');
const { startDashboard, stopDashboard } = await import('./server.js');

const server = startDashboard();

if (!server) {
  logger.error('Dashboard tidak bisa dijalankan — isi DASHBOARD_TOKEN di .env (minimal 12 karakter).');
  process.exit(1);
} else {
  // Jangan pernah mencetak token asli ke log (log panel hosting bisa dibaca orang lain).
  const token = config.dashboard.token ?? '';
  logger.info(
    token === 'preview-token-1234'
      ? 'Mode dashboard saja. Token contoh: preview-token-1234 (jangan dipakai di server publik)'
      : `Mode dashboard saja. Login memakai DASHBOARD_TOKEN dari ${process.env.DOTENV_CONFIG_PATH ?? '.env'} / panel hosting.`,
  );
  logger.info('Bot Discord TIDAK dijalankan di mode ini (pakai npm run dev untuk bot + dashboard).');
}

const shutdown = () => {
  stopDashboard();
  void closeDatabase().finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
