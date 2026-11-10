/**
 * Hook `npm install` (lifecycle "prepare").
 *
 * Tujuannya: panel hosting berbasis Pterodactyl (Wispbyte, dsb.) hanya menjalankan
 *   npm install   →   node ${JS_FILE}
 * tanpa langkah build. Bot ini TypeScript, jadi tanpa hook ini `dist/index.js`
 * tidak pernah ada dan panel gagal dengan "Cannot find module".
 *
 * Skrip ini sengaja TIDAK memaksa build di semua situasi:
 *   - `npm install --omit=dev` (paket ZIP)  : tsc tidak dipasang → lewati, pakai dist/ bawaan ZIP
 *   - `npm ci` di Dockerfile build stage    : tsconfig/src belum di-COPY → lewati
 *   - `npm install` di repo / panel git     : tsc + tsconfig + src ada → build
 *
 * Semua keputusan dicetak ke log supaya tidak ada kejutan.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const has = (path) => existsSync(path);

function skip(reason) {
  console.log(`[prepare] build dilewati — ${reason}`);
  console.log('[prepare] bot tetap bisa jalan selama folder dist/ sudah ada (hasil build sebelumnya).');
}

const hasCompiler = has('node_modules/typescript/bin/tsc');
const hasSources = has('tsconfig.json') && has('src');
const hasDist = has('dist/index.js');

if (!hasCompiler) {
  skip('TypeScript tidak terpasang (mungkin karena `npm install --omit=dev`).');
  process.exit(0);
}

if (!hasSources) {
  skip('tsconfig.json / folder src belum ada di direktori ini.');
  process.exit(0);
}

console.log('[prepare] TypeScript & sumber tersedia — membangun dist/ …');

const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  stdio: 'inherit',
});

if (result.status === 0) {
  console.log('[prepare] ✅ build selesai — dist/index.js siap dijalankan.');
  process.exit(0);
}

// Build gagal: kalau dist/ lama masih ada, jangan gagalkan npm install (bot bisa jalan
// dengan versi lama). Kalau tidak ada sama sekali, gagalkan supaya errornya terlihat.
if (hasDist) {
  console.error('[prepare] ⚠️  build gagal, tapi dist/ lama masih ada — npm install dilanjutkan.');
  process.exit(0);
}

console.error('[prepare] ❌ build gagal dan belum ada dist/. Perbaiki error TypeScript di atas.');
process.exit(result.status ?? 1);
