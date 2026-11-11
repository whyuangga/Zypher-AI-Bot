/**
 * Semua halaman dashboard. Server-rendered; JS hanya untuk aksi kecil
 * (upload, hapus, simpan) yang memanggil API JSON di server.ts.
 */
import { icon } from './icons.js';
import { DISPLAY_MODES, normalizeDisplayMode } from '../../features/display-mode.js';
import {
  activityChart,
  badge,
  card,
  emptyState,
  esc,
  formatDate,
  formatNumber,
  initials,
  relativeTime,
  statCard,
} from './base.js';
import { appShell, pageHead, SHARED_JS, type PageKey } from './shell.js';
import { STYLE } from './theme.js';

export interface ShellStatus {
  online: boolean;
  mode: 'bot' | 'standalone';
  uptimeSeconds: number;
}

export interface PageContext {
  guildId: string;
  guildName: string | null;
  status: ShellStatus;
  counts?: Partial<Record<PageKey, number>>;
}

/* ------------------------------------------------------------------ */
/*  Login                                                              */
/* ------------------------------------------------------------------ */

export function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Masuk · Zypher AI</title>
<style>${STYLE}</style>
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <div class="login-head">
      <span class="brand-mark">${icon('sparkles', 20)}</span>
      <span class="kicker">Zypher AI — Dashboard admin</span>
      <h1>Masuk ke dashboard</h1>
      <p>Dashboard admin bot. Tempel <code>DASHBOARD_TOKEN</code> dari file <code>.env</code> atau tab Environment panel.</p>
    </div>
    <form class="card login-form" method="post" action="/login">
      ${error ? `<div class="alert">${icon('alert', 16)}<span>${esc(error)}</span></div>` : ''}
      <div>
        <label class="field" for="token">Token admin</label>
        <span class="pw-shell">
          <input type="password" id="token" name="token" placeholder="Tempel token di sini" autofocus
            autocomplete="current-password" spellcheck="false">
          <button class="pw-toggle" type="button" id="pwToggle" aria-label="Tampilkan token">${icon('eye', 17)}</button>
        </span>
      </div>
      <button class="btn-primary" type="submit">Masuk ke dashboard</button>
    </form>
    <details class="card" style="margin-top:12px;overflow:hidden">
      <summary style="padding:12px 16px;cursor:pointer;font-size:13px;color:var(--text-2)">Login cepat lewat link</summary>
      <div style="padding:0 16px 14px;color:var(--text-3);font-size:12.5px;line-height:1.65">
        Buka <code>/masuk/&lt;token&gt;</code> di address bar — dashboard langsung terbuka tanpa mengetik.
        Halaman perantara mengalihkan dengan <code>location.replace()</code>, jadi URL bertoken tidak
        tertinggal di riwayat browser.
        <br><br><b style="color:var(--warn)">Jangan bagikan link itu</b> — siapa pun yang membukanya
        mendapat akses penuh ke dashboard.
      </div>
    </details>
    <p class="login-foot">Sesi berlaku 12 jam · cookie httpOnly · token di URL tidak disimpan di riwayat</p>
  </div>
</div>
<script>
document.getElementById('pwToggle').addEventListener('click', function () {
  var input = document.getElementById('token');
  var shown = input.type === 'text';
  input.type = shown ? 'password' : 'text';
  this.innerHTML = shown ? ${JSON.stringify(icon('eye', 17))} : ${JSON.stringify(icon('eye-off', 17))};
  this.setAttribute('aria-label', shown ? 'Tampilkan token' : 'Sembunyikan token');
});
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Ringkasan                                                          */
/* ------------------------------------------------------------------ */

export interface DashboardData extends PageContext {
  stats: { rooms: number; documents: number; chunks: number; keywords: number; messages: number };
  rooms: Array<{ userId: string; messageCount: number; lastActiveAt: number }>;
  documents: Array<{ id: number; name: string; chunkCount: number; chars: number; createdAt: number }>;
  series: Array<{ day: string; count: number }>;
  ragEnabled: boolean;
  embedModel: string | null;
  model: string;
  /** Label engine database, mis. "SQLite" atau "PostgreSQL" */
  storage?: string;
}

export function ringkasanPage(data: DashboardData): string {
  const stats = `<div class="grid stats">
  ${statCard({ label: 'Sesi DM', value: data.stats.rooms, icon: 'message', foot: 'pribadi per member' })}
  ${statCard({ label: 'Dokumen RAG', value: data.stats.documents, icon: 'book', foot: `<b>${formatNumber(data.stats.chunks)}</b> potongan teks` })}
  ${statCard({ label: 'Keyword', value: data.stats.keywords, icon: 'tag', foot: 'template owner' })}
</div>`;

  const chartCard = card({
    title: 'Aktivitas 7 hari',
    hint: 'pesan AI yang tersimpan',
    body: activityChart(data.series),
  });

  const statusCard = card({
    title: 'Status sistem',
    body: `<div class="list">
  <div class="kv"><span>Model AI</span><b class="mono">${esc(data.model)}</b></div>
  <div class="kv"><span>Pencarian</span><b>${data.embedModel ? 'Hybrid BM25 + vektor' : 'Leksikal (BM25)'}</b></div>
  <div class="kv"><span>Dokumen RAG</span>${data.ragEnabled ? badge('Aktif', 'ok') : badge('Nonaktif', 'warn')}</div>
  <div class="kv"><span>Pesan tersimpan</span><b>${formatNumber(data.stats.messages)}</b></div>
  <div class="kv"><span>Keyword aktif</span><b>${formatNumber(data.stats.keywords)}</b></div>
  <div class="kv"><span>Database</span><b>${esc(data.storage ?? 'SQLite')}</b></div>
  <div class="kv"><span>Mode</span><b>${data.status.mode === 'bot' ? 'Bot + dashboard' : 'Dashboard saja'}</b></div>
</div>`,
  });

  const roomRows = data.rooms.length
    ? data.rooms
        .slice(0, 6)
        .map(
          (session) => `<tr>
    <td>
      <div class="cell-main">
        <span class="avatar-sm">${esc(initials(session.userId))}</span>
        <span>
          <div class="cell-title">DM <span class="mono">…${esc(session.userId.slice(-4))}</span></div>
          <div class="cell-sub mono" title="Member: ${esc(session.userId)}">member …${esc(session.userId.slice(-4))}</div>
        </span>
      </div>
    </td>
    <td class="col-count">${formatNumber(session.messageCount)}</td>
    <td class="col-activity"><span class="badge">${icon('activity', 13)} ${esc(relativeTime(session.lastActiveAt))}</span></td>
  </tr>`,
        )
        .join('')
    : '';

  const roomsCard = card({
    title: 'Sesi DM terbaru',
    // Tanpa ikon chevron: ini tautan biasa, bukan dropdown. Panah ke bawah di
    // tombol membuat orang mengira ada menu yang bisa dibuka.
    right: `<a class="btn-ghost btn-sm" href="/panel">Kelola panel</a>`,
    body: roomRows
      ? `<div class="table-wrap"><table>
  <thead><tr><th>Pemilik</th><th class="col-count">Pesan</th><th class="col-activity">Aktivitas</th></tr></thead>
  <tbody>${roomRows}</tbody>
</table></div>`
      : emptyState({
          icon: 'message',
          title: 'Belum ada sesi DM',
          text: 'Member memulai chat lewat tombol "Chat via DM" di panel Discord — sesinya akan muncul di sini (tanpa isi percakapan).',
        }),
  });

  const docsCard = card({
    title: 'Dokumen terbaru',
    right: `<a class="btn-ghost btn-sm" href="/dokumen">Kelola</a>`,
    body: data.documents.length
      ? `<div class="list">${data.documents
          .slice(0, 5)
          .map(
            (document) => `<div class="list-row">
      <span class="avatar-sm">${icon('file', 15)}</span>
      <div class="list-body">
        <div class="list-title">${esc(document.name)}</div>
        <div class="list-meta">${formatNumber(document.chunkCount)} potongan · ${esc(relativeTime(document.createdAt))}</div>
      </div>
    </div>`,
          )
          .join('')}</div>`
      : emptyState({
          icon: 'book',
          title: 'Belum ada dokumen',
          text: 'Upload FAQ atau aturan server supaya AI menjawab berdasarkan pengetahuanmu, bukan mengarang.',
          action: { label: 'Upload dokumen', href: '/dokumen' },
        }),
  });

  const body = `${pageHead({
    kicker: '01 — Ikhtisar',
    title: 'Ringkasan',
    subtitle: `${
      data.guildName
        ? `${esc(data.guildName)} · <span class="mono">${esc(data.guildId)}</span>`
        : `Server <span class="mono">${esc(data.guildId || '—')}</span>`
    } · data langsung dari ${esc(data.storage ?? 'SQLite')} bot`,
    actions: `<a class="btn-primary" href="/dokumen">${icon('upload', 16)} Upload dokumen</a>`,
  })}
${stats}
<div class="grid cols-2 mt">${chartCard}${statusCard}</div>
<div class="grid cols-2 mt">${roomsCard}${docsCard}</div>`;

  return appShell({ title: 'Ringkasan', guildId: data.guildId, guildName: data.guildName, active: 'ringkasan', body, counts: data.counts, status: data.status });
}

/* ------------------------------------------------------------------ */
/*  Panel chat DM                                                      */
/* ------------------------------------------------------------------ */

export interface PanelOptions extends PageContext {
  /** Tombol "Chat via DM" aktif atau tidak. */
  enabled: boolean;
  /** Channel panel aktif (null = belum pernah dikirim). */
  channelId: string | null;
  messageId: string | null;
  updatedAt: number | null;
  /** Channel teks server ini — hanya terisi saat bot online. */
  channels: Array<{ id: string; name: string }>;
  botOnline: boolean;
}

export function panelPage(options: PanelOptions): string {
  const status = options.enabled ? badge('Panel aktif', 'ok') : badge('Panel nonaktif', 'warn');
  const hasPanel = Boolean(options.messageId);

  const channelField = options.channels.length
    ? `<span class="select-shell" style="display:flex;width:100%">
    <select id="panelChannel" style="width:100%;max-width:none">
      <option value="">— pilih channel —</option>
      ${options.channels
        .map(
          (channel) =>
            `<option value="${esc(channel.id)}"${channel.id === options.channelId ? ' selected' : ''}>#${esc(
              channel.name,
            )}</option>`,
        )
        .join('')}
    </select>
    ${icon('chevron', 15)}
  </span>`
    : `<input type="text" id="panelChannel" class="mono" inputmode="numeric" placeholder="123456789012345678"
    value="${esc(options.channelId ?? '')}" spellcheck="false">`;

  const offlineNotice = options.botOnline
    ? ''
    : `<div class="notice">${icon('alert', 16)}<span>Bot Discord sedang offline. Panel hanya bisa dikirim atau dihapus saat bot berjalan — di mode dashboard saja, pengaturan di bawah tetap tersimpan.</span></div>`;

  const panelCard = card({
    title: 'Panel chat DM',
    hint: 'satu channel per server',
    right: status,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <div>
    <label class="field" for="panelChannel">Channel panel</label>
    ${channelField}
    <p class="hint">${
      options.channels.length
        ? 'Hanya channel teks yang muncul di daftar ini.'
        : 'Daftar channel muncul saat bot online. Untuk sekarang, tempel Channel ID (Discord → Settings → Advanced → Developer Mode → klik kanan channel → Copy Channel ID).'
    }</p>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <button class="btn-primary" type="button" id="sendPanel" onclick="sendPanel()">
      ${icon('upload', 16)} ${hasPanel ? 'Kirim ulang panel' : 'Kirim panel'}
    </button>
    <button class="btn-danger" type="button" id="removePanel" onclick="removePanelAction()" ${hasPanel ? '' : 'disabled'}>
      ${icon('trash', 15)} Hapus panel
    </button>
  </div>
  <p class="hint" style="margin:0">Mengirim panel ke channel lain otomatis menghapus panel lama — tidak akan pernah ada dua panel aktif.</p>
</div>`,
  });

  const toggleCard = card({
    title: 'Tombol Chat via DM',
    hint: 'berlaku untuk panel yang sudah terkirim',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <label class="check-row" style="display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--text-2)">
    <input type="checkbox" id="panelEnabled" ${options.enabled ? 'checked' : ''} onchange="togglePanel()"
      style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Izinkan member memulai chat lewat panel</span>
  </label>
  <div class="list">
    <div class="kv"><span>Channel</span><b>${options.channelId ? `<span class="mono">…${esc(options.channelId.slice(-6))}</span>` : '—'}</b></div>
    <div class="kv"><span>Pesan panel</span><b>${options.messageId ? `<span class="mono">…${esc(options.messageId.slice(-6))}</span>` : 'belum dikirim'}</b></div>
    <div class="kv"><span>Diperbarui</span><b>${options.updatedAt ? esc(relativeTime(options.updatedAt)) : '—'}</b></div>
  </div>
  <p class="hint" style="margin:0">Dimatikan = tombol <b>Chat via DM</b> menjawab "sedang dinonaktifkan admin". Pesan panelnya tetap bisa dibaca member, dan <code>/panel</code> di Discord tetap menyimpan catatan ke halaman ini.</p>
</div>`,
  });

  const body = `${pageHead({
    kicker: '02 — Pintu masuk',
    title: 'Panel',
    subtitle: 'Tombol "Chat via DM" untuk member. Kirim, pindahkan, atau hapus panel dari sini tanpa perlu mengetik perintah di Discord.',
    actions: status,
  })}
${options.botOnline ? '' : `<div class="mt">${offlineNotice}</div>`}
<div class="grid cols-2-even">${panelCard}${toggleCard}</div>
<script>
function panelChannelValue() {
  var el = document.getElementById('panelChannel');
  return el ? el.value.trim() : '';
}

async function panelApi(payload) {
  return api('/api/panel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function sendPanel() {
  var channelId = panelChannelValue();
  if (!channelId) { toast('Pilih channel dulu', true); return; }
  var button = document.getElementById('sendPanel');
  button.disabled = true;
  try {
    await panelApi({ guild: ${JSON.stringify(options.guildId)}, action: 'send', channelId: channelId });
    toast('✅ Panel terkirim');
    setTimeout(function () { location.reload(); }, 400);
  } catch (error) {
    toast('Gagal mengirim: ' + error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function removePanelAction() {
  var ok = await askConfirm('Hapus panel?', 'Pesan panel akan dihapus dari Discord, jadi tombol "Chat via DM" tidak bisa diklik lagi.');
  if (!ok) return;
  try {
    await panelApi({ guild: ${JSON.stringify(options.guildId)}, action: 'remove' });
    toast('Panel dihapus');
    setTimeout(function () { location.reload(); }, 400);
  } catch (error) {
    toast('Gagal menghapus: ' + error.message, true);
  }
}

async function togglePanel() {
  var enabled = document.getElementById('panelEnabled').checked;
  try {
    await panelApi({ guild: ${JSON.stringify(options.guildId)}, action: 'toggle', enabled: enabled });
    toast(enabled ? '✅ Panel diaktifkan' : 'Panel dinonaktifkan');
  } catch (error) {
    toast('Gagal menyimpan: ' + error.message, true);
    document.getElementById('panelEnabled').checked = !enabled;
  }
}
</script>`;

  return appShell({
    title: 'Panel',
    guildId: options.guildId,
    guildName: options.guildName,
    active: 'panel',
    body,
    counts: options.counts,
    status: options.status,
  });
}

/* ------------------------------------------------------------------ */
/*  Dokumen RAG                                                        */
/* ------------------------------------------------------------------ */

export interface DocumentRowView {
  id: number;
  name: string;
  chunkCount: number;
  chars: number;
  source: string;
  createdAt: number;
}

export function dokumenPage(options: PageContext & { documents: DocumentRowView[]; embedModel: string | null }): string {
  const rows = options.documents.length
    ? options.documents
        .map(
          (document) => `<tr>
  <td class="cell-main-cell">
    <div class="cell-main">
      <span class="avatar-sm">${icon('file', 15)}</span>
      <span style="min-width:0">
        <div class="cell-title">${esc(document.name)}</div>
        <div class="cell-sub">${badge(document.source === 'dashboard' ? 'dashboard' : document.source, 'brand', false)}</div>
      </span>
    </div>
  </td>
  <td>
    <div class="cell-title">${formatNumber(document.chunkCount)}&nbsp;potongan</div>
    <div class="cell-sub">${formatNumber(document.chars)}&nbsp;karakter</div>
  </td>
  <td class="cell-date" data-label="Ditambahkan"><span class="cell-sub">${esc(formatDate(document.createdAt))}</span></td>
  <td class="num cell-aksi">
    <button class="btn-danger btn-sm btn-icon" type="button"
      onclick="removeDoc(${document.id}, ${esc(JSON.stringify(document.name))})"
      title="Hapus dokumen" aria-label="Hapus ${esc(document.name)}">${icon('trash', 15)}</button>
  </td>
</tr>`,
        )
        .join('')
    : '';

  const uploadCard = card({
    title: 'Upload dari komputer',
    body: `<div class="card-pad" style="padding-top:6px">
  <label class="drop" for="file">
    <input type="file" id="file" accept=".txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.html,.htm,.xml,.log,.ini,.yaml,.yml,.sql,.ts,.js,.py,.pdf,.docx">
    <span class="drop-ico">${icon('upload', 17)}</span>
    <span class="drop-text">
      <b id="fileName">Pilih file dari perangkat</b>
      <span id="fileMeta">TXT · MD · CSV · JSON · PDF · DOCX — maks 8 MB</span>
    </span>
  </label>
  <div class="field-row" style="margin-top:14px">
    <button class="btn-primary" type="button" id="uploadBtn" onclick="uploadFile()">${icon('upload', 16)} Upload dokumen</button>
    <span class="hint" id="uploadState"></span>
  </div>
</div>`,
  });

  const pasteCard = card({
    title: 'Atau tempel teks',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:12px">
  <div>
    <label class="field" for="pasteName">Nama dokumen</label>
    <input type="text" id="pasteName" value="faq-komunitas.md" spellcheck="false">
  </div>
  <div>
    <label class="field" for="pasteBody">Isi dokumen</label>
    <textarea id="pasteBody" class="mono" placeholder="Tempel FAQ, aturan server, atau catatan di sini…"></textarea>
  </div>
  <button class="btn-ghost" type="button" id="pasteBtn" onclick="uploadText()">${icon('check', 15)} Simpan sebagai dokumen</button>
</div>`,
  });

  const searchCard = card({
    title: 'Uji pencarian',
    hint: 'persis potongan yang dikirim ke prompt AI',
    body: `<div class="card-pad" style="padding-top:6px">
  <div class="field-row">
    <input type="search" id="q" placeholder="mis. jam operasional server" style="flex:1;min-width:200px"
      onkeydown="if(event.key==='Enter')runSearch()">
    <button class="btn-primary" type="button" onclick="runSearch()">${icon('search', 16)} Cari</button>
  </div>
  <div id="hits" style="margin-top:14px">
    <div class="list-meta">Hasil muncul di sini — inilah teks yang diselipkan ke prompt AI.</div>
  </div>
</div>`,
  });

  const listCard = card({
    title: 'Dokumen tersimpan',
    hint: `${options.documents.length} dokumen`,
    body: rows
      ? `<div class="table-wrap"><table class="table-stack">
  <thead><tr><th>Nama</th><th>Indeks</th><th>Ditambahkan</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`
      : emptyState({
          icon: 'book',
          title: 'Pengetahuan AI masih kosong',
          text: 'Mulai dari FAQ komunitas atau aturan server. AI akan mengutip dokumen ini saat menjawab.',
        }),
  });

  const body = `${pageHead({
    kicker: '03 — Basis pengetahuan',
    title: 'Dokumen RAG',
    subtitle: 'Rujukan jawaban AI. Nama yang sama akan menggantikan versi lama.',
    actions: options.embedModel
      ? badge(`Embedding: ${options.embedModel}`, 'ok')
      : badge('Pencarian leksikal (BM25)', 'brand'),
  })}
<div class="grid cols-2-even">${uploadCard}${pasteCard}</div>
<div class="mt">${searchCard}</div>
<div class="mt">${listCard}</div>
<script>
const GUILD = ${JSON.stringify(options.guildId)};

var dropInput = document.getElementById('file');
if (dropInput) dropInput.addEventListener('change', function () {
  var f = this.files && this.files[0];
  document.getElementById('fileName').textContent = f ? f.name : 'Pilih file dari perangkat';
  document.getElementById('fileMeta').textContent = f
    ? Math.max(1, Math.round(f.size / 1024)) + ' KB · siap diunggah'
    : 'TXT · MD · CSV · JSON · PDF · DOCX — maks 8 MB';
});

async function postDocument(name, text) {
  return api('/api/dokumen', {
    method: 'POST',
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-filename': encodeURIComponent(name), 'x-guild': GUILD },
    body: text,
  });
}

async function uploadFile() {
  var input = document.getElementById('file');
  var button = document.getElementById('uploadBtn');
  var state = document.getElementById('uploadState');
  if (!input.files || !input.files.length) return toast('Pilih file dulu ya', true);

  var file = input.files[0];
  if (file.size > 8 * 1024 * 1024) return toast('File lebih dari 8 MB', true);

  button.disabled = true;
  state.textContent = 'Mengunggah ' + file.name + '…';
  try {
    var text = await file.text();
    var data = await postDocument(file.name, text);
    toast('✅ ' + data.name + ' tersimpan — ' + data.chunkCount + ' potongan');
    setTimeout(function () { location.reload(); }, 600);
  } catch (error) {
    toast('Gagal: ' + error.message, true);
    state.textContent = '';
  } finally {
    button.disabled = false;
  }
}

async function uploadText() {
  var name = document.getElementById('pasteName').value.trim() || 'catatan-baru.md';
  var body = document.getElementById('pasteBody').value;
  var button = document.getElementById('pasteBtn');
  if (body.trim().length < 20) return toast('Isi dokumen masih kosong / terlalu pendek', true);

  button.disabled = true;
  try {
    var data = await postDocument(name, body);
    toast('✅ ' + data.name + ' tersimpan — ' + data.chunkCount + ' potongan');
    setTimeout(function () { location.reload(); }, 600);
  } catch (error) {
    toast('Gagal: ' + error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function removeDoc(id, name) {
  var ok = await askConfirm('Hapus dokumen?', name + ' akan dihapus dari pengetahuan AI. Tindakan ini tidak bisa dibatalkan.');
  if (!ok) return;
  try {
    await api('/api/dokumen/' + id + '?guild=' + encodeURIComponent(GUILD), { method: 'DELETE' });
    toast('Dokumen dihapus');
    setTimeout(function () { location.reload(); }, 400);
  } catch (error) {
    toast('Gagal menghapus: ' + error.message, true);
  }
}

async function runSearch() {
  var query = document.getElementById('q').value.trim();
  var hits = document.getElementById('hits');
  if (!query) return;

  hits.innerHTML = '<div style="display:grid;gap:10px"><div class="sk" style="width:60%"></div><div class="sk"></div><div class="sk" style="width:80%"></div></div>';
  try {
    var data = await api('/api/search?q=' + encodeURIComponent(query) + '&guild=' + encodeURIComponent(GUILD));
    if (!data.results || !data.results.length) {
      hits.innerHTML = '<div class="list-meta">Tidak ada potongan yang cocok dengan kata kunci itu.</div>';
      return;
    }
    var esc = function (text) {
      return String(text == null ? '' : text).replace(/[<>&"]/g, function (c) {
        return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
      });
    };
    // Isi dokumen berasal dari unggahan user: WAJIB di-escape sebelum masuk
    // innerHTML. Nilai yang mungkin tidak ada juga diberi nilai cadangan —
    // dulu hit.score.toFixed(2) membuat seluruh daftar hasil hilang kalau
    // server tidak mengirim skor.
    hits.innerHTML = data.results.map(function (hit) {
      var score = typeof hit.score === 'number' ? hit.score.toFixed(2) : '—';
      return '<div class="list-row" style="padding:12px 0">' +
        '<div class="list-body"><div class="list-title">' + esc(hit.documentName) +
        ' <span class="badge brand">' + esc(hit.via) + '</span>' +
        ' <span class="list-meta">bagian ' + (Number(hit.ordinal) + 1) + ' · skor ' + score + '</span></div>' +
        '<div class="list-text">' + esc(hit.preview) + '</div></div></div>';
    }).join('');
  } catch (error) {
    hits.innerHTML = '<div class="list-meta">Gagal mencari: ' + error.message + '</div>';
  }
}
</script>`;

  return appShell({
    title: 'Dokumen',
    guildId: options.guildId,
    guildName: options.guildName,
    active: 'dokumen',
    body,
    counts: options.counts,
    status: options.status,
  });
}

/* ------------------------------------------------------------------ */
/*  Keyword                                                            */
/* ------------------------------------------------------------------ */

export interface KeywordRowView {
  id: number;
  trigger: string;
  answer: string;
  createdAt: number;
}

export function keywordPage(options: PageContext & { keywords: KeywordRowView[] }): string {
  const rows = options.keywords.length
    ? options.keywords
        .map(
          (keyword) => `<div class="list-row">
  <span class="avatar-sm">${icon('tag', 15)}</span>
  <div class="list-body">
    <div class="list-title">${esc(keyword.trigger)}</div>
    <div class="list-text">${esc(keyword.answer)}</div>
    <div class="list-meta">dibuat ${esc(relativeTime(keyword.createdAt))}</div>
  </div>
  <button class="btn-danger btn-sm btn-icon" type="button"
    onclick="removeKeyword(${keyword.id}, ${esc(JSON.stringify(keyword.trigger))})"
    title="Hapus keyword" aria-label="Hapus keyword">${icon('trash', 15)}</button>
</div>`,
        )
        .join('')
    : '';

  const formCard = card({
    title: 'Tambah keyword',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:12px">
  <div>
    <label class="field" for="kwTrigger">Kata kunci / pertanyaan</label>
    <input type="text" id="kwTrigger" placeholder="mis. jam buka server" spellcheck="false">
    <p class="hint">Ditulis tanpa kapital & tanda baca — dicocokkan otomatis ke pesan member.</p>
  </div>
  <div>
    <label class="field" for="kwAnswer">Jawaban template</label>
    <textarea id="kwAnswer" placeholder="Server aktif setiap hari 08.00–22.00 WIB. Untuk event, cek channel #pengumuman."></textarea>
    <p class="hint">AI memakai isi ini sebagai sumber, lalu memvariasikan bahasanya agar tidak monoton.</p>
  </div>
  <button class="btn-primary" type="button" id="kwBtn" onclick="addKeyword()">${icon('plus', 16)} Simpan keyword</button>
</div>`,
  });

  const listCard = card({
    title: 'Keyword tersimpan',
    hint: `${options.keywords.length} buah`,
    body: rows
      ? `<div class="list">${rows}</div>`
      : emptyState({
          icon: 'tag',
          title: 'Belum ada keyword',
          text: 'Keyword membuat AI menjawab konsisten untuk pertanyaan yang sering muncul — FAQ, harga, jam buka, aturan.',
        }),
  });

  const body = `${pageHead({
    kicker: '04 — Template jawaban',
    title: 'Keyword',
    subtitle: 'Template jawaban owner. AI memvariasikan kalimatnya, isinya tetap sama.',
    actions: badge(`${options.keywords.length} aktif`, 'brand'),
  })}
<div class="grid cols-2">${formCard}${listCard}</div>
<script>
const GUILD = ${JSON.stringify(options.guildId)};

async function addKeyword() {
  var trigger = document.getElementById('kwTrigger').value.trim();
  var answer = document.getElementById('kwAnswer').value.trim();
  var button = document.getElementById('kwBtn');
  if (trigger.length < 3) return toast('Kata kunci minimal 3 karakter', true);
  if (answer.length < 5) return toast('Jawaban masih kosong', true);

  button.disabled = true;
  try {
    await api('/api/keyword', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guild: GUILD, trigger: trigger, answer: answer }),
    });
    toast('✅ Keyword tersimpan');
    setTimeout(function () { location.reload(); }, 400);
  } catch (error) {
    toast('Gagal: ' + error.message, true);
    button.disabled = false;
  }
}

async function removeKeyword(id, trigger) {
  var ok = await askConfirm('Hapus keyword?', '"' + trigger + '" akan dihapus. AI kembali menjawab bebas untuk pertanyaan ini.');
  if (!ok) return;
  try {
    await api('/api/keyword/' + id + '?guild=' + encodeURIComponent(GUILD), { method: 'DELETE' });
    toast('Keyword dihapus');
    setTimeout(function () { location.reload(); }, 400);
  } catch (error) {
    toast('Gagal menghapus: ' + error.message, true);
  }
}
</script>`;

  return appShell({
    title: 'Keyword',
    guildId: options.guildId,
    guildName: options.guildName,
    active: 'keyword',
    body,
    counts: options.counts,
    status: options.status,
  });
}

/* ------------------------------------------------------------------ */
/*  Pengaturan                                                         */
/* ------------------------------------------------------------------ */

export function pengaturanPage(
  options: PageContext & {
    // Persona TIDAK lagi di sini — pindah ke halaman AI Agent (`agentPage`),
    // karena di Pengaturan orang mengira itu pengaturan akun.
    model: string | null;
    defaultModel: string;
    embedModel: string | null;
    ragEnabled: boolean;
    /** Null = pakai default .env; boolean = sudah di-set per server. */
    ttsReplyInRoom: boolean | null;
    /** Default dari .env (TTS_REPLY_IN_ROOM). */
    ttsReplyInRoomDefault: boolean;
    ragEnabledSetting: boolean | null;
    ragEnabledDefault: boolean;
    autoMemorySetting: boolean | null;
    autoMemoryDefault: boolean;
    adminOnlyRoomsSetting: boolean | null;
    adminOnlyRoomsDefault: boolean;
    stats: { messages: number; rooms: number; documents: number };
  },
): string {
  const modelCard = card({
    title: 'Model AI',
    hint: `bawaan: ${options.defaultModel}`,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:12px">
  <div>
    <label class="field" for="model">Nama model (OpenAI-compatible)</label>
    <input type="text" id="model" class="mono" placeholder="${esc(options.defaultModel)}" value="${esc(options.model ?? '')}" spellcheck="false">
    <p class="hint">Contoh Groq: <code>openai/gpt-oss-120b</code> · <code>llama-3.3-70b-versatile</code></p>
  </div>
  <button class="btn-primary" type="button" id="saveModel" onclick="saveSettings({ model: document.getElementById('model').value })">
    ${icon('check', 16)} Simpan model
  </button>
</div>`,
  });

  const voiceCard = card({
    title: 'Suara balasan AI',
    hint: options.ttsReplyInRoom === null ? `default .env: ${options.ttsReplyInRoomDefault ? 'aktif' : 'nonaktif'}` : 'diset per server',
    body: `<div class=\"card-pad\" style=\"padding-top:6px;display:grid;gap:12px\">
  <div class=\"toggle-row\">
    <div>
      <div class=\"cell-title\">Suara pada balasan AI</div>
      <div class=\"cell-sub\">Jawaban AI di DM otomatis dibacakan (TTS)</div>
    </div>
    <label class=\"switch\">
      <input type=\"checkbox\" id=\"ttsReplyInRoom\"${(options.ttsReplyInRoom ?? options.ttsReplyInRoomDefault) ? ' checked' : ''}>
      <span class=\"slider\"></span>
    </label>
  </div>
  <p class=\"hint\">Nonaktifkan jika server ingin jawaban tetap teks saja. Bila belum di-set (default), memakai TTS_REPLY_IN_ROOM dari .env.</p>
  <button class=\"btn-primary\" type=\"button\" onclick=\"saveSettings({ ttsReplyInRoom: document.getElementById('ttsReplyInRoom').checked })\"
    ${icon('check', 16)} Simpan toggle suara
  </button>
</div>`,
  });

  const featureCard = card({
    title: 'Fitur AI',
    hint: 'Atur fitur AI per server — tidak perlu edit .env',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:10px">
  <div class="toggle-row">
    <div>
      <div class="cell-title">Dokumen RAG</div>
      <div class="cell-sub">AI boleh jawab dari dokumen yang di-upload</div>
    </div>
    <label class="switch">
      <input type="checkbox" id="ragEnabled"${(options.ragEnabledSetting ?? options.ragEnabledDefault) ? ' checked' : ''}>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div>
      <div class="cell-title">Auto Memory</div>
      <div class="cell-sub">AI boleh ingat fakta otomatis dari percakapan</div>
    </div>
    <label class="switch">
      <input type="checkbox" id="autoMemory"${(options.autoMemorySetting ?? options.autoMemoryDefault) ? ' checked' : ''}>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="toggle-text">
      <div class="cell-title">Tombol chat DM khusus admin</div>
      <div class="cell-sub">Hanya admin (izin Manage Server) yang boleh menekan tombol &quot;Chat via DM&quot; di panel. AI Agent di channel tidak terpengaruh.</div>
    </div>
    <label class="switch">
      <input type="checkbox" id="adminOnlyRooms"${(options.adminOnlyRoomsSetting ?? options.adminOnlyRoomsDefault) ? ' checked' : ''}>
      <span class="slider"></span>
    </label>
  </div>
  <button class="btn-primary" type="button" onclick="saveFeatureToggles()">
    ${icon('check', 16)} Simpan toggle fitur
  </button>
</div>`,
  });

  const infoCard = card({
    title: 'Info server',
    body: `<div class="list">
  <div class="kv"><span>Server ID</span><b class="mono">${esc(options.guildId || '—')}</b></div>
  <div class="kv"><span>Mode</span><b>${options.status.mode === 'bot' ? 'Bot + dashboard' : 'Dashboard saja'}</b></div>
  <div class="kv"><span>Dokumen RAG</span>${options.ragEnabled ? badge('Aktif', 'ok') : badge('Nonaktif', 'warn')}</div>
  <div class="kv"><span>Embedding</span><b class="mono">${esc(options.embedModel ?? 'tidak dipakai')}</b></div>
  <div class="kv"><span>Sesi DM</span><b>${formatNumber(options.stats.rooms)}</b></div>
  <div class="kv"><span>Pesan tersimpan</span><b>${formatNumber(options.stats.messages)}</b></div>
</div>
<div class="card-pad">
  <button class="btn-ghost btn-sm" type="button" data-copy="${esc(options.guildId)}" data-copy-label="Server ID">
    ${icon('copy', 14)} Salin Server ID
  </button>
</div>`,
  });

  const body = `${pageHead({
    kicker: '07 — Konfigurasi',
    title: 'Pengaturan',
    subtitle: 'Perilaku AI dan informasi server. Perubahan langsung berlaku untuk pesan berikutnya.',
  })}
<div class="grid cols-2-even">${modelCard}</div>
<div class="mt">${voiceCard}</div>
<div class="mt">${featureCard}</div>
<div class="mt">${infoCard}</div>
<script>
async function saveSettings(payload) {
  payload.guild = ${JSON.stringify(options.guildId)};
  try {
    await api('/api/pengaturan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('✅ Pengaturan disimpan');
  } catch (error) {
    toast('Gagal menyimpan: ' + error.message, true);
  }
}

async function saveFeatureToggles() {
  const payload = {
    guild: ${JSON.stringify(options.guildId)},
    ragEnabled: document.getElementById('ragEnabled').checked,
    autoMemory: document.getElementById('autoMemory').checked,
    adminOnlyRooms: document.getElementById('adminOnlyRooms').checked,
  };
  try {
    await api('/api/pengaturan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('✅ Toggle fitur disimpan');
  } catch (error) {
    toast('Gagal menyimpan: ' + error.message, true);
  }
}
</script>`;

  return appShell({
    title: 'Pengaturan',
    guildId: options.guildId,
    guildName: options.guildName,
    active: 'pengaturan',
    body,
    counts: options.counts,
    status: options.status,
  });
}

export { SHARED_JS };

/* ------------------------------------------------------------------ */
/*  Sambutan & perpisahan                                              */
/* ------------------------------------------------------------------ */

export interface WelcomePageOptions extends PageContext {
  welcome: {
    enabled: boolean;
    useAi: boolean;
    channelId: string | null;
    template: string | null;
    /** Bentuk pesan: `card`, `embed`, atau `text`. */
    displayMode: string;
    imageEnabled: boolean;
    includeAvatar: boolean;
    style: string | null;
    example: string | null;
    /** Nama file banner (null = latar bawaan). */
    bannerPath: string | null;
    /** Banner tersimpan sebagai data URI, untuk langsung ditampilkan. */
    hasBanner: boolean;
  };
  goodbye: {
    enabled: boolean;
    useAi: boolean;
    channelId: string | null;
    template: string | null;
    displayMode: string;
    style: string | null;
    example: string | null;
    bannerPath: string | null;
    hasBanner: boolean;
    imageEnabled: boolean;
    includeAvatar: boolean;
  };
  channels: Array<{ id: string; name: string }>;
  botOnline: boolean;
  /** Nama awal di kolom "Nama contoh" pada panel pratinjau. */
  sampleName: string;
  /** Status Chromium — kartu PNG butuh ini; null artinya tidak tersedia. */
  cardRenderer: { available: boolean; path: string | null };
}

/** Opsi channel: nilai kosong dipakai untuk "mati" atau "DM". */
function channelOptions(
  channels: Array<{ id: string; name: string }>,
  selected: string | null,
  emptyLabel: string,
): string {
  const options = [`<option value=""${selected ? '' : ' selected'}>${esc(emptyLabel)}</option>`];
  for (const channel of channels) {
    options.push(
      `<option value="${esc(channel.id)}"${channel.id === selected ? ' selected' : ''}>#${esc(channel.name)}</option>`,
    );
  }
  // Channel yang tersimpan tapi tidak ada di cache (bot offline) tetap tampil.
  if (selected && !channels.some((channel) => channel.id === selected)) {
    options.push(`<option value="${esc(selected)}" selected>#${esc(selected)}</option>`);
  }
  return options.join('');
}

const CHECK_ROW = 'style="display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--text-2)"';

/**
 * Blok unggah banner.
 *
 * Banner dipakai sebagai latar kartu PNG; kalau kartu dimatikan, banner tetap
 * dipakai sebagai gambar embed. Karena itu blok ini muncul di kedua kartu
 * (sambutan & perpisahan) dengan nama field yang berbeda.
 *
 * File dibaca di browser lalu dikirim sebagai data URI: tidak perlu parser
 * multipart di server, dan pratinjaunya bisa langsung tampil tanpa menunggu.
 */
/**
 * Pemilih bentuk pesan (mode tampilan).
 *
 * Memakai radio, bukan dropdown: tiga pilihan ini mengubah tampilan yang
 * dilihat member, jadi semuanya sebaiknya terlihat sekaligus beserta
 * konsekuensinya (kartu butuh Chromium, teks bisa me-ping). Disembunyikan di
 * balik dropdown membuat admin tidak tahu mode mana yang sedang aktif.
 */
function displayModePicker(kind: 'welcome' | 'goodbye', current: string): string {
  const active = normalizeDisplayMode(current);
  const cards = DISPLAY_MODES.map((mode) => {
    const checked = mode.key === active ? ' checked' : '';
    return `<label class="mode-option">
      <input type="radio" name="${kind}Mode" value="${mode.key}"${checked}>
      <span class="mode-body">
        <span class="mode-label">${esc(mode.label)}${mode.canMention ? ' <span class="mode-tag">bisa ping</span>' : ''}</span>
        <span class="mode-note">${esc(mode.note)}</span>
      </span>
    </label>`;
  }).join('');

  return `<div>
    <label class="field">Bentuk pesan</label>
    <div class="mode-picker" id="${kind}ModePicker">${cards}</div>
  </div>`;
}

function bannerBlock(
  kind: 'welcome' | 'goodbye',
  currentPath: string | null,
  /** true = ada file banner. Boolean, bukan string: penanda "ada" tidak boleh
   *  bergantung pada truthiness string kosong. */
  hasBanner: boolean,
): string {
  const label = kind === 'welcome' ? 'sambutan' : 'perpisahan';
  // Gambar diambil lewat URL, BUKAN data URI di dalam HTML. Banner boleh sampai
  // 8 MB dan ada dua (sambutan & perpisahan) — menyisipkannya sebagai data URI
  // membuat satu kunjungan halaman menarik belasan MB dan berat di HP.
  // Versi path dipakai sebagai query supaya banner baru tidak memakai cache lama.

  return `<div>
    <label class="field">Banner ${label} <span class="hint" style="margin:0;text-transform:none;letter-spacing:0">(opsional)</span></label>
    <div class="banner-row">
      <div class="banner-preview" id="bannerBox-${kind}">
        <img id="bannerImg-${kind}" alt="Banner ${label}"${hasBanner ? ` src="/api/banner/${kind}?v=${esc(currentPath ?? '')}"` : ' hidden'}>
        <span id="bannerEmpty-${kind}"${hasBanner ? ' hidden' : ''}>Belum ada banner — kartu memakai latar bawaan.</span>
      </div>
      <div class="banner-actions">
        <input type="file" id="bannerFile-${kind}" accept="image/png,image/jpeg,image/webp" hidden
               onchange="uploadBanner('${kind}', this)">
        <button class="btn-ghost" type="button" onclick="document.getElementById('bannerFile-${kind}').click()">
          Pilih gambar
        </button>
        <button class="btn-ghost" type="button" id="bannerClear-${kind}" onclick="removeBanner('${kind}')"${currentPath ? '' : ' hidden'}>
          Hapus
        </button>
      </div>
    </div>
    <p class="hint">PNG, JPG, atau WebP — maksimal 8 MB, minimal 300px lebar. Disarankan 900×320 agar pas di kartu.</p>
  </div>`;
}

export function welcomePage(options: WelcomePageOptions): string {
  const welcomeStatus = options.welcome.enabled ? badge('Aktif', 'ok') : badge('Nonaktif', 'warn');
  const goodbyeStatus = options.goodbye.enabled ? badge('Aktif', 'ok') : badge('Nonaktif', 'warn');

  // Peringatan hanya relevan kalau mode yang dipilih memang butuh kartu.
  const cardModeActive =
    normalizeDisplayMode(options.welcome.displayMode) === 'card' ||
    normalizeDisplayMode(options.goodbye.displayMode) === 'card';
  const rendererWarning = cardModeActive && !options.cardRenderer.available
    ? `<div class="notice" style="margin-top:12px">${icon('alert', 16)}<span><b>Kartu PNG tidak akan terkirim.</b> Chromium tidak ditemukan di server ini, jadi sambutan & perpisahan jatuh ke embed teks. Set <code>CHROMIUM_PATH</code> ke binary Chromium di hosting-mu untuk mengaktifkan kartu.</span></div>`
    : '';

  const welcomeCard = card({
    title: 'Sambutan member baru',
    hint: 'satu pesan per member baru',
    right: welcomeStatus,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="welcomeEnabled" ${options.welcome.enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Sapa setiap member yang baru bergabung</span>
  </label>

  <div>
    <label class="field" for="welcomeChannel">Kirim ke</label>
    <span class="select-shell" style="width:100%">
      <select id="welcomeChannel" style="width:100%">
        ${channelOptions(options.channels, options.welcome.channelId, 'DM member (disarankan)')}
      </select>
      ${icon('chevron', 15)}
    </span>
    <p class="hint">DM lebih sopan dan tidak membanjiri channel. Pilih channel kalau ingin disambut ramai-ramai.</p>
  </div>

  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="welcomeUseAi" ${options.welcome.useAi ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Tulis sapaan dengan AI — kalimatnya beda tiap orang</span>
  </label>

  <div>
    <label class="field" for="welcomeTemplate">Template (dipakai kalau AI mati / gagal)</label>
    <textarea id="welcomeTemplate" rows="3" placeholder="Halo {user}, selamat datang di **{server}**!">${esc(
      options.welcome.template ?? '',
    )}</textarea>
    <p class="hint"><code>{user}</code> nama panggilan, <code>{server}</code> nama server, <code>{user.mention}</code> tag member, <code>{user.tag}</code> username, <code>{memberCount}</code> jumlah member.</p>
  </div>

  <div class="grid cols-2-even" style="gap:14px">
    <div>
      <label class="field" for="welcomeStyle">Gaya sapaan</label>
      <input type="text" id="welcomeStyle" value="${esc(options.welcome.style ?? '')}" placeholder="hangat, santai, sedikit bercanda">
    </div>
    <div>
      <label class="field" for="welcomeExample">Contoh nada</label>
      <input type="text" id="welcomeExample" value="${esc(options.welcome.example ?? '')}" placeholder="Pagi Sky! Ngapain aja hari ini?">
    </div>
  </div>

  ${displayModePicker('welcome', options.welcome.displayMode)}
  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="welcomeAvatar" ${options.welcome.includeAvatar ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Tampilkan avatar member di kartu</span>
  </label>

  ${bannerBlock('welcome', options.welcome.bannerPath, options.welcome.hasBanner)}
  ${rendererWarning}

  <div><button class="btn-primary" type="button" onclick="saveWelcome()">${icon('check', 16)} Simpan sambutan</button></div>
</div>`,
  });

  const goodbyeCard = card({
    title: 'Salam perpisahan',
    hint: 'saat member keluar',
    right: goodbyeStatus,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="goodbyeEnabled" ${options.goodbye.enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Kirim salam saat ada member keluar</span>
  </label>

  <div class="notice">${icon('alert', 16)}<span>Member yang keluar tidak bisa dikirimi DM. Pilih channel — kalau kosong, salam tidak dikirim (lebih baik diam daripada menulis ke channel acak).</span></div>

  <div>
    <label class="field" for="goodbyeChannel">Kirim ke</label>
    <span class="select-shell" style="width:100%">
      <select id="goodbyeChannel" style="width:100%">
        ${channelOptions(options.channels, options.goodbye.channelId, 'Belum dipilih — salam tidak dikirim')}
      </select>
      ${icon('chevron', 15)}
    </span>
  </div>

  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="goodbyeUseAi" ${options.goodbye.useAi ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Tulis salam dengan AI</span>
  </label>

  <div>
    <label class="field" for="goodbyeTemplate">Template (dipakai kalau AI mati / gagal)</label>
    <textarea id="goodbyeTemplate" rows="2" placeholder="{user} sudah keluar dari **{server}**. Semoga lancar!">${esc(
      options.goodbye.template ?? '',
    )}</textarea>
    <p class="hint">Token sama seperti sambutan: <code>{user}</code>, <code>{server}</code>, <code>{user.mention}</code>, <code>{memberCount}</code>.</p>
  </div>

  <div class="grid cols-2-even" style="gap:14px">
    <div>
      <label class="field" for="goodbyeStyle">Gaya salam</label>
      <input type="text" id="goodbyeStyle" value="${esc(options.goodbye.style ?? '')}" placeholder="sopan, hangat, singkat">
    </div>
    <div>
      <label class="field" for="goodbyeExample">Contoh nada</label>
      <input type="text" id="goodbyeExample" value="${esc(options.goodbye.example ?? '')}" placeholder="Semoga urusannya lancar ya.">
    </div>
  </div>

  ${displayModePicker('goodbye', options.goodbye.displayMode)}
  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="goodbyeAvatar" ${options.goodbye.includeAvatar ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Tampilkan avatar member di kartu</span>
  </label>

  ${bannerBlock('goodbye', options.goodbye.bannerPath, options.goodbye.hasBanner)}

  <div><button class="btn-primary" type="button" onclick="saveGoodbye()">${icon('check', 16)} Simpan salam</button></div>
</div>`,
  });

  const previewCard = card({
    title: 'Pratinjau & tes',
    hint: 'tanpa mengirim apa pun ke Discord',
    right: `<span id="previewState" class="hint" style="margin:0">Siap diuji</span>`,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <div>
    <label class="field" for="previewName">Nama contoh</label>
    <input type="text" id="previewName" value="${esc(options.sampleName)}" placeholder="Sky" maxlength="60">
    <p class="hint">Dipakai sebagai nama member di sapaan. Coba beberapa nama untuk melihat kalimatnya berubah.</p>
  </div>

  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <button class="btn-primary" type="button" id="testWelcome" onclick="runTest('welcome')">${icon('message', 16)} Tes sambutan</button>
    <button class="btn-ghost" type="button" onclick="runTest('welcome', true)">Tes tanpa AI</button>
  </div>
  <div class="preview-box" id="outWelcome" hidden>
    <div class="preview-meta" id="metaWelcome"></div>
    <div class="preview-text" id="textWelcome"></div>
    <img id="cardWelcome" class="preview-img" alt="Kartu sambutan" hidden>
  </div>

  <div class="send-row">
    <select id="sendWhere" class="send-select" ${options.botOnline ? '' : 'disabled'}>
      <option value="dm">Kirim ke DM saya</option>
      <option value="channel">Kirim ke channel sambutan</option>
    </select>
    <button class="btn-ghost" type="button" id="sendWelcome" onclick="sendTest('welcome')" ${options.botOnline ? '' : 'disabled'}>
      ${icon('external', 15)} Kirim tes sungguhan
    </button>
  </div>
  <p class="hint" style="margin:0">Tombol ini <b>benar-benar mengirim</b> satu pesan ke Discord, diberi penanda "pesan uji". Dipakai untuk membuktikan alurnya jalan — tidak perlu menunggu member baru.${options.botOnline ? '' : ' <b>Bot sedang offline</b>, jadi pengiriman dinonaktifkan.'}</p>

  <hr style="border:none;border-top:1px solid var(--line);margin:2px 0">

  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <button class="btn-primary" type="button" id="testGoodbye" onclick="runTest('goodbye')">${icon('logout', 16)} Tes salam perpisahan</button>
    <button class="btn-ghost" type="button" onclick="runTest('goodbye', true)">Tes tanpa AI</button>
  </div>
  <div class="preview-box" id="outGoodbye" hidden>
    <div class="preview-meta" id="metaGoodbye"></div>
    <div class="preview-text" id="textGoodbye"></div>
    <img id="cardGoodbye" class="preview-img" alt="Kartu perpisahan" hidden>
  </div>

  <div class="send-row">
    <button class="btn-ghost" type="button" id="sendGoodbye" onclick="sendTest('goodbye')" ${options.botOnline ? '' : 'disabled'}>
      ${icon('external', 15)} Kirim tes ke channel
    </button>
  </div>
  <p class="hint" style="margin:0">Salam perpisahan <b>selalu ke channel</b> — member yang keluar tidak bisa dikirimi DM. Channel harus dipilih &amp; disimpan dulu.</p>

  <p class="hint" style="margin:0">Yang diuji adalah <b>isi pesannya</b>, bukan pengirimannya. Tombol ini memakai form di atas apa adanya, jadi kamu bisa mencoba gaya lain sebelum menyimpan.</p>
</div>`,
  });

  const body = `${pageHead({
    kicker: '03 — Kehadiran',
    title: 'Sambutan & Perpisahan',
    subtitle: 'Sapa member yang baru datang, dan ucapkan salam saat mereka pamit. Dua-duanya mati secara default.',
  })}
<div class="grid cols-2-even mt">${welcomeCard}${goodbyeCard}</div>
<div class="mt">${previewCard}</div>

<script>
/** Nilai radio mode tampilan yang sedang dipilih. */
function modeOf(kind) {
  var picked = document.querySelector('input[name="' + kind + 'Mode"]:checked');
  return picked ? picked.value : 'embed';
}

async function saveWelcome() {
  await postJson('/api/welcome', {
    enabled: document.getElementById('welcomeEnabled').checked,
    channelId: document.getElementById('welcomeChannel').value || null,
    useAi: document.getElementById('welcomeUseAi').checked,
    template: document.getElementById('welcomeTemplate').value.trim() || null,
    style: document.getElementById('welcomeStyle').value.trim() || null,
    example: document.getElementById('welcomeExample').value.trim() || null,
    displayMode: modeOf('welcome'),
    imageEnabled: modeOf('welcome') === 'card',
    includeAvatar: document.getElementById('welcomeAvatar').checked,
  }, 'Sambutan disimpan.');
}

/**
 * Baca file di browser, kirim sebagai data URI, lalu tampilkan hasilnya.
 *
 * Validasi ukuran dilakukan di sini juga supaya file 50 MB tidak dikirim
 * percuma — server tetap memeriksa ulang isinya.
 */
function uploadBanner(kind, input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    toast('Gambar terlalu besar — maksimal 8 MB.', true);
    input.value = '';
    return;
  }

  var reader = new FileReader();
  reader.onload = async function () {
    try {
      var data = await api('/api/banner/' + kind, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUri: reader.result }),
      });
      showBanner(kind, data.preview || null);
      toast('✅ Banner ' + (kind === 'welcome' ? 'sambutan' : 'perpisahan') + ' tersimpan');
    } catch (error) {
      toast('Gagal mengunggah: ' + error.message, true);
    } finally {
      input.value = '';
    }
  };
  reader.onerror = function () {
    toast('Gagal membaca file.', true);
    input.value = '';
  };
  reader.readAsDataURL(file);
}

async function removeBanner(kind) {
  try {
    await api('/api/banner/' + kind, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remove: true }),
    });
    showBanner(kind, null);
    toast('Banner dihapus');
  } catch (error) {
    toast('Gagal menghapus: ' + error.message, true);
  }
}

function showBanner(kind, src) {
  var image = document.getElementById('bannerImg-' + kind);
  var empty = document.getElementById('bannerEmpty-' + kind);
  var clear = document.getElementById('bannerClear-' + kind);
  image.hidden = !src;
  empty.hidden = !!src;
  clear.hidden = !src;
  if (src) image.src = src;
  else image.removeAttribute('src');
}

/**
 * Kirim satu pesan sungguhan ke Discord memakai form apa adanya.
 *
 * Sengaja terpisah dari runTest(): pratinjau hanya menampilkan teks, sedangkan
 * tombol ini menembak API Discord. Pesan selalu diberi penanda "pesan uji".
 */
async function sendTest(kind) {
  var button = document.getElementById('send' + kind.charAt(0).toUpperCase() + kind.slice(1));
  var label = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Mengirim…';
  document.getElementById('previewState').textContent = 'Mengirim ke Discord…';

  var payload = kind === 'welcome'
    ? {
        target: document.getElementById('sendWhere').value,
        useAi: document.getElementById('welcomeUseAi').checked,
        template: document.getElementById('welcomeTemplate').value.trim(),
        style: document.getElementById('welcomeStyle').value.trim(),
        example: document.getElementById('welcomeExample').value.trim(),
        displayMode: modeOf('welcome'),
        imageEnabled: modeOf('welcome') === 'card',
        includeAvatar: document.getElementById('welcomeAvatar').checked,
      }
    : {
        useAi: document.getElementById('goodbyeUseAi').checked,
        template: document.getElementById('goodbyeTemplate').value.trim(),
        style: document.getElementById('goodbyeStyle').value.trim(),
        example: document.getElementById('goodbyeExample').value.trim(),
        displayMode: modeOf('goodbye'),
        imageEnabled: modeOf('goodbye') === 'card',
        includeAvatar: document.getElementById('goodbyeAvatar').checked,
      };

  try {
    var data = await api('/api/send-test/' + kind, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var where = data.where === 'dm' ? 'DM kamu' : ('#' + data.channelName);
    toast('✅ Terkirim ke ' + where + (data.card ? ' (dengan kartu)' : ''));
    document.getElementById('previewState').textContent = 'Terkirim';
    showSendResult(kind, data);
  } catch (error) {
    toast('Gagal mengirim: ' + error.message, true);
    document.getElementById('previewState').textContent = 'Gagal mengirim';
    showSendError(kind, error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

function showSendResult(kind, data) {
  var box = document.getElementById('out' + kind.charAt(0).toUpperCase() + kind.slice(1));
  box.hidden = false;
  var meta = document.getElementById('meta' + kind.charAt(0).toUpperCase() + kind.slice(1));
  meta.textContent = '📨 TERKIRIM KE ' + (data.where === 'dm' ? 'DM' : 'CHANNEL ' + (data.channelName || ''))
    + (data.card ? ' · DENGAN KARTU' : ' · EMBED TEKS')
    + (data.note ? ' — ' + data.note : '');
}

function showSendError(kind) {
  var box = document.getElementById('out' + kind.charAt(0).toUpperCase() + kind.slice(1));
  box.hidden = false;
  var meta = document.getElementById('meta' + kind.charAt(0).toUpperCase() + kind.slice(1));
  meta.textContent = '⚠️ GAGAL MENGIRIM — ' + arguments[1];
}

async function saveGoodbye() {
  await postJson('/api/goodbye', {
    enabled: document.getElementById('goodbyeEnabled').checked,
    channelId: document.getElementById('goodbyeChannel').value || null,
    useAi: document.getElementById('goodbyeUseAi').checked,
    template: document.getElementById('goodbyeTemplate').value.trim() || null,
    style: document.getElementById('goodbyeStyle').value.trim() || null,
    example: document.getElementById('goodbyeExample').value.trim() || null,
    displayMode: modeOf('goodbye'),
    imageEnabled: modeOf('goodbye') === 'card',
    includeAvatar: document.getElementById('goodbyeAvatar').checked,
  }, 'Salam perpisahan disimpan.');
}

/**
 * Ambil nilai form apa adanya (belum tentu tersimpan) lalu minta server
 * merendernya. Hasilnya hanya ditampilkan — tidak ada pesan yang dikirim.
 */
async function runTest(kind, templateOnly) {
  var button = document.getElementById(kind === 'welcome' ? 'testWelcome' : 'testGoodbye');
  var state = document.getElementById('previewState');
  var label = button.textContent;
  button.disabled = true;
  button.textContent = 'Menguji…';
  state.textContent = 'Menghubungi model…';

  var name = document.getElementById('previewName').value.trim();
  var payload = kind === 'welcome'
    ? {
        name: name,
        useAi: document.getElementById('welcomeUseAi').checked,
        template: document.getElementById('welcomeTemplate').value.trim(),
        style: document.getElementById('welcomeStyle').value.trim(),
        example: document.getElementById('welcomeExample').value.trim(),
        withCard: modeOf('welcome') === 'card',
        templateOnly: !!templateOnly,
      }
    : {
        name: name,
        useAi: document.getElementById('goodbyeUseAi').checked,
        template: document.getElementById('goodbyeTemplate').value.trim(),
        style: document.getElementById('goodbyeStyle').value.trim(),
        example: document.getElementById('goodbyeExample').value.trim(),
        withCard: modeOf('goodbye') === 'card',
        templateOnly: !!templateOnly,
      };

  try {
    var data = await api('/api/preview/' + kind, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    var box = document.getElementById('out' + kind.charAt(0).toUpperCase() + kind.slice(1));
    box.hidden = false;
    document.getElementById('text' + kind.charAt(0).toUpperCase() + kind.slice(1)).textContent = data.text || '(kosong)';
    document.getElementById('meta' + kind.charAt(0).toUpperCase() + kind.slice(1)).textContent =
      (data.source === 'ai' ? '✍️ ditulis AI' : data.source === 'template' ? '📄 dari template' : '⚠️ gagal')
      + (data.card ? ' · kartu ' + Math.round((data.cardBytes || 0) / 1024) + ' KB' : '')
      + (data.note ? ' — ' + data.note : '');

    // Kartu dikirim sebagai data URI di respons yang sama — tidak perlu
    // endpoint gambar tambahan dan tidak ada yang disimpan ke disk.
    var image = document.getElementById(kind === 'welcome' ? 'cardWelcome' : 'cardGoodbye');
    image.hidden = !data.cardDataUri;
    if (data.cardDataUri) image.src = data.cardDataUri;
    state.textContent = 'Selesai';
    toast('✅ Pratinjau siap — belum ada yang dikirim');
  } catch (error) {
    state.textContent = 'Gagal';
    toast('Gagal menguji: ' + error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
</script>`;

  return appShell({
    title: 'Sambutan & Perpisahan',
    guildId: options.guildId,
    guildName: options.guildName ?? null,
    active: 'sambutan',
    body,
    counts: options.counts,
    status: options.status,
  });
}

/* ------------------------------------------------------------------ */
/*  AI Agent                                                           */
/* ------------------------------------------------------------------ */

export interface AgentPageOptions extends PageContext {
  /**
   * Persona = gaya bicara bot. Dipindah ke sini dari halaman Pengaturan:
   * di sana orang mengira itu pengaturan akun, padahal ini yang menentukan
   * nada bicara agent di obrolan.
   */
  persona: string | null;
  agent: {
    channelId: string | null;
    galleryChannelId: string | null;
    quietMinutes: number;
    maxPerHour: number;
    reactEmoji: boolean;
    reactImages: boolean;
    busyMute: boolean;
    cooldownSeconds: number;
  };
  channels: Array<{ id: string; name: string }>;
  botOnline: boolean;
  /** Nama awal di kolom "Nama member contoh" pada panel tes. */
  sampleName: string;
}

export function agentPage(options: AgentPageOptions): string {
  const active = Boolean(options.agent.channelId || options.agent.galleryChannelId);
  const agentStatus = active ? badge('Aktif', 'ok') : badge('Nonaktif', 'warn');

  const personaCard = card({
    title: 'Persona AI',
    hint: 'gaya bicara bot di server ini',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:12px">
  <textarea id="persona" rows="4" placeholder="Contoh: Kamu asisten komunitas yang ramah, menjawab singkat, dan memakai bahasa Indonesia santai.">${esc(options.persona ?? '')}</textarea>
  <p class="hint">Menentukan nada bicara agent <b>dan</b> balasan chat/DM di server ini. Kosongkan untuk memakai persona bawaan. Maksimal 1500 karakter.</p>
  <div><button class="btn-primary" type="button" id="savePersona" onclick="savePersona()">${icon('check', 16)} Simpan persona</button></div>
</div>`,
  });

  const channelsCard = card({
    title: 'Channel AI',
    hint: 'dua channel, dua peran',
    right: agentStatus,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <div class="notice">${icon('alert', 16)}<span>AI membalas <b>di depan semua orang</b> di channel ini. Itu memang tujuannya — bikin obrolan lebih hidup. Percakapan pribadi tetap hanya di DM.</span></div>

  <div>
    <label class="field" for="agentChannel">Channel ngobrol</label>
    <span class="select-shell" style="width:100%">
      <select id="agentChannel" style="width:100%">
        ${channelOptions(options.channels, options.agent.channelId, 'Mati — AI tidak ikut ngobrol')}
      </select>
      ${icon('chevron', 15)}
    </span>
    <p class="hint">Bot nimbrung seperti anggota: balas mention/reply, tanggapi emoji, dan menyapa saat sepi.</p>
  </div>

  <div>
    <label class="field" for="agentGallery">Channel galeri</label>
    <span class="select-shell" style="width:100%">
      <select id="agentGallery" style="width:100%">
        ${channelOptions(options.channels, options.agent.galleryChannelId, 'Mati — AI tidak mengomentari foto')}
      </select>
      ${icon('chevron', 15)}
    </span>
    <p class="hint">Bot hanya menanggapi <b>gambar &amp; video</b> di channel ini — teks biasa diabaikan supaya tidak berisik.</p>
  </div>

  <div class="grid cols-2-even" style="gap:14px">
    <div>
      <label class="field" for="agentQuiet">Sapa saat sepi setelah (menit)</label>
      <input type="text" id="agentQuiet" class="mono" inputmode="numeric" value="${options.agent.quietMinutes}">
      <p class="hint">0 = jangan pernah menyapa duluan. Berlaku di channel ngobrol.</p>
    </div>
    <div>
      <label class="field" for="agentMax">Batas balasan per jam</label>
      <input type="text" id="agentMax" class="mono" inputmode="numeric" value="${options.agent.maxPerHour}">
      <p class="hint">Pengaman biaya API, gabungan kedua channel. 1–60.</p>
    </div>
  </div>

  <div>
    <label class="field" for="agentCooldown">Jeda minimum antar balasan (detik)</label>
    <input type="text" id="agentCooldown" class="mono" inputmode="numeric" value="${options.agent.cooldownSeconds}">
    <p class="hint">Supaya bot tidak mendominasi obrolan. 0 = tanpa jeda.</p>
  </div>

  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="agentBusy" ${options.agent.busyMute ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Diam saat obrolan sedang ramai (beberapa member aktif bersamaan)</span>
  </label>
  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="agentEmoji" ${options.agent.reactEmoji ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Tanggapi emoji &amp; sticker member</span>
  </label>
  <label class="check-row" ${CHECK_ROW}>
    <input type="checkbox" id="agentImages" ${options.agent.reactImages ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Komentari gambar &amp; video (butuh Vision aktif)</span>
  </label>

  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <button class="btn-primary" type="button" onclick="saveAgent()">${icon('check', 16)} Simpan agent</button>
    <span class="hint" style="margin:0">${options.botOnline ? 'Berlaku untuk pesan berikutnya.' : 'Bot sedang offline — pengaturan tetap tersimpan.'}</span>
  </div>
</div>`,
  });

  const testCard = card({
    title: 'Tes percakapan',
    hint: 'tanpa mengirim ke channel',
    right: `<span id="testState" class="hint" style="margin:0">Siap diuji</span>`,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <div>
    <label class="field" for="testName">Nama member contoh</label>
    <input type="text" id="testName" value="${esc(options.sampleName)}" maxlength="60" placeholder="Sky">
  </div>

  <div>
    <label class="field" for="testMessage">Pesan yang dikirim member</label>
    <textarea id="testMessage" rows="2" placeholder="selamat pagi semua">selamat pagi semua</textarea>
  </div>

  <div>
    <label class="field" for="testRole">Uji sebagai</label>
    <span class="select-shell" style="width:100%">
      <select id="testRole" style="width:100%">
        <option value="chat">Pesan di channel ngobrol</option>
        <option value="gallery">Komentar di channel galeri</option>
      </select>
      ${icon('chevron', 15)}
    </span>
  </div>

  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <button class="btn-primary" type="button" id="testChat" onclick="runAgentTest()">${icon('message', 16)} Tes balasan</button>
    <button class="btn-ghost" type="button" id="testQuiet" onclick="runQuietTest()">${icon('sparkles', 16)} Tes pemecah sepi</button>
  </div>

  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <button class="btn-ghost" type="button" id="sendAgent" onclick="sendAgentTest()" ${options.botOnline ? '' : 'disabled'}>
      ${icon('external', 15)} Kirim tes ke channel
    </button>
    <span class="hint" style="margin:0">Mengirim <b>satu</b> pesan nyata berisi balasan bot — diberi penanda "pesan uji".${options.botOnline ? '' : ' <b>Bot offline</b>.'}</span>
  </div>

  <div class="preview-box" id="outAgent" hidden>
    <div class="preview-meta" id="metaAgent"></div>
    <div class="preview-text" id="textAgent"></div>
  </div>
</div>`,
  });

  const behaviourCard = card({
    title: 'Kapan bot membalas',
    body: `<div class="list">
  <div class="kv"><span>Di-mention atau dibalas</span><b>Selalu dijawab</b></div>
  <div class="kv"><span>Satu member ngobrol sendiri</span><b>Dibalas, dengan jeda</b></div>
  <div class="kv"><span>Beberapa member aktif bersamaan</span><b>Diam — tidak menyela</b></div>
  <div class="kv"><span>Channel ngobrol sepi</span><b>Menyapa sekali</b></div>
  <div class="kv"><span>Kiriman foto/video di galeri</span><b>Dikomentari</b></div>
  <div class="kv"><span>Teks biasa di galeri</span><b>Diabaikan</b></div>
  <div class="kv"><span>Pesan dari bot lain</span><b>Tidak pernah dibalas</b></div>
</div>
<div class="card-pad"><p class="hint" style="margin:0">Riwayat obrolan channel <b>tidak disimpan ke database</b> — hanya di memori bot, dan hilang saat restart. Yang tersimpan permanen cuma ID pesan yang sudah ditanggapi (tanpa teks).</p></div>`,
  });

  const body = `${pageHead({
    kicker: '04 — Kehadiran',
    title: 'AI Agent',
    subtitle: 'Bot ikut menghidupkan channel ngobrol, dan mengomentari foto di channel galeri.',
  })}
<div class="mb">${personaCard}</div>
<div class="grid cols-2 mt">${channelsCard}${behaviourCard}</div>
<div class="mt">${testCard}</div>

<script>
/**
 * Simpan persona lewat endpoint sendiri.
 *
 * Dulu persona disimpan lewat /api/pengaturan milik halaman Pengaturan — kalau
 * kartunya pindah tanpa endpoint baru, tombolnya akan memanggil fungsi yang
 * tidak ada di halaman ini.
 */
async function savePersona() {
  const button = document.getElementById('savePersona');
  button.disabled = true;
  try {
    await postJson('/api/persona', {
      guild: ${JSON.stringify(options.guildId)},
      persona: document.getElementById('persona').value,
    }, 'Persona disimpan.');
  } finally {
    button.disabled = false;
  }
}

async function saveAgent() {
  await postJson('/api/agent', {
    channelId: document.getElementById('agentChannel').value || null,
    galleryChannelId: document.getElementById('agentGallery').value || null,
    quietMinutes: Number(document.getElementById('agentQuiet').value) || 0,
    maxPerHour: Number(document.getElementById('agentMax').value) || 6,
    cooldownSeconds: Number(document.getElementById('agentCooldown').value) || 0,
    busyMute: document.getElementById('agentBusy').checked,
    reactEmoji: document.getElementById('agentEmoji').checked,
    reactImages: document.getElementById('agentImages').checked,
  }, 'Pengaturan agent disimpan.');
}

/**
 * Uji balasan agent memakai pengaturan yang TERSIMPAN.
 *
 * Berbeda dengan halaman Sambutan (yang memakai isi form), di sini pengaturan
 * agent dipakai apa adanya karena hasilnya juga bergantung pada channel, jeda,
 * dan batas per jam — menguji nilai yang belum disimpan akan menyesatkan.
 */
async function runAgentTest() {
  var button = document.getElementById('testChat');
  var label = button.textContent;
  button.disabled = true;
  button.textContent = 'Menguji…';
  document.getElementById('testState').textContent = 'Menghubungi model…';

  try {
    var data = await api('/api/preview/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('testName').value.trim(),
        message: document.getElementById('testMessage').value.trim(),
        role: document.getElementById('testRole').value,
      }),
    });
    showAgentResult(
      data.source === 'ai' ? '✍️ balasan ' + (data.role === 'gallery' ? 'mode galeri' : 'mode ngobrol') : '⚠️ gagal',
      data.text || '(kosong)',
      data.note,
    );
    document.getElementById('testState').textContent = 'Selesai';
    toast('✅ Pratinjau balasan siap — belum ada yang dikirim');
  } catch (error) {
    document.getElementById('testState').textContent = 'Gagal';
    toast('Gagal menguji: ' + error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/** Uji apakah bot akan menyapa saat channel sepi, beserta kalimatnya. */
async function runQuietTest() {
  var button = document.getElementById('testQuiet');
  var label = button.textContent;
  button.disabled = true;
  button.textContent = 'Menguji…';
  document.getElementById('testState').textContent = 'Menghubungi model…';

  try {
    var data = await api('/api/preview/quiet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!data.wouldFire) {
      showAgentResult('⏸️ tidak akan menyapa', '(tidak ada kalimat)', data.reason);
    } else if (data.source === 'ai') {
      showAgentResult('✍️ kalimat pemecah sepi', data.text, data.reason);
    } else {
      showAgentResult('⚠️ gagal membuat kalimat', '(kosong)', data.note || data.reason);
    }
    document.getElementById('testState').textContent = 'Selesai';
  } catch (error) {
    document.getElementById('testState').textContent = 'Gagal';
    toast('Gagal menguji: ' + error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/**
 * Kirim balasan hasil tes ke channel AI Agent yang tersimpan.
 *
 * Bot mengirim SATU pesan: kutipan pesan uji + balasannya. Tidak membuat pesan
 * palsu dari "member", supaya riwayat channel tetap jujur.
 */
async function sendAgentTest() {
  var button = document.getElementById('sendAgent');
  var label = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Mengirim…';
  document.getElementById('testState').textContent = 'Mengirim ke Discord…';

  try {
    var data = await api('/api/send-test/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('testName').value.trim(),
        message: document.getElementById('testMessage').value.trim(),
        role: document.getElementById('testRole').value,
      }),
    });
    toast('✅ Terkirim ke #' + data.channelName);
    showAgentResult('📨 terkirim ke #' + data.channelName, data.text || '(kosong)', null);
    document.getElementById('testState').textContent = 'Terkirim';
  } catch (error) {
    toast('Gagal mengirim: ' + error.message, true);
    showAgentResult('⚠️ gagal mengirim', '(tidak terkirim)', error.message);
    document.getElementById('testState').textContent = 'Gagal mengirim';
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

function showAgentResult(meta, text, note) {
  document.getElementById('outAgent').hidden = false;
  document.getElementById('metaAgent').textContent = meta + (note ? ' — ' + note : '');
  document.getElementById('textAgent').textContent = text;
}
</script>`;

  return appShell({
    title: 'AI Agent',
    guildId: options.guildId,
    guildName: options.guildName ?? null,
    active: 'agent',
    body,
    counts: options.counts,
    status: options.status,
  });
}

/* ------------------------------------------------------------------ */
/*  Moderasi                                                           */
/* ------------------------------------------------------------------ */

export interface ModerationLogItem {
  id: number;
  userId: string;
  userName: string;
  channelId: string;
  matched: string;
  action: string;
  createdAt: number;
}

export interface ModerasiOptions extends PageContext {
  enabled: boolean;
  words: string[];
  action: string;
  timeoutMinutes: number;
  /** true = nilai berasal dari `.env`, belum pernah disimpan dari dashboard */
  fromEnv: boolean;
  logs: ModerationLogItem[];
}

const ACTION_TEXT: Record<string, string> = {
  delete: 'Hapus pesan',
  warn: 'Hapus + peringatan',
  timeout: 'Hapus + timeout',
};

export function moderasiPage(options: ModerasiOptions): string {
  const status = options.enabled ? badge('Aktif', 'ok') : badge('Nonaktif', 'warn');
  const totalWords = options.words.length;

  const settingsCard = card({
    title: 'Filter kata',
    hint: 'berlaku untuk semua channel teks',
    right: status,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <label class="check-row" style="display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--text-2)">
    <input type="checkbox" id="modEnabled" ${options.enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
    <span>Aktifkan moderasi otomatis di server ini</span>
  </label>
  <div>
    <label class="field" for="modWords">Kata terlarang</label>
    <textarea id="modWords" rows="4" placeholder="kata1, kata2, frasa tiga kata">${esc(options.words.join(', '))}</textarea>
    <p class="hint">Pisahkan dengan koma atau baris baru. Pencocokan tidak peduli huruf besar/kecil dan mengabaikan tanda baca (mis. <code>k0nt0l</code> tetap tertangkap).</p>
  </div>
  <div class="grid cols-2-even" style="gap:14px">
    <div>
      <label class="field" for="modAction">Tindakan</label>
      <span class="select-shell" style="width:100%">
        <select id="modAction" style="width:100%">
          <option value="delete" ${options.action === 'delete' ? 'selected' : ''}>Hapus pesan</option>
          <option value="warn" ${options.action === 'warn' ? 'selected' : ''}>Hapus + peringatan</option>
          <option value="timeout" ${options.action === 'timeout' ? 'selected' : ''}>Hapus + timeout member</option>
        </select>
        ${icon('chevron', 15)}
      </span>
    </div>
    <div>
      <label class="field" for="modTimeout">Durasi timeout (menit)</label>
      <input type="text" id="modTimeout" class="mono" inputmode="numeric" value="${options.timeoutMinutes}" ${options.action === 'timeout' ? '' : 'disabled'}>
      <p class="hint">1–10080 menit (maks 7 hari).</p>
    </div>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <button class="btn-primary" type="button" id="saveModeration" onclick="saveModeration()">${icon('check', 16)} Simpan pengaturan</button>
    <span class="hint" style="margin:0">${options.fromEnv ? 'Belum pernah disimpan — nilai awal diambil dari <code>.env</code>.' : 'Tersimpan di dashboard.'}</span>
  </div>
</div>`,
  });

  const statsCard = card({
    title: 'Ringkasan',
    body: `<div class="list">
  <div class="kv"><span>Status</span><b>${options.enabled ? 'Menangkap kata terlarang' : 'Mati — pesan tidak diperiksa'}</b></div>
  <div class="kv"><span>Kata terdaftar</span><b>${formatNumber(totalWords)}</b></div>
  <div class="kv"><span>Tindakan</span><b>${esc(ACTION_TEXT[options.action] ?? options.action)}</b></div>
  <div class="kv"><span>Durasi timeout</span><b>${formatNumber(options.timeoutMinutes)} menit</b></div>
  <div class="kv"><span>Log tercatat</span><b>${formatNumber(options.logs.length)}</b></div>
</div>
<div class="card-pad"><p class="hint" style="margin:0">Staff (role <code>STAFF_ROLE_ID</code> atau izin <b>Manage Messages</b>) tidak terkena filter. Setiap tindakan dikirim juga ke channel log <code>MODLOG_CHANNEL_ID</code> bila diisi.</p></div>`,
  });

  const logRows = options.logs
    .map(
      (log) => `<tr>
  <td class="cell-main-cell">
    <div class="cell-main">
      <span class="avatar-sm">${esc(initials(log.userId))}</span>
      <span style="min-width:0">
        <div class="cell-title">${esc(log.userName)}</div>
        <div class="cell-sub">#${esc(log.userId)}</div>
      </span>
    </div>
  </td>
  <td data-label="Kata"><span class="badge danger"><span class="dot"></span>${esc(log.matched)}</span></td>
  <td class="col-hide-sm" data-label="Tindakan"><span class="cell-sub">${esc(ACTION_TEXT[log.action] ?? log.action)}</span></td>
  <td class="cell-date"><span class="cell-sub"><span class="date-long">${esc(formatDate(log.createdAt))}</span><span class="date-short">${esc(
    new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(log.createdAt)),
  )}</span></span></td>
  <td class="num cell-aksi">
    <button class="btn-danger btn-sm btn-icon" type="button" onclick="removeModLog(${log.id})"
      title="Hapus log" aria-label="Hapus log ${log.id}">${icon('trash', 15)}</button>
  </td>
</tr>`,
    )
    .join('');

  const logsCard = card({
    title: 'Log pelanggaran',
    hint: options.logs.length > 0 ? `${options.logs.length} terakhir` : undefined,
    right:
      options.logs.length > 0
        ? `<button class="btn-ghost btn-sm" type="button" onclick="clearModLogs()">${icon('trash', 14)} Bersihkan</button>`
        : undefined,
    body: logRows
      ? `<div class="table-wrap"><table class="table-stack table-mod">
  <thead><tr><th>Pelanggar</th><th>Kata</th><th class="col-hide-sm">Tindakan</th><th>Waktu</th><th></th></tr></thead>
  <tbody>${logRows}</tbody>
</table></div>`
      : emptyState({
          icon: 'alert',
          title: 'Belum ada pelanggaran',
          text: 'Begitu moderasi menangkap kata terlarang, kejadiannya muncul di sini — lengkap dengan pelaku, kata yang cocok, dan tindakan yang diambil.',
        }),
  });

  // Badge status hanya dipakai SEKALI, di header kartu "Filter kata".
  // Dulu badge yang sama juga ditempel di judul halaman, jadi terbaca dua kali
  // ("NONAKTIF" di atas dan "NONAKTIF" lagi di kartu) dengan jarak lega.
  const body = `${pageHead({
    kicker: '08 — Keamanan',
    title: 'Moderasi',
    subtitle: 'Saring kata terlarang otomatis tanpa perlu bot moderasi tambahan. Pengaturan disimpan per server.',
  })}
<div class="grid cols-2-even">${settingsCard}${statsCard}</div>
<div class="mt">${logsCard}</div>
<script>
function modTimeoutSync() {
  var action = document.getElementById('modAction').value;
  var input = document.getElementById('modTimeout');
  input.disabled = action !== 'timeout';
}
document.getElementById('modAction').addEventListener('change', modTimeoutSync);

async function saveModeration() {
  var words = document.getElementById('modWords').value
    .split(/[,\\n]/)
    .map(function (word) { return word.trim(); })
    .filter(Boolean);
  var minutes = parseInt(document.getElementById('modTimeout').value, 10);
  if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
    toast('Durasi timeout harus 1–10080 menit', true);
    return;
  }
  var button = document.getElementById('saveModeration');
  button.disabled = true;
  try {
    await api('/api/moderasi', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guild: ${JSON.stringify(options.guildId)},
        enabled: document.getElementById('modEnabled').checked,
        words: words,
        action: document.getElementById('modAction').value,
        timeoutMinutes: minutes,
      }),
    });
    toast('Pengaturan moderasi disimpan');
    setTimeout(function () { location.reload(); }, 400);
  } catch (error) {
    toast('Gagal menyimpan: ' + error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function removeModLog(id) {
  var ok = await askConfirm('Hapus log ini?', 'Catatan pelanggaran akan dihapus dari dashboard. Tindakan yang sudah diambil di Discord tidak dibatalkan.');
  if (!ok) return;
  try {
    await api('/api/moderasi/logs/' + id + '?guild=' + encodeURIComponent(${JSON.stringify(options.guildId)}), { method: 'DELETE' });
    toast('Log dihapus');
    setTimeout(function () { location.reload(); }, 350);
  } catch (error) {
    toast('Gagal menghapus: ' + error.message, true);
  }
}

async function clearModLogs() {
  var ok = await askConfirm('Bersihkan semua log?', 'Seluruh catatan pelanggaran server ini akan dihapus. Pengaturan kata tetap disimpan.');
  if (!ok) return;
  try {
    await api('/api/moderasi/logs?guild=' + encodeURIComponent(${JSON.stringify(options.guildId)}), { method: 'DELETE' });
    toast('Semua log dibersihkan');
    setTimeout(function () { location.reload(); }, 350);
  } catch (error) {
    toast('Gagal membersihkan: ' + error.message, true);
  }
}
</script>`;

  return appShell({
    title: 'Moderasi',
    guildId: options.guildId,
    guildName: options.guildName,
    active: 'moderasi',
    body,
    counts: options.counts,
    status: options.status,
  });
}
