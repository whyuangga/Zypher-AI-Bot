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
  | 'pesan'
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
  { key: 'pesan', label: 'Pesan', href: '/pesan', icon: 'file' },
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
/**
 * Bandingkan dua versi isi pesan (dipakai kartu Riwayat di halaman /pesan).
 *
 * Ditaruh di JS bersama, bukan di dalam halaman: seluruh isinya fungsi murni
 * tanpa DOM, jadi bisa diuji langsung tanpa memasang halaman. Pembanding yang
 * hanya bisa diuji lewat klik adalah pembanding yang tidak pernah diuji.
 */
function diffRingkas(lama, baru) {
  var blokLama = (lama && lama.blocks) || [];
  var blokBaru = (baru && baru.blocks) || [];
  var baris = [];
  var teks = [];
  var ditambah = 0;
  var dihapus = 0;
  var diubah = 0;

  function nama(kind) {
    var peta = {
      text: 'teks', image: 'gambar', button: 'tombol', select: 'menu pilihan',
      separator: 'pemisah', container: 'container', section: 'section',
      file: 'berkas', row: 'baris baru', close: 'tutup kartu'
    };
    return peta[kind] || kind;
  }

  function potong(nilai) {
    if (nilai === null || nilai === undefined || nilai === '') return '(kosong)';
    if (typeof nilai === 'boolean') return nilai ? 'ya' : 'tidak';
    if (Object.prototype.toString.call(nilai) === '[object Array]') {
      return nilai.length ? nilai.join(', ') : '(kosong)';
    }
    if (typeof nilai === 'object') return JSON.stringify(nilai).slice(0, 40);
    return String(nilai).slice(0, 40);
  }

  // Per posisi, bukan LCS: admin mengubah blok di tempat, dan "blok ke-3
  // berubah" lebih mudah dipahami daripada "satu elemen disisipkan".
  var panjang = Math.max(blokLama.length, blokBaru.length);
  for (var i = 0; i < panjang; i += 1) {
    var a = blokLama[i];
    var b = blokBaru[i];
    if (!a) {
      ditambah += 1;
      baris.push('+ blok ' + (i + 1) + ': ' + nama(b.kind) + ' ditambahkan');
      continue;
    }
    if (!b) {
      dihapus += 1;
      baris.push('− blok ' + (i + 1) + ': ' + nama(a.kind) + ' dihapus');
      continue;
    }
    /*
     * Dibandingkan UTUH lewat JSON, bukan per field: field yang lupa
     * dibandingkan membuat perubahan tidak terlihat sama sekali.
     */
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    diubah += 1;
    if (a.kind !== b.kind) {
      baris.push('~ blok ' + (i + 1) + ': ' + nama(a.kind) + ' diganti ' + nama(b.kind));
      continue;
    }
    if (a.kind === 'text' && typeof a.value === 'string' && typeof b.value === 'string') {
      teks.push({ posisi: i + 1, lama: a.value, baru: b.value });
      baris.push('~ blok ' + (i + 1) + ': teks diubah');
      continue;
    }
    baris.push('~ blok ' + (i + 1) + ': ' + nama(a.kind) + ' diubah');
  }

  // Pengaturan yang tidak tampil sebagai blok tetap bisa berubah.
  var pengaturan = 0;
  function beda(label, x, y) {
    if (JSON.stringify(x === undefined ? null : x) === JSON.stringify(y === undefined ? null : y)) return;
    pengaturan += 1;
    baris.push('~ ' + label + ': ' + potong(x) + ' → ' + potong(y));
  }
  beda('warna aksen', lama && lama.accent, baru && baru.accent);
  beda('pengirim', lama && lama.sender, baru && baru.sender);
  beda(
    'izin ping',
    (lama && lama.allowedMentions && lama.allowedMentions.parse) || [],
    (baru && baru.allowedMentions && baru.allowedMentions.parse) || []
  );
  beda('nama thread', lama && lama.threadName, baru && baru.threadName);
  beda('mode rangkaian', lama && lama.series === true, baru && baru.series === true);
  beda('flag pesan', (lama && lama.flags) || 0, (baru && baru.flags) || 0);
  /*
   * Bagian embed (penulis, footer, bidang) dibandingkan sebagai satu nilai:
   * perubahan pada footer kedua embed tetap terlihat, tanpa membuat panel
   * riwayat penuh dengan baris per bidang.
   */
  beda('bentuk pesan', lama && lama.layout, baru && baru.layout);
  beda('embed', ringkasEmbedDiff(lama && lama.embed), ringkasEmbedDiff(baru && baru.embed));

  var total = ditambah + dihapus + diubah + pengaturan;
  if (total === 0) baris.push('Tidak ada perbedaan — versi ini sama dengan yang sekarang.');
  return { total: total, ditambah: ditambah, dihapus: dihapus, diubah: diubah, baris: baris, teks: teks };
}

/**
 * Ringkasan daftar bagian embed untuk pembanding versi.
 *
 * Diringkas jadi satu baris per embed ("Embed 1: penulis Tim, 2 bidang"), bukan
 * JSON mentah: admin membandingkan versi untuk tahu APA yang berubah, dan JSON
 * penuh hanya membuat panel diff sulit dibaca. Nilai kosong tetap muncul
 * sebagai "tanpa bagian admin" supaya menghapus semua embed terlihat.
 */
function ringkasEmbedDiff(daftar) {
  var isi = Object.prototype.toString.call(daftar) === '[object Array]' ? daftar : daftar ? [daftar] : [];
  var bagian = [];
  for (var i = 0; i < isi.length; i += 1) {
    var satu = isi[i] || {};
    var potongan = [];
    if (satu.author && satu.author.name) potongan.push('penulis ' + String(satu.author.name).slice(0, 30));
    if (satu.footer && satu.footer.text) potongan.push('footer ' + String(satu.footer.text).slice(0, 30));
    if (satu.fields && satu.fields.length) potongan.push(satu.fields.length + ' bidang');
    if (satu.url) potongan.push('tautan judul');
    if (satu.timestamp) potongan.push('stempel waktu');
    bagian.push('embed ' + (i + 1) + ': ' + (potongan.length ? potongan.join(', ') : 'hanya isi blok'));
  }
  return bagian.length ? bagian.join('; ') : 'tanpa bagian admin';
}

/** "3 perubahan (1 tambah, 2 ubah)" — judul panel diff. */
function ringkasDiff(hasil) {
  if (!hasil || !hasil.total) return 'Sama dengan versi sekarang';
  var bagian = [];
  if (hasil.ditambah) bagian.push(hasil.ditambah + ' tambah');
  if (hasil.dihapus) bagian.push(hasil.dihapus + ' hapus');
  if (hasil.diubah) bagian.push(hasil.diubah + ' ubah');
  var lain = hasil.total - (hasil.ditambah + hasil.dihapus + hasil.diubah);
  if (lain) bagian.push(lain + ' pengaturan');
  return hasil.total + ' perubahan (' + bagian.join(', ') + ')';
}

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

/**
 * Kirim JSON ke API dan tampilkan hasilnya sebagai toast.
 * Tanpa ini, tombol Simpan di halaman mana pun akan ReferenceError di browser.
 */
async function postJson(path, payload, successMessage) {
  try {
    var data = await api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (successMessage) toast('✅ ' + successMessage);
    return data;
  } catch (error) {
    toast('Gagal: ' + error.message, true);
    throw error;
  }
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
