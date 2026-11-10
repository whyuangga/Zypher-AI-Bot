/**
 * Halaman HTML dashboard. Server-rendered, tanpa framework — cukup `node:http`.
 * Semua teks dari user di-escape lewat `esc()` sebelum masuk HTML.
 */

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root {
  --bg: #0f1117; --panel: #171a23; --panel-2: #1e2230; --line: #2b3040;
  --text: #e7eaf3; --muted: #9aa3b8; --brand: #6d8cff; --ok: #43d17c; --danger: #ff6b6b;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
header { display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding: 14px 22px; border-bottom: 1px solid var(--line); background: var(--panel); }
header .brand { font-weight: 700; letter-spacing: .3px; }
header nav { display: flex; gap: 14px; font-size: 14px; }
header form { margin-left: auto; display: flex; gap: 8px; align-items: center; }
main { max-width: 1060px; margin: 0 auto; padding: 24px 22px 60px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 28px 0 10px; }
p.sub { color: var(--muted); margin: 0 0 22px; font-size: 14px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.card .n { font-size: 24px; font-weight: 700; }
.card .l { color: var(--muted); font-size: 12.5px; text-transform: uppercase; letter-spacing: .5px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12.5px; text-transform: uppercase; letter-spacing: .4px; }
tr:last-child td { border-bottom: none; }
input, select, textarea, button { font: inherit; }
input[type=text], input[type=password], input[type=search], select, textarea {
  background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
  border-radius: 9px; padding: 9px 11px; width: 100%; }
textarea { min-height: 130px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
button { background: var(--brand); color: #0b1020; border: 0; border-radius: 9px;
  padding: 9px 15px; font-weight: 650; cursor: pointer; }
button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); font-weight: 500; }
button.danger { background: transparent; color: var(--danger); border: 1px solid #40222a; }
button:disabled { opacity: .55; cursor: default; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
.muted { color: var(--muted); }
.tag { display: inline-block; font-size: 11.5px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted); }
.empty { color: var(--muted); padding: 18px 0; }
pre.hit { white-space: pre-wrap; background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 9px; padding: 10px 12px; font-size: 13px; margin: 8px 0 0; }
.toast { position: fixed; right: 18px; bottom: 18px; background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 10px; padding: 11px 15px; font-size: 14px; display: none; max-width: 380px; }
.toast.show { display: block; }
.login { max-width: 380px; margin: 12vh auto; }
code { background: var(--panel-2); padding: 1px 5px; border-radius: 5px; font-size: 13px; }
`;

function layout(options: {
  title: string;
  body: string;
  guildId: string;
  guilds: string[];
  active: 'dashboard' | 'dokumen';
}): string {
  // Server yang diketik manual (belum ada datanya di database) tetap ditampilkan
  // sebagai pilihan terpilih — kalau tidak, dropdown memperlihatkan server lain.
  const guildChoices =
    options.guildId && !options.guilds.includes(options.guildId)
      ? [options.guildId, ...options.guilds]
      : options.guilds;

  const options_ = guildChoices
    .map(
      (id) =>
        `<option value="${esc(id)}"${id === options.guildId ? ' selected' : ''}>${esc(id)}</option>`,
    )
    .join('');

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)} · Zypher AI</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <span class="brand">⚡ Zypher AI</span>
  <nav>
    <a href="/">Ringkasan</a>
    <a href="/dokumen">Dokumen (RAG)</a>
    <a href="/healthz">Health</a>
  </nav>
  <form method="get" action="/" style="gap:6px">
    <label class="muted" for="guild">Server</label>
    <select id="guild" name="guild" onchange="this.form.submit()" style="width:auto;min-width:150px">
      ${options_ || '<option value="">(belum ada server)</option>'}
    </select>
    <input type="text" name="guild_manual" placeholder="atau tempel Server ID" inputmode="numeric"
      value="" style="width:190px" title="ID server Discord — berguna kalau bot belum pernah join">
    <button type="submit" class="ghost">Pakai</button>
    <a href="/logout"><button type="button" class="ghost">Keluar</button></a>
  </form>
</header>
<main>
${options.body}
</main>
<div class="toast" id="toast"></div>
<script>
function toast(message, bad) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.style.borderColor = bad ? 'var(--danger)' : 'var(--line)';
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}
</script>
</body>
</html>`;
}

export function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Masuk · Zypher AI</title><style>${STYLE}</style></head>
<body>
<div class="login">
  <h1>⚡ Zypher AI</h1>
  <p class="sub">Dashboard admin bot. Masukkan <code>DASHBOARD_TOKEN</code> dari file <code>.env</code>.</p>
  <div class="panel">
    ${error ? `<p style="color:var(--danger);margin-top:0">${esc(error)}</p>` : ''}
    <form method="post" action="/login">
      <input type="password" name="token" placeholder="DASHBOARD_TOKEN" autofocus autocomplete="current-password">
      <div class="row" style="margin-top:12px"><button type="submit">Masuk</button></div>
    </form>
  </div>
</div>
</body></html>`;
}

export interface DashboardData {
  guildId: string;
  guilds: string[];
  stats: {
    rooms: number;
    documents: number;
    chunks: number;
    keywords: number;
    memories: number;
    messages: number;
  };
  rooms: Array<{ channelId: string; userId: string; messageCount: number; lastActiveAt: number }>;
  documents: Array<{ id: number; name: string; chunkCount: number; chars: number; createdAt: number }>;
  ragEnabled: boolean;
  embedModel: string | null;
}

const formatDate = (ms: number): string =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(
    new Date(ms),
  );

const formatNumber = (value: number): string => new Intl.NumberFormat('id-ID').format(value);

export function dashboardPage(data: DashboardData): string {
  const roomRows =
    data.rooms.length === 0
      ? '<tr><td colspan="3" class="empty">Belum ada room aktif. Buat lewat panel di Discord.</td></tr>'
      : data.rooms
          .map(
            (room) => `<tr>
        <td><code>${esc(room.channelId)}</code></td>
        <td><code>${esc(room.userId)}</code></td>
        <td>${formatNumber(room.messageCount)} pesan<br><span class="muted">${esc(formatDate(room.lastActiveAt))}</span></td>
      </tr>`,
          )
          .join('');

  const docRows =
    data.documents.length === 0
      ? '<tr><td colspan="3" class="empty">Belum ada dokumen. <a href="/dokumen">Upload di sini</a>.</td></tr>'
      : data.documents
          .slice(0, 6)
          .map(
            (document) => `<tr>
        <td>${esc(document.name)}</td>
        <td>${formatNumber(document.chunkCount)} potongan</td>
        <td class="muted">${esc(formatDate(document.createdAt))}</td>
      </tr>`,
          )
          .join('');

  const body = `
<h1>Ringkasan server</h1>
<p class="sub">Guild <code>${esc(data.guildId || '—')}</code> · data langsung dari SQLite bot.</p>

<div class="cards">
  <div class="card"><div class="n">${formatNumber(data.stats.rooms)}</div><div class="l">Room AI</div></div>
  <div class="card"><div class="n">${formatNumber(data.stats.documents)}</div><div class="l">Dokumen RAG</div></div>
  <div class="card"><div class="n">${formatNumber(data.stats.chunks)}</div><div class="l">Potongan teks</div></div>
  <div class="card"><div class="n">${formatNumber(data.stats.keywords)}</div><div class="l">Keyword</div></div>
  <div class="card"><div class="n">${formatNumber(data.stats.memories)}</div><div class="l">Memori user</div></div>
  <div class="card"><div class="n">${formatNumber(data.stats.messages)}</div><div class="l">Pesan tersimpan</div></div>
</div>

<h2>Status fitur</h2>
<div class="panel">
  <div class="row" style="gap:8px">
    <span class="tag">RAG: ${data.ragEnabled ? 'aktif' : 'nonaktif'}</span>
    <span class="tag">Pencarian: ${data.embedModel ? `hybrid (BM25 + ${esc(data.embedModel)})` : 'leksikal (BM25)'}</span>
    <span class="tag">Dashboard: aktif</span>
  </div>
  <p class="muted" style="margin-bottom:0">Pencarian leksikal tidak butuh API key.
  Isi <code>EMBED_MODEL</code> + <code>EMBED_BASE_URL</code> untuk menambah pencarian vektor.</p>
</div>

<h2>Room terbaru</h2>
<div class="panel">
  <table>
    <thead><tr><th>Channel</th><th>Pemilik</th><th>Aktivitas</th></tr></thead>
    <tbody>${roomRows}</tbody>
  </table>
</div>

<h2>Dokumen terbaru</h2>
<div class="panel">
  <table>
    <thead><tr><th>Nama</th><th>Ukuran indeks</th><th>Ditambahkan</th></tr></thead>
    <tbody>${docRows}</tbody>
  </table>
</div>`;

  return layout({ title: 'Ringkasan', body, guildId: data.guildId, guilds: data.guilds, active: 'dashboard' });
}

export interface DocumentRowView {
  id: number;
  name: string;
  chunkCount: number;
  chars: number;
  source: string;
  createdAt: number;
}

export function documentsPage(options: {
  guildId: string;
  guilds: string[];
  documents: DocumentRowView[];
  embedModel: string | null;
}): string {
  const rows =
    options.documents.length === 0
      ? '<tr><td colspan="4" class="empty">Belum ada dokumen untuk server ini.</td></tr>'
      : options.documents
          .map(
            (document) => `<tr>
        <td>${esc(document.name)}<br><span class="tag">${esc(document.source)}</span></td>
        <td>${formatNumber(document.chunkCount)} potongan<br><span class="muted">${formatNumber(document.chars)} karakter</span></td>
        <td class="muted">${esc(formatDate(document.createdAt))}</td>
        <td><button class="danger" onclick="removeDoc(${document.id}, '${esc(document.name).replace(/'/g, '\\&#39;')}')">Hapus</button></td>
      </tr>`,
          )
          .join('');

  const body = `
<h1>Dokumen pengetahuan (RAG)</h1>
<p class="sub">Dokumen di sini dipakai AI sebagai rujukan jawaban. Nama yang sama akan mengganti versi lama.</p>

<div class="grid2">
  <div class="panel">
    <h2 style="margin-top:0">Upload dari komputer</h2>
    <p class="muted" style="margin-top:0">Format teks: .txt, .md, .csv, .json, .html, .log (maks 5 MB).</p>
    <input type="file" id="file" accept=".txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.html,.htm,.xml,.log,.ini,.yaml,.yml,.sql,.ts,.js,.py">
    <div class="row" style="margin-top:12px">
      <button onclick="uploadFile()" id="uploadBtn">Upload dokumen</button>
      <span class="muted" id="uploadState"></span>
    </div>
  </div>

  <div class="panel">
    <h2 style="margin-top:0">Atau tempel teks langsung</h2>
    <input type="text" id="pasteName" placeholder="Nama dokumen, mis. faq-komunitas.md" value="catatan-baru.md">
    <textarea id="pasteBody" placeholder="Tempel isi dokumen di sini…" style="margin-top:8px"></textarea>
    <div class="row" style="margin-top:12px">
      <button onclick="uploadText()" id="pasteBtn">Simpan sebagai dokumen</button>
    </div>
  </div>
</div>

<h2>Uji pencarian</h2>
<div class="panel">
  <div class="row">
    <input type="search" id="q" placeholder="mis. jam operasional server" onkeydown="if(event.key==='Enter')runSearch()" style="flex:1;min-width:220px">
    <button onclick="runSearch()">Cari</button>
  </div>
  <div id="hits" class="muted" style="margin-top:10px">Hasil pencarian muncul di sini — inilah potongan yang diselipkan ke prompt AI.</div>
</div>

<h2>Dokumen tersimpan (${options.documents.length})</h2>
<div class="panel">
  <table>
    <thead><tr><th>Nama</th><th>Indeks</th><th>Ditambahkan</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>

<script>
const GUILD = ${JSON.stringify(options.guildId)};

async function postDocument(name, text) {
  const response = await fetch('/api/dokumen', {
    method: 'POST',
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-filename': encodeURIComponent(name), 'x-guild': GUILD },
    body: text,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
  return data;
}

async function uploadFile() {
  const input = document.getElementById('file');
  const button = document.getElementById('uploadBtn');
  const state = document.getElementById('uploadState');
  if (!input.files || !input.files.length) return toast('Pilih file dulu ya', true);

  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) return toast('File lebih dari 5 MB', true);

  button.disabled = true;
  state.textContent = 'Mengunggah ' + file.name + '…';
  try {
    const text = await file.text();
    const data = await postDocument(file.name, text);
    toast('✅ ' + data.name + ' tersimpan — ' + data.chunkCount + ' potongan');
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    toast('Gagal: ' + error.message, true);
    state.textContent = '';
  } finally {
    button.disabled = false;
  }
}

async function uploadText() {
  const name = document.getElementById('pasteName').value.trim() || 'catatan-baru.md';
  const body = document.getElementById('pasteBody').value;
  const button = document.getElementById('pasteBtn');
  if (body.trim().length < 20) return toast('Isi dokumen masih kosong / terlalu pendek', true);

  button.disabled = true;
  try {
    const data = await postDocument(name, body);
    toast('✅ ' + data.name + ' tersimpan — ' + data.chunkCount + ' potongan');
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    toast('Gagal: ' + error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function removeDoc(id, name) {
  if (!confirm('Hapus dokumen "' + name + '" dari pengetahuan AI?')) return;
  const response = await fetch('/api/dokumen/' + id + '?guild=' + encodeURIComponent(GUILD), { method: 'DELETE' });
  if (response.ok) {
    toast('Dokumen dihapus');
    setTimeout(() => location.reload(), 500);
  } else {
    toast('Gagal menghapus', true);
  }
}

async function runSearch() {
  const query = document.getElementById('q').value.trim();
  const hits = document.getElementById('hits');
  if (!query) return;
  hits.textContent = 'Mencari…';
  const response = await fetch('/api/search?q=' + encodeURIComponent(query) + '&guild=' + encodeURIComponent(GUILD));
  const data = await response.json().catch(() => ({ results: [] }));
  if (!data.results || !data.results.length) {
    hits.innerHTML = '<span class="muted">Tidak ada potongan yang cocok.</span>';
    return;
  }
  hits.innerHTML = data.results.map((hit) =>
    '<div style="margin-bottom:12px"><div><strong>' + hit.documentName + '</strong> · bagian ' + (hit.ordinal + 1) +
    ' · skor ' + hit.score.toFixed(2) + ' <span class="tag">' + hit.via + '</span></div>' +
    '<pre class="hit">' + hit.preview.replace(/</g, '&lt;') + '</pre></div>'
  ).join('');
}
</script>`;

  return layout({ title: 'Dokumen', body, guildId: options.guildId, guilds: options.guilds, active: 'dokumen' });
}
