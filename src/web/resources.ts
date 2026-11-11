/**
 * Pemantau pemakaian sumber daya server — CPU, memori, jaringan, dan disk.
 *
 * Kenapa modul sendiri, bukan langsung di `server.ts`: di hosting (Pterodactyl
 * dan sejenisnya) proses bot hidup di dalam container yang **dibatasi**. Angka
 * mentah dari `os.totalmem()` di sana adalah memori MESIN INDUK, bukan jatah
 * container — jadi dashboard bisa menulis "96 MB dari 64 GB" padahal batasnya
 * 612 MB. Karena itu pembacaan cgroup didahulukan, `os.*` hanya cadangan.
 *
 * Yang dibaca:
 *   - **CPU**   : persen dari total jatah (container: kuota cgroup; else: inti).
 *   - **Memori**: RSS proses + batas container (cgroup) atau memori mesin.
 *   - **Jaringan**: byte masuk/keluar proses ini (bukan seluruh mesin) —
 *     diambil dari `/proc/<pid>/net/dev` atau `net` Node sebagai cadangan.
 *   - **Disk**  : pemakaian partisi tempat folder kerja berada.
 *
 * Semua fungsi di sini **tidak pernah melempar**. Di hosting, file cgroup bisa
 * tidak ada atau tidak bisa dibaca; dashboard harus tetap tampil walau angka
 * sumber daya kosong. Nilai yang tidak bisa dibaca dikembalikan `null` supaya
 * UI bisa menulis "tidak tersedia" alih-alih berbohong "0".
 */
import { readdir, readFile, realpath, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

export interface ResourceUsage {
  /** Persen pemakaian CPU 0–100 (bisa >100 di mesin multi-inti tanpa cgroup). */
  cpuPercent: number | null;
  /**
   * Byte memori yang dipakai proses ini.
   *
   * Ini **RSS murni** (cgroup `memory.stat` → `anon`), bukan `memory.current`.
   * Bedanya besar: `memory.current` ikut menghitung page cache (`file`), jadi
   * dashboard pernah menulis 86 MB saat panel hosting menulis 69 MB untuk
   * proses yang sama. Yang dibandingkan admin adalah angka panel, jadi yang
   * dipakai juga harus definisi yang sama.
   */
  memoryUsed: number;
  /** Batas memori: cgroup container, atau total RAM mesin. */
  memoryTotal: number | null;
  /** true = batas dari cgroup (container), false = RAM mesin. */
  memoryFromCgroup: boolean;
  /** Byte masuk/keluar kumulatif sejak proses hidup. */
  networkIn: number | null;
  networkOut: number | null;
  /**
   * Kecepatan jaringan byte/detik, dihitung dari selisih dua sampel.
   *
   * `null` = belum ada sampel pembanding (kunjungan pertama), jadi UI menulis
   * "—" alih-alih berbohong "0 B/s".
   */
  networkInRate: number | null;
  networkOutRate: number | null;
  /**
   * Pemakaian disk folder server (byte). BUKAN pemakaian seluruh partisi.
   *
   * Dulu nilai ini diambil dari `statfs()` partisi folder kerja, dan di hosting
   * hasilnya 353 GB / 441 GB — angka mesin induk, bukan jatah container yang
   * cuma 1 GB. Sekarang yang dijumlahkan isi folder server sendiri.
   */
  diskUsed: number | null;
  /**
   * Kuota disk container (byte). `null` = tidak diketahui.
   *
   * cgroup TIDAK menyediakan kuota disk (`io.max` hanya membatasi kecepatan
   * baca/tulis, bukan kapasitas), dan panel hosting tidak mengekspornya ke
   * dalam container. Jadi nilainya datang dari `DISK_LIMIT_MB` di `.env` atau
   * isian admin di halaman Pengaturan — bukan ditebak dari mesin induk.
   */
  diskTotal: number | null;
  /** Dari mana kuota disk berasal. `null` = kuota tidak diatur. */
  diskTotalSource: 'env' | 'setting' | null;
  /** Kecepatan disk baca/tulis byte/detik (cgroup `io.stat`), `null` = belum ada sampel. */
  diskReadRate: number | null;
  diskWriteRate: number | null;
  /** Berapa lama proses sudah hidup. */
  uptimeSeconds: number;
  /** true kalau proses berjalan di dalam container (cgroup terdeteksi). */
  inContainer: boolean;
  /** Kapan sampel ini diambil (epoch ms) — dipakai UI untuk "diperbarui X lalu". */
  sampledAt: number;
}

/** Baca file teks, kembalikan null kalau tidak ada / tidak bisa dibaca. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Folder cgroup milik proses ini, atau `null` kalau tidak bisa ditentukan.
 *
 * PENTING: `/sys/fs/cgroup/...` di level atas adalah cgroup **root**, bukan
 * cgroup container. Di mesin bersama (dan di banyak panel hosting), root berisi
 * gabungan SELURUH proses mesin — `anon` di sana bisa 96 MB padahal proses bot
 * cuma 20 MB. Membaca root membuat dashboard menampilkan angka proses lain.
 *
 * Jalur yang benar ada di `/proc/self/cgroup` (baris `0::/nama/path`), lalu
 * disambung ke mount cgroup v2. Kalau proses benar-benar berada di root
 * (sandbox biasa tanpa pembatasan), hasilnya `/sys/fs/cgroup` dan itu memang
 * satu-satunya angka yang tersedia.
 */
async function processCgroupPath(): Promise<string | null> {
  const raw = await readText('/proc/self/cgroup');
  if (!raw) return null;
  for (const line of raw.split('\n')) {
    // cgroup v2: "0::/system.slice/bot.service". v1 tidak punya baris ini.
    const match = /^0::(\/.*)$/.exec(line.trim());
    if (!match) continue;
    const relative = match[1]!;
    // Sudah di root → folder root memang milik proses ini.
    const clean = relative === '/' ? '' : relative.replace(/\/+$/, '');
    return `/sys/fs/cgroup${clean}`;
  }
  return null;
}

/** Angka pertama di file cgroup, atau null kalau isinya "max"/kosong/aneh. */
function firstNumber(raw: string | null): number | null {
  if (!raw) return null;
  const token = raw.trim().split(/\s+/)[0];
  if (!token || token === 'max') return null;
  const value = Number(token);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Batas memori dari cgroup v2 lalu v1.
 *
 * `memory.max` = "max" artinya tanpa batas — jangan dianggap 0 (kalau dianggap
 * 0, dasbor menulis "0%" dan itu salah total).
 */
async function cgroupMemoryLimit(): Promise<number | null> {
  const dir = (await processCgroupPath()) ?? '/sys/fs/cgroup';
  const v2 = firstNumber(await readText(`${dir}/memory.max`));
  if (v2) return v2;
  const v1 = firstNumber(await readText('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  // cgroup v1 menulis angka raksasa (mis. 9.2e18) sebagai "tanpa batas".
  if (v1 && v1 < Number.MAX_SAFE_INTEGER / 2) return v1;
  return null;
}

/**
 * Pemakaian memori proses (RSS murni), byte.
 *
 * cgroup v2 menaruh angka ini di `memory.stat` baris `anon`. `memory.current`
 * SENGAJA tidak dipakai lagi: nilainya = anon + file (page cache) + kernel,
 * sehingga selalu lebih besar dari angka panel hosting. Di sandbox selisihnya
 * 86 MB vs 18 MB — bukan salah baca, memang definisi berbeda.
 *
 * cgroup v1 tidak punya `anon`; RSS proses tetap bisa dibaca dari `stat` milik
 * proses itu sendiri, dan itulah cadangan terakhirnya.
 */
async function cgroupMemoryUsed(): Promise<number | null> {
  const dir = (await processCgroupPath()) ?? '/sys/fs/cgroup';
  const stat = await readText(`${dir}/memory.stat`);
  if (stat) {
    for (const line of stat.split('\n')) {
      const [key, raw] = line.trim().split(/\s+/);
      if (key === 'anon' && raw) {
        const value = Number(raw);
        if (Number.isFinite(value) && value >= 0) return value;
      }
    }
  }
  // cgroup v1: usage_in_bytes ikut menghitung cache, tapi lebih baik daripada
  // tidak ada angka sama sekali. RSS proses selalu tersedia sebagai cadangan.
  return firstNumber(await readText('/sys/fs/cgroup/memory/memory.usage_in_bytes'));
}

/**
 * Waktu mulai proses dari `/proc/<pid>/stat` (kolom ke-22, satuan jiffy).
 *
 * Dipakai sebagai penanda identitas untuk counter CPU: `cpu.stat` milik cgroup
 * **akumulatif dan dipakai bersama** proses lain. Saat bot restart,
 * `usage_usec` tidak kembali ke nol, sehingga delta pertama bisa jadi negatif
 * atau melonjak. Kalau nilai ini berubah, sampel lama dibuang.
 */
async function processStartTime(): Promise<string | null> {
  const raw = await readText(`/proc/${process.pid}/stat`);
  if (!raw) return null;
  // Nama proses bisa memuat spasi/tanda kurung, jadi pecah pada ')' terakhir.
  const tail = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
  // Setelah ')' kolom ke-3 adalah state, jadi starttime (kolom 22) = indeks 19.
  return tail[19] ?? null;
}

/** RSS proses dari `/proc/<pid>/statm` (halaman × ukuran halaman). */
async function procRss(): Promise<number | null> {
  try {
    const raw = await readText(`/proc/${process.pid}/statm`);
    const resident = raw ? Number(raw.trim().split(/\s+/)[1]) : NaN;
    if (!Number.isFinite(resident) || resident <= 0) return null;
    // Halaman memori hampir selalu 4 KiB; baca dari os kalau bisa.
    const pageSize = 4096;
    return resident * pageSize;
  } catch {
    return null;
  }
}

/**
 * Jumlah inti efektif: kuota CPU cgroup kalau ada, kalau tidak jumlah inti.
 * Dipakai supaya "100%" di container 1 inti tidak berarti hal yang sama
 * dengan "100%" di mesin 8 inti.
 */
async function cpuCores(): Promise<{ cores: number; fromCgroup: boolean }> {
  const dir = (await processCgroupPath()) ?? '/sys/fs/cgroup';
  // cgroup v2: "200000 100000" = 2 inti penuh.
  const v2 = await readText(`${dir}/cpu.max`);
  if (v2) {
    const [quotaRaw, periodRaw] = v2.trim().split(/\s+/);
    const quota = Number(quotaRaw);
    const period = Number(periodRaw);
    if (quotaRaw !== 'max' && quota > 0 && period > 0) {
      return { cores: quota / period, fromCgroup: true };
    }
  }
  // cgroup v1: quota/period dalam microsecond.
  const v1Quota = firstNumber(await readText('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const v1Period = firstNumber(await readText('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  if (v1Quota && v1Period) {
    return { cores: v1Quota / v1Period, fromCgroup: true };
  }
  return { cores: os.cpus().length || 1, fromCgroup: false };
}

/**
 * Delta waktu CPU proses (user+system) dalam mikrodetik, dari cgroup atau
 * `process.cpuUsage()`. Nilai sebelumnya dibandingkan oleh pemanggil.
 */
function processCpuMicros(): number {
  const usage = process.cpuUsage();
  return usage.user + usage.system;
}

/** Byte jaringan proses ini. */
async function networkBytes(): Promise<{ rx: number; tx: number } | null> {
  const raw = await readText(`/proc/${process.pid}/net/dev`);
  if (!raw) return null;
  let rx = 0;
  let tx = 0;
  for (const line of raw.split('\n')) {
    // Baris data: "  eth0: 1234567 890 ... 0 0 0 0 0 0"
    const match = /^\s*([^:]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/.exec(line);
    if (!match) continue;
    if (match[1].trim() === 'lo') continue; // loopback bukan lalu lintas nyata
    rx += Number(match[2]);
    tx += Number(match[3]);
  }
  return { rx, tx };
}

/**
 * Jumlah byte yang dipakai folder server (rekursif).
 *
 * Ini pengganti `statfs()`. Di hosting, `statfs()` membaca **partisi mesin
 * induk** — dashboard sempat menulis "353 GB dari 441 GB" padahal jatah
 * container cuma 1 GB. Yang ingin diketahui admin adalah "berapa besar bot
 * saya", dan itu = isi folder server (termasuk `node_modules` dan database).
 *
 * Dibatasi `maxEntries` supaya disk jaringan yang lambat tidak menahan
 * dashboard. Kalau batasnya tercapai, hasilnya ditandai tidak lengkap
 * (`complete: false`) — UI bisa menulis perkiraan, bukan angka palsu.
 */
async function folderBytes(
  root: string,
  maxEntries = 60_000,
): Promise<{ bytes: number; complete: boolean } | null> {
  const seenDirs = new Set<string>();
  let bytes = 0;
  let files = 0;
  let complete = true;

  const walk = async (dir: string): Promise<void> => {
    if (!complete) return;

    // Symlink bisa membentuk lingkaran, dan `realpath` mencegah folder yang
    // sama dihitung dua kali.
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (seenDirs.has(real)) return;
    seenDirs.add(real);

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files >= maxEntries) {
        complete = false;
        return;
      }
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files += 1;
        try {
          bytes += (await stat(full)).size;
        } catch {
          // Berkas hilang di tengah jalan — lewati, jangan gagalkan semuanya.
        }
      }
    }
  };

  try {
    await walk(root);
  } catch {
    return null;
  }
  return { bytes, complete };
}

/**
 * Kapasitas partisi tempat folder server berada.
 *
 * SENGAJA tidak dipakai sebagai kuota. Nilainya milik mesin induk dan bisa
 * ratusan GB sementara container cuma 1 GB. Disimpan untuk keterangan
 * "mesin", tidak untuk bar persentase.
 */
async function partitionCapacity(path: string): Promise<number | null> {
  try {
    const info = await statfs(path);
    const total = info.blocks * info.bsize;
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

/** Deteksi container: cgroup ada DAN membatasi (bukan cgroup root mesin). */
async function detectContainer(): Promise<boolean> {
  const entries = await readdir('/sys/fs/cgroup').catch(() => [] as string[]);
  return entries.includes('memory.max') || entries.includes('memory.limit_in_bytes') || entries.includes('cgroup.controllers');
}

/**
 * Pilih angka memori yang ditampilkan.
 *
 * RSS proses menang atas `anon` cgroup. Ini keputusan yang pernah salah:
 * `anon` cgroup di hosting MENJUMLAHKAN semua proses yang berbagi container,
 * sehingga angkanya bisa jauh di atas pemakaian bot sendiri (di sandbox
 * terpantau berubah 430 KB → 75 MB karena proses lain ikut dihitung).
 *
 * Dipisah sebagai fungsi murni supaya prioritasnya bisa diuji dengan angka
 * yang sengaja sangat berbeda — di mesin nyata kedua nilai sering terlalu
 * dekat untuk membedakan benar/salah.
 */
export function pickMemoryUsed(input: {
  ownRss: number | null;
  cgroupAnon: number | null;
  /** Cadangan terakhir: `process.memoryUsage().rss`. */
  fallback: number;
}): number {
  if (input.ownRss !== null && input.ownRss > 0) return input.ownRss;
  if (input.cgroupAnon !== null && input.cgroupAnon > 0) return input.cgroupAnon;
  return input.fallback;
}

/** Sampel mentah untuk menghitung kecepatan (selisih antar-waktu). */
interface Sample {
  at: number;
  /** Penanda identitas proses (starttime). Berubah = bot restart. */
  started: string | null;
  cpuMicros: number;
  netIn: number | null;
  netOut: number | null;
  readBytes: number | null;
  writeBytes: number | null;
}

/**
 * Sampel terakhir per proses, dipakai untuk menghitung kecepatan.
 *
 * Kenapa disimpan di modul, bukan dihitung dari dua kali `setTimeout` seperti
 * dulu: dashboard sekarang **polling**, jadi selisih antar-poll sudah tersedia
 * gratis dan lebih akurat. Bonus: halaman Ringkasan tidak lagi menunggu 120 ms
 * sebelum tampil.
 */
let lastSample: Sample | null = null;

/** Total CPU mikrodetik dari cgroup (`usage_usec`), `null` kalau tak terbaca. */
async function cgroupCpuMicros(): Promise<number | null> {
  const dir = (await processCgroupPath()) ?? '/sys/fs/cgroup';
  const raw = await readText(`${dir}/cpu.stat`);
  if (!raw) return null;
  for (const line of raw.split('\n')) {
    const [key, value] = line.trim().split(/\s+/);
    if (key === 'usage_usec' && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Byte disk I/O kumulatif dari cgroup `io.stat`.
 *
 * Ini **bukan** kuota (itu `io.max`, dan biasanya tidak diisi hosting) — hanya
 * jumlah byte yang dibaca/ditulis. Dipakai untuk kecepatan disk, yang dulu
 * tidak ada sama sekali.
 */
async function cgroupDiskIo(): Promise<{ read: number; write: number } | null> {
  const dir = (await processCgroupPath()) ?? '/sys/fs/cgroup';
  const raw = await readText(`${dir}/io.stat`);
  if (!raw) return null;
  let read = 0;
  let write = 0;
  let found = false;
  for (const line of raw.split('\n')) {
    // Baris: "254:0 rbytes=123 wbytes=456 rios=1 wios=2 dbytes=... dios=..."
    for (const part of line.trim().split(/\s+/)) {
      const [key, value] = part.split('=');
      if (!value) continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) continue;
      if (key === 'rbytes') {
        read += parsed;
        found = true;
      } else if (key === 'wbytes') {
        write += parsed;
        found = true;
      }
    }
  }
  return found ? { read, write } : null;
}

/** Ubah selisih byte & waktu jadi byte/detik; `null` kalau tidak bisa dihitung. */
function rate(current: number | null, previous: number | null, elapsedMs: number): number | null {
  if (current === null || previous === null || elapsedMs <= 0) return null;
  const delta = current - previous;
  // Nilai turun = counter di-reset (container pindah host). Jangan tampilkan negatif.
  if (delta < 0) return null;
  // Delta 0 sah dan berarti "tidak ada lalu lintas" — kembalikan 0, bukan null,
  // supaya UI bisa menulis "0 B/s" (seperti panel hosting) alih-alih "—".
  return Math.round((delta / elapsedMs) * 1000);
}

/**
 * Ambil satu sampel pemakaian sumber daya.
 *
 * Tidak ada `setTimeout` lagi: CPU dihitung dari delta `cpu.stat usage_usec`
 * terhadap sampel sebelumnya yang tersimpan di modul. Panggilan pertama
 * sesudah proses hidup belum punya pembanding, jadi `cpuPercent` = `null`
 * (UI menulis "—") — lebih baik daripada angka karangan.
 */
export async function readResourceUsage(options: {
  workDir: string;
  /** Kuota disk dari `.env` (byte). `null` = tidak diatur di env. */
  diskLimitEnv?: number | null;
  /** Kuota disk yang diisi admin (byte). `null` = tidak diatur. */
  diskLimitSetting?: number | null;
}): Promise<ResourceUsage> {
  const now = Date.now();
  const previous = lastSample;

  const [memLimit, memUsedCgroup, coreInfo, net, cpuMicros, diskIo, folder, inContainer, started, ownRss] =
    await Promise.all([
      cgroupMemoryLimit(),
      cgroupMemoryUsed(),
      cpuCores(),
      networkBytes(),
      cgroupCpuMicros(),
      cgroupDiskIo(),
      folderBytes(options.workDir),
      detectContainer(),
      processStartTime(),
      procRss(),
    ]);

  // Sampel lama dibuang kalau bot restart: cpu.stat milik cgroup TIDAK kembali
  // ke nol saat proses lahir, jadi delta terhadap sampel proses sebelumnya
  // akan melonjak (atau negatif). Bandingkan penanda identitas proses.
  const sameProcess = previous !== null && previous.started === started;
  const base = sameProcess ? previous : null;

  const cpuNow = cpuMicros ?? processCpuMicros();
  const elapsedMs = base ? now - base.at : 0;

  // CPU: delta CPU mikrodetik dibagi waktu dinding, lalu dibagi inti efektif.
  let cpuPercent: number | null = null;
  if (base && elapsedMs > 0) {
    const deltaUs = cpuNow - base.cpuMicros;
    if (deltaUs >= 0) {
      const percentPerCore = (deltaUs / 1000 / elapsedMs) * 100;
      const normalized = percentPerCore / (coreInfo.cores || 1);
      cpuPercent = Math.max(0, Math.min(100, Math.round(normalized * 10) / 10));
    }
  }

  // Memori proses ini.
  //
  // Urutan sengaja: RSS proses (`/proc/<pid>/statm`) DULUAN, bukan `anon` cgroup.
  // Alasannya konkret: cgroup container di hosting dipakai bersama beberapa
  // proses, jadi `anon`-nya menjumlahkan semuanya — di sandbox nilainya
  // berubah 430 KB → 75 MB dalam hitungan detik karena proses lain ikut
  // dihitung. Angka yang benar untuk "pemakaian bot ini" adalah RSS proses
  // itu sendiri, dan itu juga yang paling dekat dengan angka panel hosting.
  // `anon` cgroup hanya cadangan kalau /proc tidak terbaca (mis. Windows).
  const memoryUsed = pickMemoryUsed({
    ownRss,
    cgroupAnon: memUsedCgroup,
    fallback: process.memoryUsage().rss,
  });
  const memoryTotal = memLimit ?? os.totalmem();

  // Kuota disk: env menang atas isian admin. Tidak pernah ditebak dari mesin.
  const diskLimitEnv = options.diskLimitEnv ?? null;
  const diskLimitSetting = options.diskLimitSetting ?? null;
  const diskTotal = diskLimitEnv ?? diskLimitSetting ?? null;
  const diskTotalSource = diskLimitEnv ? 'env' : diskLimitSetting ? 'setting' : null;

  const sample: Sample = {
    at: now,
    started,
    cpuMicros: cpuNow,
    netIn: net?.rx ?? null,
    netOut: net?.tx ?? null,
    readBytes: diskIo?.read ?? null,
    writeBytes: diskIo?.write ?? null,
  };
  lastSample = sample;

  return {
    cpuPercent,
    memoryUsed,
    memoryTotal,
    memoryFromCgroup: Boolean(memLimit),
    networkIn: net?.rx ?? null,
    networkOut: net?.tx ?? null,
    networkInRate: base ? rate(sample.netIn, base.netIn, elapsedMs) : null,
    networkOutRate: base ? rate(sample.netOut, base.netOut, elapsedMs) : null,
    diskUsed: folder ? folder.bytes : null,
    diskTotal,
    diskTotalSource,
    diskReadRate: base ? rate(sample.readBytes, base.readBytes, elapsedMs) : null,
    diskWriteRate: base ? rate(sample.writeBytes, base.writeBytes, elapsedMs) : null,
    uptimeSeconds: Math.round(process.uptime()),
    inContainer,
    sampledAt: now,
  };
}

/**
 * Kapasitas partisi mesin — untuk keterangan saja, BUKAN kuota container.
 *
 * Dipakai UI saat kuota belum diatur, supaya admin tetap tahu konteks mesin
 * tanpa angka itu dipakai sebagai penyebut bar persentase (yang dulu bikin
 * "353 GB / 441 GB" padahal jatah container 1 GB).
 */
export async function readPartitionCapacity(workDir: string): Promise<number | null> {
  return partitionCapacity(workDir);
}
