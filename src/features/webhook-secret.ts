/**
 * Enkripsi token webhook Discord sebelum disimpan.
 *
 * **Kenapa perlu.** Token webhook itu setara kata sandi channel: siapa pun yang
 * memegangnya bisa mengirim pesan ke channel tersebut — tanpa login, tanpa
 * lewat bot. Menyimpannya sebagai teks biasa berarti siapa pun yang bisa
 * membaca file database (backup, salinan dari panel hosting, atau admin lain)
 * ikut memegang kunci itu.
 *
 * **Yang dilakukan modul ini.** AES-256-GCM, kunci diturunkan dari
 * `DASHBOARD_TOKEN` lewat scrypt. Hasilnya disimpan sebagai teks dengan
 * awalan `enc:v1:` sehingga:
 *
 *   - database lama yang masih berisi token teks biasa tetap terbaca
 *     (`isEncrypted()` mengembalikan false, nilai dipakai apa adanya),
 *   - token tidak pernah ikut tampil di dashboard, bahkan tersamar.
 *
 * **Batas jujurnya.** Ini melindungi dari pembacaan file/cadangan database,
 * BUKAN dari orang yang menguasai seluruh proses bot (dia bisa memanggil
 * `decryptSecret()`). Untuk ancaman seperti itu, tidak ada enkripsi lokal yang
 * menolong — kuncinya harus disimpan di luar server.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

const PREFIX = 'enc:v1:';
const SALT = 'zypher-webhook-v1';

/**
 * Turunkan kunci 32 byte dari `DASHBOARD_TOKEN`.
 *
 * Kalau `DASHBOARD_TOKEN` kosong (mode pengembangan tanpa login), enkripsi
 * tetap jalan memakai string tetap — lebih baik daripada menyimpan teks biasa,
 * tapi keamanannya jelas lebih rendah. Pemanggil bisa memeriksa
 * `encryptionStrength()` untuk memberi peringatan di log.
 */
function key(): Buffer {
  const secret = config.dashboard.token?.trim() || 'zypher-tanpa-dashboard-token';
  return scryptSync(secret, SALT, 32);
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Enkripsi. Mengembalikan teks biasa kalau enkripsi tidak mungkin (mis. kunci
 * tidak tersedia) — pemanggil tetap bisa menyimpan, dan `decryptSecret()` tahu
 * bedanya dari awalan.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (isEncrypted(plain)) return plain;

  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  } catch {
    // Jangan sampai fitur webhook mati total karena enkripsi gagal.
    return plain;
  }
}

/**
 * Dekripsi. Nilai yang bukan hasil enkripsi (token lama) dikembalikan apa
 * adanya, jadi database lama tidak perlu dimigrasi.
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  if (!isEncrypted(stored)) return stored;

  const body = stored.slice(PREFIX.length);
  const [ivText, tagText, dataText] = body.split('.');
  if (!ivText || !tagText || !dataText) return '';

  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Kunci berubah (DASHBOARD_TOKEN diganti) atau data rusak. Token lama tidak
    // bisa dipakai lagi — pemanggil akan membuat webhook baru.
    return '';
  }
}

/** Level perlindungan, untuk peringatan di log saat start. */
export function encryptionStrength(): 'kuat' | 'lemah' {
  return config.dashboard.token?.trim() ? 'kuat' : 'lemah';
}

/**
 * Sembunyikan token untuk log/pesan error.
 *
 * Token webhook berbentuk `https://discord.com/api/webhooks/<id>/<token>`.
 * Yang ditampilkan hanya ID-nya; token tidak pernah ikut walau terpotong.
 */
export function maskWebhookUrl(url: string): string {
  const match = /\/webhooks\/(\d+)\/([^/?]+)/.exec(url);
  if (!match) return '(tidak dikenali)';
  return `https://discord.com/api/webhooks/${match[1]}/••••`;
}
