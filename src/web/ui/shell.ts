/**
 * Kerangka halaman: sidebar, topbar, area konten, toast, dialog konfirmasi.
 * HTML-nya server-rendered; JS di bawah hanya untuk interaksi kecil
 * (menu mobile, salin ID, toast, konfirmasi hapus).
 */
import { icon, type IconName } from './icons.js';
import { esc, initials } from './base.js';
import { STYLE } from './theme.js';

export type PageKey =
  | 'ringkasan'
  | 'panel'
  | 'sambutan'
  | 'agent'
  | 'dokumen'
  | 'keyword'
  | 'moderasi'
  | 'pengaturan';

export interface ShellOptions {
  title: string;
  guildId: string;
  /** Nama server dari Discord; null = bot belum pernah melihat server ini. */
  guildName: string | null;
  active: PageKey;
  body: string;
  subtitle?: string;
  counts?: Partial<Record<PageKey, number>>;
  status: { online: boolean; mode: 'bot' | 'standalone'; uptimeSeconds: number };
}

const NAV: Array<{ key: PageKey; label: string; href: string; icon: IconName }> = [
  { key: 'ringkasan', label: 'Ringkasan', href: '/', icon: 'home' },
  { key: 'panel', label: 'Panel', href: '/panel', icon: 'sparkles' },
  { key: 'sambutan', label: 'Sambutan', href: '/sambutan', icon: 'users' },
  { key: 'agent', label: 'AI Agent', href: '/agent', icon: 'message' },
  { key: 'dokumen', label: 'Dokumen RAG', href: '/dokumen', icon: 'book' },
  { key: 'keyword', label: 'Keyword', href: '/keyword', icon: 'tag' },
  { key: 'moderasi', label: 'Moderasi', href: '/moderasi', icon: 'shield' },
  { key: 'pengaturan', label: 'Pengaturan', href: '/pengaturan', icon: 'sliders' },
];

function uptime(seconds: number): string {
  const day = Math.floor(seconds / 86400);
  const hour = Math.floor((seconds % 86400) / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  if (day > 0) return `${day} hari ${hour} jam`;
  if (hour > 0) return `${hour} jam ${minute} mnt`;
  return `${minute} menit`;
}

export const SHARED_JS = `
function toast(message, bad) {
  var el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('bad', !!bad);
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(function () { el.classList.remove('show'); }, 4200);
}

async function api(path, options) {
  var response = await fetch(path, options || {});
  var data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
  return data;
}

function copyText(text, label) {
  var done = function () { toast('✅ ' + (label || 'ID') + ' disalin'); };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(function () { toast('Gagal menyalin', true); });
    return;
  }
  var area = document.createElement('textarea');
  area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.appendChild(area); area.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Gagal menyalin', true); }
  document.body.removeChild(area);
}

function askConfirm(title, message, confirmLabel) {
  return new Promise(function (resolve) {
    var dialog = document.getElementById('confirmDialog');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmText').textContent = message;
    document.getElementById('confirmOk').textContent = confirmLabel || 'Hapus';
    var onOk = function () { cleanup(); dialog.close(); resolve(true); };
    var onCancel = function () { cleanup(); dialog.close(); resolve(false); };
    function cleanup() {
      document.getElementById('confirmOk').removeEventListener('click', onOk);
      document.getElementById('confirmCancel').removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
    }
    document.getElementById('confirmOk').addEventListener('click', onOk);
    document.getElementById('confirmCancel').addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}

document.addEventListener('click', function (event) {
  var burger = event.target.closest('[data-nav-toggle]');
  var sidebar = document.getElementById('sidebar');
  var backdrop = document.getElementById('backdrop');
  if (burger && sidebar && backdrop) {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('show');
    return;
  }
  if (backdrop && event.target === backdrop) {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
    return;
  }
  var copyTarget = event.target.closest('[data-copy]');
  if (copyTarget) {
    copyText(copyTarget.getAttribute('data-copy'), copyTarget.getAttribute('data-copy-label'));
  }
});
`;

/** Label server: nama Discord kalau sudah diketahui bot, kalau belum pakai ID ringkas. */
export function guildLabel(name: string | null, guildId: string): string {
  const clean = name?.trim();
  if (clean) return clean.length > 42 ? `${clean.slice(0, 41)}…` : clean;
  return guildId ? `Server ${guildId.slice(-6)}` : 'Server belum diatur';
}

/**
 * Badge server di topbar — bukan pemilih.
 *
 * Bot ini untuk satu server, jadi tidak ada yang bisa diganti di sini; badge
 * hanya memberi tahu server mana yang sedang dikelola dashboard.
 */
function guildBadge(options: ShellOptions): string {
  const name = guildLabel(options.guildName, options.guildId);

  return `<span class="guild-static" title="Server bot ini (ID: ${esc(options.guildId || '—')})">
    ${icon('users', 15)}
    <span>${esc(name)}</span>
    <span class="guild-static-id mono">${esc(options.guildId || '—')}</span>
  </span>`;
}

export function appShell(options: ShellOptions): string {
  const nav = NAV.map((item) => {
    const count = options.counts?.[item.key];
    return `<a class="nav-item${item.key === options.active ? ' active' : ''}" href="${item.href}">
      ${icon(item.icon, 18)}
      <span>${esc(item.label)}</span>
      ${count !== undefined && count > 0 ? `<span class="nav-badge">${count}</span>` : ''}
    </a>`;
  }).join('');

  const statusLine = options.status.mode === 'bot'
    ? options.status.online
      ? 'Bot online'
      : 'Bot menghubungkan…'
    : 'Mode dashboard';

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(options.title)} · Zypher AI</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
<style>${STYLE}</style>
</head>
<body>
<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <span class="brand-mark">${icon('sparkles', 19)}</span>
      <span class="brand-text">
        <span class="brand-name">Zypher AI</span>
        <span class="brand-sub">Control panel</span>
      </span>
    </div>

    <nav class="nav" aria-label="Navigasi utama">
      <span class="nav-label">Kelola</span>
      ${nav}
    </nav>

    <div class="sidebar-foot">
      <div class="status-card">
        <span class="status-line">
          <span class="dot ${options.status.mode === 'bot' && options.status.online ? 'pulse' : 'off'}"></span>
          ${esc(statusLine)}
        </span>
        <span class="status-meta">Uptime ${esc(uptime(options.status.uptimeSeconds))}</span>
      </div>
      <a class="nav-item" href="/healthz" target="_blank" rel="noreferrer">
        ${icon('activity', 18)}<span>Health check</span>${icon('external', 14)}
      </a>
    </div>
  </aside>
  <div class="backdrop" id="backdrop"></div>

  <div class="main">
    <header class="topbar">
      <button class="icon-btn burger" type="button" data-nav-toggle aria-label="Buka menu">${icon('menu', 18)}</button>
      ${guildBadge(options)}
      <div class="topbar-right">
        <span class="avatar" title="Admin dashboard">${esc(
          options.guildId ? initials(options.guildName ?? options.guildId) : 'AI',
        )}</span>
        <a class="icon-btn" href="/logout" title="Keluar" aria-label="Keluar">${icon('logout', 17)}</a>
      </div>
    </header>

    <main class="content">
      ${options.body}
    </main>
  </div>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>
<dialog class="confirm" id="confirmDialog">
  <div class="dialog-body">
    <h3 id="confirmTitle">Hapus?</h3>
    <p id="confirmText"></p>
  </div>
  <div class="dialog-actions">
    <button class="btn-ghost" type="button" id="confirmCancel">Batal</button>
    <button class="btn-danger" type="button" id="confirmOk">Hapus</button>
  </div>
</dialog>
<script>${SHARED_JS}</script>
</body>
</html>`;
}

export function pageHead(options: {
  title: string;
  kicker?: string;
  subtitle?: string;
  actions?: string;
}): string {
  return `<div class="page-head">
  <div>
    ${options.kicker ? `<span class="kicker">${esc(options.kicker)}</span>` : ''}
    <h1>${esc(options.title)}</h1>
    ${options.subtitle ? `<p class="sub">${options.subtitle}</p>` : ''}
  </div>
  ${options.actions ? `<div class="page-actions">${options.actions}</div>` : ''}
</div>`;
}
