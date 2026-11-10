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

process.env.DISCORD_TOKEN ??= 'dashboard-standalone-token-000000';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.AI_API_KEY ??= 'dashboard-standalone-key';
process.env.DASHBOARD_TOKEN ??= 'preview-token-1234';
process.env.DATABASE_PATH ??= './data/zypher.db';

const { config } = await import('../config.js');
const { logger } = await import('../lib/logger.js');
const { closeDatabase } = await import('../db/index.js');
const { startDashboard, stopDashboard } = await import('./server.js');

const server = startDashboard();

if (!server) {
  logger.error('Dashboard tidak bisa dijalankan — isi DASHBOARD_TOKEN di .env (minimal 12 karakter).');
  process.exit(1);
} else {
  logger.info(`Mode dashboard saja. Login dengan token: ${config.dashboard.token}`);
  logger.info('Bot Discord TIDAK dijalankan di mode ini (pakai npm run dev untuk bot + dashboard).');
}

const shutdown = () => {
  stopDashboard();
  closeDatabase();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
