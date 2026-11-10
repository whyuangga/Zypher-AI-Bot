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
      <span class="bar-day">${esc(isToday ? 'Hari ini' : dayLabel(item.day))}</span>
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
