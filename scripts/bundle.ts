/**
 * Bikin ZIP siap-upload untuk panel hosting (Wispbyte, Bot-Hosting, Pterodactyl, dsb).
 *
 *   npm run bundle
 *
 * Hasil: `zypher-deploy.zip` di root project, berisi:
 *   dist/**            (JavaScript hasil build — server tidak perlu compile TS)
 *   package.json       (daftar dependensi)
 *   package-lock.json  (versi yang persis sama dengan yang sudah diuji)
 *
 * `node_modules` sengaja TIDAK disertakan: panel hosting biasanya menjalankan
 * `npm install` saat start (dan Wispbyte memberi 1 core penuh di ~90 detik pertama
 * khusus untuk ini). Kalau panel-mu tidak bisa install, lihat catatan di akhir.
 */
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/* ------------------------------------------------------------------ */
/*  CRC32 (dibutuhkan format ZIP)                                      */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/*  Penulis ZIP minimal (deflate, tanpa dependensi)                    */
/* ------------------------------------------------------------------ */

interface ZipEntry {
  name: string;
  data: Buffer;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

function createZip(files: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime(new Date());
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data, { level: 9 });
    const crc = crc32(file.data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // versi minimum
    header.writeUInt16LE(0x0800, 6); // nama file UTF-8
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);

    const local = Buffer.concat([header, nameBuffer, compressed]);
    locals.push(local);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // versi pembuat
    central.writeUInt16LE(20, 6); // versi minimum
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // komentar
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // atribut internal
    central.writeUInt32LE(0, 38); // atribut eksternal
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuffer]));

    offset += local.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

/* ------------------------------------------------------------------ */
/*  Kumpulkan file                                                     */
/* ------------------------------------------------------------------ */

const root = resolve(import.meta.dirname, '..');
const distDir = join(root, 'dist');
const outputPath = join(root, 'zypher-deploy.zip');

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function main(): void {
  console.log('📦 Menyiapkan paket deploy…');

  if (!statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error('❌ Folder dist/ belum ada. Jalankan `npm run build` dulu.');
    process.exit(1);
  }

  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) {
    console.error('❌ Build gagal.');
    process.exit(1);
  }

  const files: ZipEntry[] = [];

  for (const full of walk(distDir)) {
    if (!full.endsWith('.js')) continue; // source map tidak perlu di server
    files.push({ name: relative(root, full).split('\\').join('/'), data: readFileSync(full) });
  }

  for (const name of ['package.json', 'package-lock.json']) {
    const full = join(root, name);
    if (statSync(full, { throwIfNoEntry: false })) {
      files.push({ name, data: readFileSync(full) });
    }
  }

  const zip = createZip(files);
  writeFileSync(outputPath, zip);

  const megabytes = (zip.length / 1024 / 1024).toFixed(2);
  console.log(`\n✅ ${relative(process.cwd(), outputPath)} — ${files.length} file, ${megabytes} MB`);
  console.log('\nLangkah di panel hosting:');
  console.log('  1. Files → Upload → pilih zypher-deploy.zip → Extract / Unzip');
  console.log('  2. Pastikan folder `dist/` ada di root server (bukan di dalam subfolder).');
  console.log('  3. Startup → Startup command:  npm install --omit=dev && node dist/index.js');
  console.log('  4. Startup → Environment variables: isi DISCORD_TOKEN, CLIENT_ID, AI_API_KEY (+ opsional lainnya).');
  console.log('  5. Console → Start, lalu tunggu log "🤖 Login sebagai …".\n');
  console.log('Kalau panel tidak bisa menjalankan npm install, ubah startup command menjadi:');
  console.log('  npm install --omit=dev --no-audit --no-fund && node dist/index.js\n');
}

main();
