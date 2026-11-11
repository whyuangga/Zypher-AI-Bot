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
import { readdir, readFile, statfs } from 'node:fs/promises';
import os from 'node:os';

export interface ResourceUsage {
  /** Persen pemakaian CPU 0–100 (bisa >100 di mesin multi-inti tanpa cgroup). */
  cpuPercent: number | null;
  /** Byte memori yang dipakai proses ini. */
  memoryUsed: number;
  /** Batas memori: cgroup container, atau total RAM mesin. */
  memoryTotal: number | null;
  /** true = batas dari cgroup (container), false = RAM mesin. */
  memoryFromCgroup: boolean;
  /** Byte masuk/keluar kumulatif sejak proses hidup. */
  networkIn: number | null;
  networkOut: number | null;
  /** Byte terpakai & kapasitas partisi folder kerja. */
  diskUsed: number | null;
  diskTotal: number | null;
  /** Berapa lama proses sudah hidup. */
  uptimeSeconds: number;
  /** true kalau proses berjalan di dalam container (cgroup terdeteksi). */
  inContainer: boolean;
}

/** Baca file teks, kembalikan null kalau tidak ada / tidak bisa dibaca. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
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
  const v2 = firstNumber(await readText('/sys/fs/cgroup/memory.max'));
  if (v2) return v2;
  const v1 = firstNumber(await readText('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  // cgroup v1 menulis angka raksasa (mis. 9.2e18) sebagai "tanpa batas".
  if (v1 && v1 < Number.MAX_SAFE_INTEGER / 2) return v1;
  return null;
}

/** Pemakaian memori cgroup saat ini (byte). */
async function cgroupMemoryUsed(): Promise<number | null> {
  const v2 = firstNumber(await readText('/sys/fs/cgroup/memory.current'));
  if (v2) return v2;
  return firstNumber(await readText('/sys/fs/cgroup/memory/memory.usage_in_bytes'));
}

/**
 * Jumlah inti efektif: kuota CPU cgroup kalau ada, kalau tidak jumlah inti.
 * Dipakai supaya "100%" di container 1 inti tidak berarti hal yang sama
 * dengan "100%" di mesin 8 inti.
 */
async function cpuCores(): Promise<{ cores: number; fromCgroup: boolean }> {
  // cgroup v2: "200000 100000" = 2 inti penuh.
  const v2 = await readText('/sys/fs/cgroup/cpu.max');
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

/** Pemakaian disk partisi folder kerja. */
async function diskUsage(path: string): Promise<{ used: number; total: number } | null> {
  try {
    const info = await statfs(path);
    const total = info.blocks * info.bsize;
    const free = info.bavail * info.bsize;
    if (!Number.isFinite(total) || total <= 0) return null;
    return { used: Math.max(0, total - free), total };
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
 * Ambil satu sampel pemakaian sumber daya.
 *
 * CPU butuh dua titik waktu, jadi fungsi ini menunggu `sampleMs` (default
 * 120 ms) sebelum menghitung persentase. Itu cukup untuk angka yang stabil
 * tanpa membuat halaman Ringkasan terasa lambat.
 */
export async function readResourceUsage(options: { workDir: string; sampleMs?: number }): Promise<ResourceUsage> {
  const sampleMs = options.sampleMs ?? 120;

  const [memLimit, memUsedCgroup, coreInfo, net, disk, inContainer] = await Promise.all([
    cgroupMemoryLimit(),
    cgroupMemoryUsed(),
    cpuCores(),
    networkBytes(),
    diskUsage(options.workDir),
    detectContainer(),
  ]);

  // CPU: ukur delta waktu CPU proses terhadap waktu dinding.
  const cpuStart = processCpuMicros();
  const wallStart = performance.now();
  await new Promise((resolve) => setTimeout(resolve, sampleMs));
  const cpuDelta = processCpuMicros() - cpuStart;
  const wallDelta = performance.now() - wallStart;

  let cpuPercent: number | null = null;
  if (wallDelta > 0) {
    // cpuDelta mikrodetik CPU / wallDelta milidetik dinding -> persen per inti.
    const percentPerCore = (cpuDelta / 1000 / wallDelta) * 100;
    const normalized = percentPerCore / (coreInfo.cores || 1);
    cpuPercent = Math.max(0, Math.min(100, Math.round(normalized * 10) / 10));
  }

  const memoryUsed = memUsedCgroup ?? process.memoryUsage().rss;
  const memoryTotal = memLimit ?? os.totalmem();

  return {
    cpuPercent,
    memoryUsed,
    memoryTotal,
    memoryFromCgroup: Boolean(memLimit),
    networkIn: net?.rx ?? null,
    networkOut: net?.tx ?? null,
    diskUsed: disk?.used ?? null,
    diskTotal: disk?.total ?? null,
    uptimeSeconds: Math.round(process.uptime()),
    inContainer,
  };
}
