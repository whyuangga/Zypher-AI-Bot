/**
 * Kumpulan helper + komponen HTML kecil yang dipakai semua halaman.
 * Semua teks dinamis WAJIB lewat `esc()` sebelum masuk template.
 */
import { icon, type IconName } from './icons.js';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const formatNumber = (value: number): string => new Intl.NumberFormat('id-ID').format(value);

export const formatDate = (ms: number): string =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(
    new Date(ms),
  );

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'baru saja';
  if (diff < hour) return `${Math.floor(diff / minute)} menit lalu`;
  if (diff < day) return `${Math.floor(diff / hour)} jam lalu`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} hari lalu`;
  return formatDate(ms);
}

const dayFormatter = new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'Asia/Jakarta' });
const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });

export const dayLabel = (day: string): string => dayFormatter.format(new Date(`${day}T12:00:00+07:00`));
export const dateLabel = (day: string): string => dateFormatter.format(new Date(`${day}T12:00:00+07:00`));

/** Inisial untuk avatar — Discord ID berupa angka, jadi pakai 2 digit terakhir. */
export function initials(id: string): string {
  const clean = String(id).replace(/[^0-9A-Za-z]/g, '');
  if (!clean) return '?';
  if (/^\d+$/.test(clean)) return clean.slice(-2);
  return clean.slice(0, 2).toUpperCase();
}

export type Tone = 'ok' | 'warn' | 'danger' | 'brand' | 'neutral';

export function badge(text: string, tone: Tone = 'neutral', withDot = true): string {
  const dot = withDot ? '<span class="dot"></span>' : '';
  return `<span class="badge ${tone === 'neutral' ? '' : tone}">${dot}${esc(text)}</span>`;
}

export function statCard(options: {
  label: string;
  value: number | string;
  icon: IconName;
  foot?: string;
}): string {
  return `<div class="card stat">
  <div class="stat-top">
    <span class="stat-label">${esc(options.label)}</span>
    <span class="stat-ico">${icon(options.icon, 17)}</span>
  </div>
  <div class="stat-value">${typeof options.value === 'number' ? formatNumber(options.value) : esc(options.value)}</div>
  ${options.foot ? `<div class="stat-foot">${options.foot}</div>` : ''}
</div>`;
}

export function emptyState(options: {
  icon: IconName;
  title: string;
  text: string;
  action?: { label: string; href: string };
}): string {
  return `<div class="empty">
  <div class="empty-ico">${icon(options.icon, 21)}</div>
  <b>${esc(options.title)}</b>
  <p>${esc(options.text)}</p>
  ${options.action ? `<a class="btn btn-ghost btn-sm" href="${esc(options.action.href)}">${esc(options.action.label)}</a>` : ''}
</div>`;
}

export function card(options: {
  title?: string;
  hint?: string;
  right?: string;
  body: string;
  bodyClass?: string;
}): string {
  const head = options.title
    ? `<div class="card-head"><h2>${esc(options.title)}</h2>${
        options.hint ? `<span class="hint">${esc(options.hint)}</span>` : ''
      }${options.right ? `<span class="right">${options.right}</span>` : ''}</div>`
    : '';
  return `<section class="card">${head}<div class="${options.bodyClass ?? ''}">${options.body}</div></section>`;
}

/** Grafik batang 7 hari — HTML + CSS, tanpa library chart. */
export function activityChart(series: Array<{ day: string; count: number }>): string {
  const max = Math.max(1, ...series.map((item) => item.count));
  const today = new Date().toISOString().slice(0, 10);

  const bars = series
    .map((item) => {
      const height = Math.round((item.count / max) * 100);
      const zero = item.count === 0;
      const isToday = item.day === today;
      return `<div class="bar-col${zero ? ' zero' : ''}${isToday ? ' today' : ''}" title="${esc(
        `${dayLabel(item.day)}, ${dateLabel(item.day)} — ${formatNumber(item.count)} pesan`,
      )}">
      <div class="bar-track"><div class="bar-fill" style="height:${zero ? 0 : Math.max(6, height)}%"></div></div>
      <span class="bar-val">${formatNumber(item.count)}</span>
      <span class="bar-day">${
        isToday ? '<span class="day-long">Hari ini</span><span class="day-short">Kini</span>' : esc(dayLabel(item.day))
      }</span>
    </div>`;
    })
    .join('');

  const total = series.reduce((sum, item) => sum + item.count, 0);

  return `<div class="chart"><div class="bars">${bars}</div></div>
<div class="chart-legend">
  <span class="legend-key"><span class="legend-swatch"></span>Pesan tersimpan</span>
  <span>·</span>
  <span><b style="color:var(--text-2)">${formatNumber(total)}</b> pesan dalam 7 hari</span>
</div>`;
}

/** Format byte jadi "96 MB", "1,2 GB". Null/NaN -> "—" (bukan "0 B"). */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Satu desimal hanya kalau perlu: 96 MB lebih enak dibaca daripada 96,3 MB.
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${formatNumber(rounded)} ${units[unit]}`;
}

/* ------------------------------------------------------------------ */
/*  Sumber daya server (CPU, memori, jaringan, disk)                   */
/* ------------------------------------------------------------------ */

/**
 * Satu baris meter untuk panel sumber daya.
 *
 * `percent` = null berarti angka tidak tersedia (mis. `/proc` tidak terbaca di
 * hosting tertentu). Ditampilkan sebagai garis kosong + tanda "—", bukan 0%,
 * karena 0% berarti "tidak terpakai" dan itu klaim yang berbeda.
 */
function meterRow(options: {
  icon: IconName;
  label: string;
  value: string;
  sub: string;
  /** 0–100. null = tidak diketahui. */
  percent: number | null;
}): string {
  const known = options.percent !== null;
  const width = known ? Math.max(0, Math.min(100, options.percent!)) : 0;
  // Bar sempit tetap kelihatan supaya angka kecil tidak terbaca "kosong".
  const visible = known && width > 0 ? Math.max(1.5, width) : 0;
  const tone = !known ? ' unknown' : width >= 85 ? ' danger' : width >= 65 ? ' warn' : '';
  return `<div class="res-row">
  <div class="res-top">
    <span class="res-label">${icon(options.icon, 16)} ${esc(options.label)}</span>
    <span class="res-value">${esc(options.value)}</span>
  </div>
  <div class="res-bar${tone}"><span style="width:${visible}%"></span></div>
  <div class="res-sub">${esc(options.sub)}</div>
</div>`;
}

export interface ResourcePanelData {
  cpuPercent: number | null;
  memoryUsed: number;
  memoryTotal: number | null;
  memoryFromCgroup: boolean;
  networkIn: number | null;
  networkOut: number | null;
  /** Byte/detik. `null` = belum ada sampel pembanding. */
  networkInRate?: number | null;
  networkOutRate?: number | null;
  /** Pemakaian folder server (bukan partisi mesin). */
  diskUsed: number | null;
  /**
   * Kapan `diskUsed` benar-benar diukur (epoch ms).
   *
   * Angka disk dipakai ulang sampai 5 menit supaya dashboard tidak menjelajahi
   * node_modules tiap polling — lihat resources.ts. Panel menuliskan umurnya
   * supaya admin tidak mengira angka itu baru.
   */
  diskUsedAt?: number | null;
  /** Kuota container. `null` = tidak diatur → bar disk tidak ditampilkan. */
  diskTotal: number | null;
  diskTotalSource?: 'env' | 'setting' | null;
  diskReadRate?: number | null;
  diskWriteRate?: number | null;
  uptimeSeconds: number;
  inContainer: boolean;
  /** Epoch ms sampel. Dipakai untuk label "diperbarui X lalu". */
  sampledAt?: number;
  /** Kapasitas partisi mesin — keterangan saja, bukan kuota. */
  partitionTotal?: number | null;
}

/** "2 jam 5 menit" — uptime proses, enak dibaca di sub-baris. */
function humanUptime(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} detik`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours} jam ${rest} menit` : `${hours} jam`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} hari ${restHours} jam` : `${days} hari`;
}

/**
 * Byte/detik yang enak dibaca: "0 B/s", "512 B/s", "12,4 KB/s".
 *
 * Nol ditulis "0 B/s" — bukan "—" — karena nol adalah hasil pengukuran yang
 * sah ("tidak ada lalu lintas"), sama seperti panel hosting menampilkannya.
 */
function rateLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const round1 = (num: number): string =>
    (num >= 10 ? Math.round(num) : Math.round(num * 10) / 10).toLocaleString('id-ID');
  if (value < 1024) return `${formatNumber(value)} B/s`;
  const kb = value / 1024;
  if (kb < 1024) return `${round1(kb)} KB/s`;
  const mb = kb / 1024;
  return `${round1(mb)} MB/s`;
}

/**
 * Panel "Pemakaian server": CPU, memori, jaringan, disk.
 *
 * Semua angka milik **proses bot ini**, bukan seluruh mesin. Nilai di dalam
 * `data-*` dipakai JS untuk memperbarui panel tanpa memuat ulang halaman
 * (lihat `liveResources()` di halaman Ringkasan).
 */
export function resourcePanel(data: ResourcePanelData): string {
  const memPercent =
    data.memoryTotal && data.memoryTotal > 0 ? (data.memoryUsed / data.memoryTotal) * 100 : null;

  // Disk: bar persentase HANYA kalau kuota diketahui. Dulu penyebutnya
  // kapasitas partisi mesin induk, sehingga hosting 1 GB terbaca
  // "353 GB / 441 GB" — angka yang tidak ada hubungannya dengan jatah bot.
  const diskPercent =
    data.diskTotal && data.diskTotal > 0 && data.diskUsed !== null
      ? (data.diskUsed / data.diskTotal) * 100
      : null;

  const memSub = data.memoryTotal
    ? `${formatNumber(decimals(memPercent))}% dari ${formatBytes(data.memoryTotal)}${
        data.memoryFromCgroup ? ' (batas container)' : ''
      }`
    : 'batas tidak terbaca';

  // Jaringan: kecepatan sesaat + total kumulatif sebagai konteks.
  const netRateIn = rateLabel(data.networkInRate);
  const netRateOut = rateLabel(data.networkOutRate);
  const netSub =
    data.networkInRate === null && data.networkOutRate === null && data.networkIn === null
      ? 'statistik jaringan tidak tersedia di sistem ini'
      : `↓ ${netRateIn} · ↑ ${netRateOut} sekarang — total ${formatBytes(data.networkIn)} masuk / ${formatBytes(data.networkOut)} keluar`;

  const diskSub = !data.diskTotal
    ? `kuota container belum diatur · ${formatBytes(data.diskUsed)} terpakai${data.partitionTotal ? ` (partisi mesin ${formatBytes(data.partitionTotal)})` : ''}`
    : `${formatNumber(decimals(diskPercent))}% dari ${formatBytes(data.diskTotal)}${data.diskTotalSource === 'env' ? ' (dari .env)' : data.diskTotalSource === 'setting' ? ' (dari Pengaturan)' : ''}`;

  // Kecepatan disk hanya kalau sampelnya ada; jangan tampilkan baris kosong.
  const diskIoRate =
    data.diskReadRate === null && data.diskWriteRate === null
      ? ''
      : ` · baca ${rateLabel(data.diskReadRate)} / tulis ${rateLabel(data.diskWriteRate)}`;

  const rows = [
    meterRow({
      icon: 'cpu',
      label: 'CPU',
      value: data.cpuPercent === null ? '—' : `${formatNumber(oneDecimal(data.cpuPercent))}%`,
      sub:
        data.cpuPercent === null
          ? 'menunggu sampel berikutnya'
          : `sampel ${data.inContainer ? 'dari jatah container' : 'dari seluruh inti mesin'}`,
      percent: data.cpuPercent,
    }),
    meterRow({
      icon: 'memory',
      label: 'Memori',
      value: formatBytes(data.memoryUsed),
      sub: memSub,
      percent: memPercent,
    }),
    meterRow({
      icon: 'network',
      label: 'Jaringan',
      value: `${rateLabel(data.networkInRate)} masuk`,
      sub: netSub,
      percent: null,
    }),
    meterRow({
      icon: 'disk',
      label: 'Disk',
      value: formatBytes(data.diskUsed),
      sub: `${diskSub}${diskIoRate}`,
      percent: diskPercent,
    }),
  ].join('');

  // Data mentah untuk JS: panel diperbarui tanpa memuat ulang halaman.
  const live = JSON.stringify({
    cpuPercent: data.cpuPercent,
    memoryUsed: data.memoryUsed,
    memoryTotal: data.memoryTotal,
    memoryFromCgroup: data.memoryFromCgroup,
    networkIn: data.networkIn,
    networkOut: data.networkOut,
    networkInRate: data.networkInRate ?? null,
    networkOutRate: data.networkOutRate ?? null,
    diskUsed: data.diskUsed,
    diskUsedAt: data.diskUsedAt ?? null,
    diskTotal: data.diskTotal,
    diskTotalSource: data.diskTotalSource ?? null,
    diskReadRate: data.diskReadRate ?? null,
    diskWriteRate: data.diskWriteRate ?? null,
    uptimeSeconds: data.uptimeSeconds,
    inContainer: data.inContainer,
    sampledAt: data.sampledAt ?? Date.now(),
    partitionTotal: data.partitionTotal ?? null,
  });

  return `<div class="res-list">${rows}</div>
<div class="res-foot">
  <span id="resUpdated">Proses hidup ${esc(humanUptime(data.uptimeSeconds))} · angka di sini milik <b>proses bot ini</b>, bukan seluruh mesin.</span>
  <span class="res-live"><span class="res-dot" id="resDot"></span><span id="resLive">langsung</span></span>
  <button class="res-refresh" type="button" id="resRefreshDisk" onclick="refreshDisk()" title="Hitung ulang pemakaian folder sekarang">ukur ulang disk</button>
</div>
<script type="application/json" id="resSeed">${live}</script>`;
}

/** 1 desimal, tapi "0%" tetap "0%" — bukan "0,0%". */
function decimals(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
}

/**
 * Selalu satu desimal, dipakai untuk CPU.
 *
 * CPU bot biasanya diam di bawah 5%, jadi membulatkan 0,6% jadi "1%" (atau 12,5
 * jadi 13) menghapus justru informasi yang dicari orang. Untuk persen besar
 * tetap dibulatkan supaya tidak berisik.
 */
function oneDecimal(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
}
