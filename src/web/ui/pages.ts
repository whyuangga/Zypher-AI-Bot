/**
 * Semua halaman dashboard. Server-rendered; JS hanya untuk aksi kecil
 * (upload, hapus, simpan) yang memanggil API JSON di server.ts.
 */
import { icon } from './icons.js';
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
  guilds: string[];
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
      <span class="brand-mark">${icon('sparkles', 22)}</span>
      <h1>Masuk ke Zypher AI</h1>
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
  stats: { rooms: number; documents: number; chunks: number; keywords: number; memories: number; messages: number };
  rooms: Array<{ channelId: string; userId: string; messageCount: number; lastActiveAt: number }>;
  documents: Array<{ id: number; name: string; chunkCount: number; chars: number; createdAt: number }>;
  series: Array<{ day: string; count: number }>;
  ragEnabled: boolean;
  embedModel: string | null;
  model: string;
}

export function ringkasanPage(data: DashboardData): string {
  const stats = `<div class="grid stats">
  ${statCard({ label: 'Room AI', value: data.stats.rooms, icon: 'message', foot: 'privat per member' })}
  ${statCard({ label: 'Dokumen RAG', value: data.stats.documents, icon: 'book', foot: `<b>${formatNumber(data.stats.chunks)}</b> potongan teks` })}
  ${statCard({ label: 'Keyword', value: data.stats.keywords, icon: 'tag', foot: 'template owner' })}
  ${statCard({ label: 'Memori user', value: data.stats.memories, icon: 'brain', foot: 'antar sesi' })}
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
  <div class="kv"><span>Mode</span><b>${data.status.mode === 'bot' ? 'Bot + dashboard' : 'Dashboard saja'}</b></div>
</div>`,
  });

  const roomRows = data.rooms.length
    ? data.rooms
        .slice(0, 6)
        .map(
          (room) => `<tr>
    <td>
      <div class="cell-main">
        <span class="avatar-sm">${esc(initials(room.userId))}</span>
        <span>
          <div class="cell-title">Room <span class="mono">…${esc(room.channelId.slice(-4))}</span></div>
          <div class="cell-sub mono" title="Pemilik: ${esc(room.userId)}">pemilik …${esc(room.userId.slice(-4))}</div>
        </span>
      </div>
    </td>
    <td class="num">${formatNumber(room.messageCount)}</td>
    <td><span class="badge">${icon('activity', 13)} ${esc(relativeTime(room.lastActiveAt))}</span></td>
  </tr>`,
        )
        .join('')
    : '';

  const roomsCard = card({
    title: 'Room AI terbaru',
    right: `<a class="btn-ghost btn-sm" href="/memori">Lihat memori ${icon('chevron', 13)}</a>`,
    body: roomRows
      ? `<div class="table-wrap"><table>
  <thead><tr><th>Pemilik</th><th class="num">Pesan</th><th>Aktivitas</th></tr></thead>
  <tbody>${roomRows}</tbody>
</table></div>`
      : emptyState({
          icon: 'message',
          title: 'Belum ada room aktif',
          text: 'Buat room lewat tombol "Buat Room AI" di panel Discord — channel privat akan muncul di sini.',
        }),
  });

  const docsCard = card({
    title: 'Dokumen terbaru',
    right: `<a class="btn-ghost btn-sm" href="/dokumen">Kelola ${icon('chevron', 13)}</a>`,
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
    title: 'Ringkasan',
    subtitle: `Server <span class="mono">${esc(data.guildId || '—')}</span> · data langsung dari SQLite bot`,
    actions: `<a class="btn-primary" href="/dokumen">${icon('upload', 16)} Upload dokumen</a>`,
  })}
${stats}
<div class="grid cols-2 mt">${chartCard}${statusCard}</div>
<div class="grid cols-2 mt">${roomsCard}${docsCard}</div>`;

  return appShell({ title: 'Ringkasan', guildId: data.guildId, guilds: data.guilds, active: 'ringkasan', body, counts: data.counts, status: data.status });
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
  <td>
    <div class="cell-main">
      <span class="avatar-sm">${icon('file', 15)}</span>
      <span>
        <div class="cell-title">${esc(document.name)}</div>
        <div class="cell-sub">${badge(document.source === 'dashboard' ? 'dashboard' : document.source, 'brand', false)}</div>
      </span>
    </div>
  </td>
  <td>${formatNumber(document.chunkCount)} <span class="cell-sub">potongan</span><br>
    <span class="cell-sub">${formatNumber(document.chars)} karakter</span></td>
  <td><span class="cell-sub">${esc(formatDate(document.createdAt))}</span></td>
  <td class="num">
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
  <input type="file" id="file" accept=".txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.html,.htm,.xml,.log,.ini,.yaml,.yml,.sql,.ts,.js,.py">
  <p class="hint">Teks saja: .txt .md .csv .json .html .log — maks 5 MB.</p>
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
      ? `<div class="table-wrap"><table>
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
  if (file.size > 5 * 1024 * 1024) return toast('File lebih dari 5 MB', true);

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
    hits.innerHTML = data.results.map(function (hit) {
      return '<div class="list-row" style="padding:12px 0">' +
        '<div class="list-body"><div class="list-title">' + hit.documentName +
        ' <span class="badge brand">' + hit.via + '</span>' +
        ' <span class="list-meta">bagian ' + (hit.ordinal + 1) + ' · skor ' + hit.score.toFixed(2) + '</span></div>' +
        '<div class="list-text">' + hit.preview.replace(/[<>&]/g, function (c) {
          return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c];
        }) + '</div></div></div>';
    }).join('');
  } catch (error) {
    hits.innerHTML = '<div class="list-meta">Gagal mencari: ' + error.message + '</div>';
  }
}
</script>`;

  return appShell({
    title: 'Dokumen',
    guildId: options.guildId,
    guilds: options.guilds,
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
    guilds: options.guilds,
    active: 'keyword',
    body,
    counts: options.counts,
    status: options.status,
  });
}

/* ------------------------------------------------------------------ */
/*  Memori                                                             */
/* ------------------------------------------------------------------ */

export interface MemoryGroupView {
  userId: string;
  items: Array<{ id: number; content: string; source: string; createdAt: number }>;
}

export function memoriPage(options: PageContext & { groups: MemoryGroupView[] }): string {
  const total = options.groups.reduce((sum, group) => sum + group.items.length, 0);

  const groups = options.groups
    .map(
      (group, index) => `<details class="user-group"${index === 0 ? ' open' : ''}>
  <summary>
    <span class="avatar-sm">${esc(initials(group.userId))}</span>
    <span>
      <div class="cell-title mono">${esc(group.userId)}</div>
      <div class="cell-sub">${group.items.length} memori</div>
    </span>
    <span class="chev">${icon('chevron', 16)}</span>
  </summary>
  <div class="list" style="padding-bottom:6px">
    ${group.items
      .map(
        (memory) => `<div class="list-row" style="padding-left:20px">
      <div class="list-body">
        <div class="list-text">${esc(memory.content)}</div>
        <div class="list-meta">
          ${memory.source === 'manual' ? badge('manual', 'brand', false) : badge('otomatis', 'neutral', false)}
          <span>${esc(relativeTime(memory.createdAt))}</span>
        </div>
      </div>
      <button class="btn-ghost btn-sm btn-icon" type="button"
        onclick="removeMemory(${memory.id}, ${esc(JSON.stringify(group.userId))})"
        title="Hapus memori" aria-label="Hapus memori">${icon('trash', 15)}</button>
    </div>`,
      )
      .join('')}
  </div>
</details>`,
    )
    .join('');

  const listCard = card({
    title: 'Memori per user',
    hint: `${total} fakta · ${options.groups.length} user`,
    body: groups
      ? groups
      : emptyState({
          icon: 'brain',
          title: 'AI belum mengingat siapa pun',
          text: 'Memori terbentuk saat member memakai /ingat di room AI, atau otomatis dari percakapan penting.',
        }),
  });

  const explainCard = card({
    title: 'Cara kerja memori',
    body: `<div class="list">
  <div class="kv"><span>Ditambah manual</span><b class="mono">/ingat</b></div>
  <div class="kv"><span>Dilihat member</span><b class="mono">/memori</b></div>
  <div class="kv"><span>Dihapus member</span><b class="mono">/lupakan</b></div>
  <div class="kv"><span>Dipakai AI</span><b>setiap jawaban di room itu</b></div>
</div>
<div class="card-pad">
  <p class="hint" style="margin:0">Memori terikat ke server + user, jadi AI tidak mencampur fakta antar member.
  Menghapus di sini membuat AI benar-benar lupa.</p>
</div>`,
  });

  const body = `${pageHead({
    title: 'Memori',
    subtitle: 'Fakta yang diingat AI tentang tiap member, lintas percakapan.',
    actions: badge(`${total} fakta`, total ? 'ok' : 'neutral'),
  })}
<div class="grid cols-2">${listCard}${explainCard}</div>
<script>
const GUILD = ${JSON.stringify(options.guildId)};

async function removeMemory(id, userId) {
  var ok = await askConfirm('Hapus memori?', 'AI akan lupa fakta ini pada percakapan berikutnya.');
  if (!ok) return;
  try {
    await api('/api/memori/' + id + '?guild=' + encodeURIComponent(GUILD) + '&user=' + encodeURIComponent(userId), { method: 'DELETE' });
    toast('Memori dihapus');
    setTimeout(function () { location.reload(); }, 400);
  } catch (error) {
    toast('Gagal menghapus: ' + error.message, true);
  }
}
</script>`;

  return appShell({
    title: 'Memori',
    guildId: options.guildId,
    guilds: options.guilds,
    active: 'memori',
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
    persona: string | null;
    model: string | null;
    defaultModel: string;
    embedModel: string | null;
    ragEnabled: boolean;
    stats: { messages: number; rooms: number; documents: number };
  },
): string {
  const personaCard = card({
    title: 'Persona AI',
    hint: 'gaya bicara bot di server ini',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:12px">
  <textarea id="persona" placeholder="Contoh: Kamu asisten komunitas yang ramah, menjawab singkat, dan memakai bahasa Indonesia santai.">${esc(options.persona ?? '')}</textarea>
  <p class="hint">Kosongkan untuk memakai persona bawaan. Persona berlaku untuk semua room di server ini.</p>
  <button class="btn-primary" type="button" id="savePersona" onclick="saveSettings({ persona: document.getElementById('persona').value })">
    ${icon('check', 16)} Simpan persona
  </button>
</div>`,
  });

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

  const infoCard = card({
    title: 'Info server',
    body: `<div class="list">
  <div class="kv"><span>Server ID</span><b class="mono">${esc(options.guildId || '—')}</b></div>
  <div class="kv"><span>Mode</span><b>${options.status.mode === 'bot' ? 'Bot + dashboard' : 'Dashboard saja'}</b></div>
  <div class="kv"><span>Dokumen RAG</span>${options.ragEnabled ? badge('Aktif', 'ok') : badge('Nonaktif', 'warn')}</div>
  <div class="kv"><span>Embedding</span><b class="mono">${esc(options.embedModel ?? 'tidak dipakai')}</b></div>
  <div class="kv"><span>Room AI</span><b>${formatNumber(options.stats.rooms)}</b></div>
  <div class="kv"><span>Pesan tersimpan</span><b>${formatNumber(options.stats.messages)}</b></div>
</div>
<div class="card-pad">
  <button class="btn-ghost btn-sm" type="button" data-copy="${esc(options.guildId)}" data-copy-label="Server ID">
    ${icon('copy', 14)} Salin Server ID
  </button>
</div>`,
  });

  const body = `${pageHead({
    title: 'Pengaturan',
    subtitle: 'Perilaku AI dan informasi server. Perubahan langsung berlaku untuk pesan berikutnya.',
  })}
<div class="grid cols-2-even">${personaCard}${modelCard}</div>
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
</script>`;

  return appShell({
    title: 'Pengaturan',
    guildId: options.guildId,
    guilds: options.guilds,
    active: 'pengaturan',
    body,
    counts: options.counts,
    status: options.status,
  });
}

export { SHARED_JS };
