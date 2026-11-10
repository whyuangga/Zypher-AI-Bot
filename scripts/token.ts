/**
 * Bikin token acak yang layak dipakai sebagai password (DASHBOARD_TOKEN).
 *
 *   npm run token                      # cetak token hex 48 karakter
 *   npm run token -- --length=32       # lebih pendek
 *   npm run token -- --base64          # base64url (lebih rapat)
 *   npm run token -- --write           # tulis langsung ke .env
 *   npm run token -- --write --file=/path/.env
 *
 * Kenapa bukan generator online? Banyak "token generator" memakai Math.random()
 * yang BUKAN cryptographic random (bisa diprediksi setelah cukup banyak sampel).
 * Skrip ini memakai `crypto.randomBytes` dengan rejection sampling, jadi tidak
 * ada bias modulo dan tidak ada pola yang bisa dipelajari.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ */
/*  Argumen                                                            */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const HEX = '0123456789abcdef';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Ambil `length` karakter dari `alphabet` tanpa bias modulo.
 * Byte di atas batas terakhir yang "pas" dibuang (rejection sampling).
 */
function randomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length);
  let result = '';
  while (result.length < length) {
    // Ambil sedikit lebih banyak dari yang dibutuhkan, buang yang di atas limit.
    const buffer = randomBytes(length * 2);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      result += alphabet[byte % alphabet.length];
      if (result.length === length) break;
    }
  }
  return result;
}

const rawLength = Number(flag('length') ?? 48);
if (!Number.isInteger(rawLength) || rawLength < 16 || rawLength > 128) {
  console.error('❌ --length harus bilangan bulat 16–128.');
  process.exit(1);
}

const alphabet = has('base64') ? BASE64URL : HEX;
const token = randomString(alphabet, rawLength);

/* ------------------------------------------------------------------ */
/*  Mode tulis ke .env                                                 */
/* ------------------------------------------------------------------ */

function mask(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} karakter)`;
}

if (!has('write')) {
  console.log(`\n${token}\n`);
  console.log(`Panjang: ${token.length} karakter · alfabet: ${has('base64') ? 'base64url' : 'hex'}`);
  console.log('Pakai sebagai DASHBOARD_TOKEN di .env atau di environment variables panel hosting.');
  console.log('Tulis otomatis ke .env:  npm run token -- --write\n');
  process.exit(0);
}

const envPath = resolve(flag('file') ?? '.env');

if (!existsSync(envPath)) {
  console.error(`❌ ${envPath} tidak ada. Buat dari contoh: cp .env.example .env`);
  process.exit(1);
}

const original = readFileSync(envPath, 'utf8');
const line = `DASHBOARD_TOKEN=${token}`;
const pattern = /^[ \t]*#?[ \t]*DASHBOARD_TOKEN=.*$/m;

let updated: string;
if (pattern.test(original)) {
  updated = original.replace(pattern, line);
} else {
  updated = `${original.trimEnd()}\n\n# Ditambahkan oleh \`npm run token\`\n${line}\n`;
}

writeFileSync(envPath, updated, 'utf8');

console.log('\n✅ DASHBOARD_TOKEN diperbarui.');
console.log(`   File  : ${envPath}`);
console.log(`   Token : ${mask(token)}`);
console.log('\nLangkah berikutnya:');
console.log('   1. Salin token utuh dari file .env (bukan dari layar ini).');
console.log('   2. Perbarui juga DASHBOARD_TOKEN di panel hosting.');
console.log('   3. Restart bot / dashboard agar sesi lama tidak berlaku.\n');
