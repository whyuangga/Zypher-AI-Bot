/**
 * Banner contoh untuk screenshot dokumentasi.
 *
 * Dipisah dari `screenshots-seed.ts` supaya pembuatan gambar tidak mengotori
 * logika seed. Banner dipakai halaman Sambutan sebagai contoh nyata — supaya
 * pembaca dokumentasi melihat fitur unggah banner dalam keadaan terpakai, bukan
 * kotak kosong.
 *
 * Digambar langsung dengan `@napi-rs/canvas`, sama seperti kartu sambutan. Dulu
 * bagian ini memakai Chromium dan diam-diam menghasilkan `null` di mesin tanpa
 * browser, sehingga screenshot dokumentasi tidak pernah memuat banner.
 */
import { createCanvas } from '@napi-rs/canvas';
import { errorMessage, logger } from '../src/lib/logger.js';

const WIDTH = 1200;
const HEIGHT = 400;

/**
 * Render PNG banner contoh.
 *
 * `null` hanya bila penggambaran benar-benar gagal; tanpa browser, fungsi ini
 * tetap menghasilkan gambar.
 */
export async function renderDemoBanner(): Promise<Buffer | null> {
  try {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Gradien tiga titik: ungu tua → ungu → terakota, senada dengan tema bot.
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, '#2b1b4d');
    gradient.addColorStop(0.5, '#6d4f8f');
    gradient.addColorStop(1, '#c98b7a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Lingkaran cahaya tipis sebagai tekstur, bukan meniru foto siapa pun.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    for (let i = 0; i < 9; i += 1) {
      ctx.beginPath();
      ctx.arc(110 + i * 140, 70 + (i % 3) * 120, 55 + i * 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Nama komunitas di kiri bawah.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = '500 42px "General Sans"';
    ctx.fillText('Komunitas Zypher', 56, HEIGHT - 48);

    return canvas.toBuffer('image/png');
  } catch (error) {
    logger.warn('Gagal merender banner contoh', errorMessage(error));
    return null;
  }
}
