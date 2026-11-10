/**
 * Pintu masuk bot.
 *
 * Isi bot ada di `bot.ts` dan sengaja diimpor secara DINAMIS: dengan begitu
 * pemeriksaan versi Node berjalan lebih dulu, sebelum Node mencoba me-resolve
 * `node:sqlite`. Tanpa ini, hosting dengan Node 20 hanya menampilkan
 * "Cannot find module 'node:sqlite'" tanpa petunjuk apa pun.
 */
import './lib/runtime-check.js';

import('./bot.js').catch((error: unknown) => {
  console.error('\n❌ Bot gagal dimuat:', error instanceof Error ? error.message : String(error), '\n');
  process.exit(1);
});
