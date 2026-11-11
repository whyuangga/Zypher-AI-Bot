/**
 * Halaman **pesan** — penyusun pesan container.
 *
 * Dipisah dari `pages.ts` karena halaman ini punya editor blok sendiri
 * (tambah/hapus/urutkan) yang tidak dipakai halaman lain. Menggabungkannya ke
 * `pages.ts` akan membuat berkas itu makin panjang tanpa alasan.
 *
 * Prinsip yang dipegang:
 *   - Server merender daftar pesan; editor berjalan di browser.
 *   - Tidak ada HTML mentah dari isi blok: semua lewat `esc()`/`renderMentions`
 *     milik `pages.ts`, karena isinya teks buatan admin (bisa berisi `<script>`).
 *   - Batas Discord ditampilkan sebagai peringatan, bukan error diam-diam.
 */
import { badge, card, emptyState, esc, relativeTime } from './base.js';
import { icon } from './icons.js';
import { appShell, pageHead, type PageKey } from './shell.js';
import type { PageContext } from './pages.js';
import type { PostBlock } from '../../features/custom-post.js';

export interface PostRowView {
  id: number;
  name: string;
  channelId: string | null;
  blocks: PostBlock[];
  messageId: string | null;
  updatedAt: number;
}

export interface RoleOptionView {
  id: string;
  name: string;
  color: string;
  position: number;
  /** null = role bisa dibagi; selain itu alasannya. */
  blockedBy: string | null;
}

export interface PesanPageOptions extends PageContext {
  posts: PostRowView[];
  channels: Array<{ id: string; name: string }>;
  /** Bot siap menerima perintah kirim. */
  botReady: boolean;
  /** Role server untuk tombol ambil role (kosong kalau bot offline). */
  roles: RoleOptionView[];
  /** Bot punya izin Manage Roles — tanpa ini tombol role tidak akan bekerja. */
  hasManageRoles: boolean;
  /** Tombol role per pesan (pesanId -> tombol). */
  roleButtons: Record<number, Array<{ id: number; roleId: string; label: string; mode: string }>>;
}

/**
 * JSON yang aman ditanam di dalam <script>.
 *
 * `JSON.stringify` saja TIDAK cukup: isi blok berasal dari admin, dan teks
 * berisi `</script>` akan menutup tag lebih awal lalu menyuntikkan HTML
 * (celah XSS yang sudah dibuktikan dengan uji). Tiga penggantian ini menutup
 * semua jalan keluarnya:
 *
 *   <   -> \\u003c   (mencegah </script> dan <!--)
 *   >   -> \\u003e
 *   &   -> \\u0026
 *
 * Hasilnya tetap JSON yang sah, jadi JavaScript di browser membacanya seperti
 * biasa — hanya tidak bisa keluar dari konteks <script>.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** Ringkas isi blok untuk daftar: teks pertama, jumlah gambar & tombol. */
function summarize(blocks: PostBlock[]): string {
  const teks = blocks.find((b) => b.kind === 'text');
  const gambar = blocks.filter((b) => b.kind === 'image').length;
  const tombol = blocks.filter((b) => b.kind === 'button').length;
  const bagian: string[] = [];
  if (teks) bagian.push(teks.value.replace(/\s+/g, ' ').slice(0, 90));
  if (gambar) bagian.push(`${gambar} gambar`);
  if (tombol) bagian.push(`${tombol} tombol`);
  return bagian.join(' · ') || '(kosong)';
}

export function pesanPage(options: PesanPageOptions): string {
  const rows = options.posts.length
    ? options.posts
        .map((post) => {
          const status = post.messageId
            ? badge('terkirim', 'brand')
            : badge('belum dikirim', 'neutral');
          return `<div class="list-row">
  <span class="avatar-sm">${icon('file', 15)}</span>
  <div class="list-body">
    <div class="list-title">${esc(post.name)} ${status}</div>
    <div class="list-text">${esc(summarize(post.blocks))}</div>
    <div class="list-meta">diperbarui ${esc(relativeTime(post.updatedAt))}</div>
  </div>
  <div class="list-actions">
    <a class="btn btn-ghost btn-sm" href="/pesan?id=${post.id}">${icon('sliders', 15)} Ubah</a>
    <button class="btn-danger btn-sm btn-icon" type="button" title="Hapus pesan"
      aria-label="Hapus pesan" onclick="removePost(${post.id}, ${esc(JSON.stringify(post.name))})">${icon('trash', 15)}</button>
  </div>
</div>`;
        })
        .join('')
    : '';

  const listCard = card({
    title: 'Pesan tersimpan',
    hint: `${options.posts.length} buah`,
    body: rows
      ? `<div class="list">${rows}</div>`
      : emptyState({
          icon: 'file',
          title: 'Belum ada pesan',
          text: 'Susun pesan container untuk channel rules, ambil roles, pengumuman, atau info server — lalu kirim ke channel mana pun.',
        }),
  });

  const editorCard = card({
    title: 'Susun pesan',
    hint: 'teks, gambar, tombol link, dan pemisah',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <div class="grid cols-2" style="gap:12px">
    <div>
      <label class="field" for="postName">Nama pesan</label>
      <input type="text" id="postName" placeholder="mis. Rules" maxlength="120">
      <p class="hint">Hanya untuk dashboard — tidak ikut terkirim ke Discord.</p>
    </div>
    <div>
      <label class="field" for="postChannel">Channel tujuan</label>
      <span class="select-shell full">
        <select id="postChannel">
          <option value="">Belum dipilih — hanya bisa disimpan, belum bisa dikirim</option>
          ${options.channels
            .map((c) => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`)
            .join('')}
        </select>
        ${icon('chevron', 15)}
      </span>
      ${
        options.botReady
          ? ''
          : '<p class="hint">Bot sedang offline di proses ini, jadi daftar channel kosong. Jalankan bot untuk memilih channel.</p>'
      }
    </div>
  </div>

  <div>
    <p class="field" style="margin:0 0 8px">Isi pesan</p>
    <div id="blockList" class="block-list"></div>
    <div class="block-add">
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('text')">${icon('file', 15)} Teks</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('image')">${icon('eye', 15)} Gambar</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('button')">${icon('external', 15)} Tombol</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('divider')">${icon('menu', 15)} Pemisah</button>
    </div>
    <p class="hint" id="blockHint">Teks mendukung format Discord; baris diawali <code>-#</code> menjadi teks kecil.</p>
  </div>

  <div class="notice">${icon('alert', 16)}<span>Blok <b>Tombol</b> di atas adalah tombol <b>link</b> (membuka URL). Untuk tombol yang memberi role, pakai kartu <b>Tombol ambil role</b> di bawah.</span></div>

  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <button class="btn-primary" type="button" id="postSave" onclick="savePost()">${icon('check', 16)} Simpan</button>
    <button class="btn btn-ghost" type="button" id="postSend" onclick="sendPost()" ${options.botReady ? '' : 'disabled title="Bot offline"'}>${icon('external', 16)} Kirim ke Discord</button>
  </div>
</div>`,
  });

  const roleCard = card({
    title: 'Tombol ambil role',
    hint: `${options.hasManageRoles ? 'izin Manage Roles: ada' : 'izin Manage Roles: BELUM ADA'}`,
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:12px">
  ${
    options.botReady
      ? ''
      : '<p class="hint">Bot sedang offline, jadi daftar role tidak bisa dibaca. Jalankan bot untuk memakai tombol role.</p>'
  }
  ${
    options.hasManageRoles || !options.botReady
      ? ''
      : `<div class="notice">${icon('alert', 16)}<span>Bot belum punya izin <b>Manage Roles</b>, jadi tombol role akan gagal. Beri izinnya di Server Settings → Roles.</span></div>`
  }
  <div id="roleList" class="block-list"></div>
  <div class="block-add">
    <span class="select-shell full" style="max-width:320px">
      <select id="rolePick">
        <option value="">Pilih role…</option>
        ${options.roles
          .map(
            (r) =>
              `<option value="${esc(r.id)}"${r.blockedBy ? ' disabled' : ''}>${esc(r.name)}${
                r.blockedBy ? ` — ${esc(r.blockedBy)}` : ''
              }</option>`,
          )
          .join('')}
      </select>
      ${icon('chevron', 15)}
    </span>
    <button class="btn btn-ghost btn-sm" type="button" onclick="addRoleButton()">${icon('users', 15)} Tambah tombol</button>
  </div>
  <p class="hint">Tombol role tampil <b>di baris paling bawah</b> pesan. Klik member = beri role; klik lagi = lepas (kecuali mode "hanya beri").</p>
</div>`,
  });

  const body = `${pageHead({
    kicker: '09 — Pesan bertema',
    title: 'Pesan',
    subtitle: 'Susun pesan container sendiri: rules, ambil roles, pengumuman. Kirim sekali, lalu perbarui tanpa kirim ulang.',
    actions: badge(`${options.posts.length} pesan`, 'brand'),
  })}
<div class="grid cols-2">${listCard}${editorCard}</div>
${roleCard}
<script>
const GUILD = ${jsonForScript(options.guildId)};
/** Daftar role server + alasan tidak bisa dibagi (kalau ada). */
var ROLES = ${jsonForScript(options.roles)};
/** Tombol role per pesan: { pesanId: [...] }. */
var ROLE_BUTTONS = ${jsonForScript(options.roleButtons)};
/** Tombol role yang sedang disusun (belum disimpan). */
var roleButtons = [];
var roleEditingId = null;
/** Blok yang sedang disusun. Disimpan sebagai data, bukan HTML. */
var blocks = [];
/** ID pesan yang sedang diubah (null = pesan baru). */
var editingId = null;

var LABEL = { text: 'Teks', image: 'Gambar', button: 'Tombol', divider: 'Pemisah' };

function lineCount(value) {
  return String(value || '').split('\\n').length;
}

function renderBlocks() {
  var host = document.getElementById('blockList');
  host.innerHTML = '';
  if (blocks.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.textContent = 'Belum ada isi. Tambahkan blok di bawah.';
    host.appendChild(kosong);
    return;
  }

  blocks.forEach(function (block, index) {
    var row = document.createElement('div');
    row.className = 'block-row';

    var head = document.createElement('div');
    head.className = 'block-head';
    var label = document.createElement('span');
    label.className = 'block-kind';
    label.textContent = LABEL[block.kind] || block.kind;
    head.appendChild(label);

    var tools = document.createElement('div');
    tools.className = 'block-tools';
    if (index > 0) {
      var up = document.createElement('button');
      up.className = 'btn-ghost btn-sm btn-icon';
      up.type = 'button';
      up.title = 'Naikkan';
      up.textContent = '↑';
      up.onclick = function () { moveBlock(index, -1); };
      tools.appendChild(up);
    }
    if (index < blocks.length - 1) {
      var down = document.createElement('button');
      down.className = 'btn-ghost btn-sm btn-icon';
      down.type = 'button';
      down.title = 'Turunkan';
      down.textContent = '↓';
      down.onclick = function () { moveBlock(index, 1); };
      tools.appendChild(down);
    }
    var del = document.createElement('button');
    del.className = 'btn-danger btn-sm btn-icon';
    del.type = 'button';
    del.title = 'Hapus blok';
    del.textContent = '×';
    del.onclick = function () { removeBlock(index); };
    tools.appendChild(del);
    head.appendChild(tools);
    row.appendChild(head);

    if (block.kind === 'divider') {
      var garis = document.createElement('div');
      garis.className = 'block-divider';
      row.appendChild(garis);
    } else if (block.kind === 'text') {
      var ta = document.createElement('textarea');
      ta.rows = Math.min(10, Math.max(2, lineCount(block.value)));
      ta.value = block.value;
      ta.placeholder = 'Tulis isi pesan…';
      ta.oninput = function () { blocks[index].value = ta.value; };
      row.appendChild(ta);
    } else {
      var input = document.createElement('input');
      input.type = 'text';
      input.value = block.value;
      input.placeholder = block.kind === 'image' ? 'https://…/gambar.png' : 'Label tombol';
      input.oninput = function () { blocks[index].value = input.value; };
      row.appendChild(input);
      if (block.kind === 'button') {
        var url = document.createElement('input');
        url.type = 'text';
        url.value = block.url || '';
        url.placeholder = 'https://discord.gg/…';
        url.oninput = function () { blocks[index].url = url.value; };
        row.appendChild(url);
      }
    }
    host.appendChild(row);
  });
}

function addBlock(kind) {
  blocks.push({ kind: kind, value: '', url: '' });
  renderBlocks();
}
function removeBlock(index) {
  blocks.splice(index, 1);
  renderBlocks();
}
function moveBlock(index, delta) {
  var target = index + delta;
  if (target < 0 || target >= blocks.length) return;
  var tmp = blocks[index];
  blocks[index] = blocks[target];
  blocks[target] = tmp;
  renderBlocks();
}

function payloadBlocks() {
  return blocks.filter(function (b) {
    if (b.kind === 'divider') return true;
    return String(b.value || '').trim().length > 0;
  });
}

async function savePost(andSend) {
  var name = document.getElementById('postName').value.trim();
  var channelId = document.getElementById('postChannel').value || null;
  if (!name) return toast('Nama pesan masih kosong', true);
  var isi = payloadBlocks();
  if (isi.length === 0) return toast('Isi pesan masih kosong', true);

  var button = document.getElementById('postSave');
  button.disabled = true;
  try {
    var path = editingId ? '/api/posts/' + editingId : '/api/posts';
    var result = await api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name, channelId: channelId, blocks: isi }),
    });
    if (result.dropped && result.dropped.length) {
      toast('Sebagian blok dibuang: ' + result.dropped[0], true);
    } else {
      toast('✅ Pesan tersimpan');
    }
    // Tombol role disimpan setelah pesan punya ID — endpoint-nya per pesan.
    await saveRoleButtons(result.post.id);

    if (andSend) {
      await api('/api/posts/' + result.post.id + '/send', { method: 'POST' });
      toast('✅ Terkirim ke Discord');
    }
    setTimeout(function () { location.href = '/pesan'; }, 500);
  } catch (error) {
    toast('Gagal: ' + error.message, true);
    button.disabled = false;
  }
}

async function sendPost() {
  var name = document.getElementById('postName').value.trim();
  if (!editingId && !name) return toast('Simpan dulu, baru kirim', true);
  await savePost(true);
}

async function removePost(id, name) {
  var ok = await askConfirm('Hapus pesan?', '"' + name + '" akan dihapus dari dashboard. Pesan yang sudah terkirim di Discord TIDAK ikut terhapus.');
  if (!ok) return;
  try {
    await api('/api/posts/' + id, { method: 'DELETE' });
    toast('✅ Pesan dihapus');
    setTimeout(function () { location.reload(); }, 400);
  } catch (error) {
    toast('Gagal: ' + error.message, true);
  }
}

/** Muat pesan yang mau diubah (dari ?id=). */
function loadExisting() {
  var existing = ${jsonForScript(
    options.posts.map((p) => ({
      id: p.id,
      name: p.name,
      channelId: p.channelId,
      blocks: p.blocks,
    })),
  )};
  var id = Number(new URLSearchParams(location.search).get('id'));
  if (!id) return;
  var found = existing.find(function (p) { return p.id === id; });
  if (!found) return;
  editingId = found.id;
  document.getElementById('postName').value = found.name;
  document.getElementById('postChannel').value = found.channelId || '';
  blocks = found.blocks.map(function (b) {
    return { kind: b.kind, value: b.value || '', url: b.url || '' };
  });
  var send = document.getElementById('postSend');
  if (send) send.textContent = 'Simpan & kirim ulang';
  loadRoleButtonsFor(found.id);
  renderRoleButtons();
  renderBlocks();
}


/* ---------------- Tombol ambil role ---------------- */

function roleById(id) {
  return ROLES.find(function (r) { return r.id === id; }) || null;
}

/** Gambar ulang daftar tombol role yang sedang disusun. */
function renderRoleButtons() {
  var host = document.getElementById('roleList');
  if (!host) return;
  host.innerHTML = '';
  if (roleButtons.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.textContent = 'Belum ada tombol role. Pilih role di atas, lalu "Tambah tombol".';
    host.appendChild(kosong);
    return;
  }

  roleButtons.forEach(function (tombol, index) {
    var role = roleById(tombol.roleId);
    var row = document.createElement('div');
    row.className = 'block-row';

    var head = document.createElement('div');
    head.className = 'block-head';
    var jenis = document.createElement('span');
    jenis.className = 'block-kind';
    jenis.textContent = role ? ('@' + role.name) : 'role terhapus';
    head.appendChild(jenis);

    var tools = document.createElement('div');
    tools.className = 'block-tools';

    // Mode: toggle (klik lagi melepas) atau hanya memberi.
    var mode = document.createElement('select');
    mode.className = 'role-mode';
    [['toggle', 'klik = pasang/lepas'], ['give', 'hanya beri']].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
      if ((tombol.mode || 'toggle') === opt[0]) o.selected = true;
      mode.appendChild(o);
    });
    mode.onchange = function () { roleButtons[index].mode = mode.value; };
    tools.appendChild(mode);

    var del = document.createElement('button');
    del.className = 'btn-danger btn-sm btn-icon';
    del.type = 'button';
    del.title = 'Hapus tombol';
    del.textContent = '×';
    del.onclick = function () { roleButtons.splice(index, 1); renderRoleButtons(); };
    tools.appendChild(del);
    head.appendChild(tools);
    row.appendChild(head);

    var input = document.createElement('input');
    input.type = 'text';
    input.value = tombol.label || '';
    input.placeholder = 'Label tombol, mis. Ambil role Gamer';
    input.oninput = function () { roleButtons[index].label = input.value; };
    row.appendChild(input);

    if (role && role.blockedBy) {
      var warn = document.createElement('p');
      warn.className = 'hint';
      warn.style.color = 'var(--warn, #ffb454)';
      warn.textContent = 'Akan gagal: ' + role.blockedBy;
      row.appendChild(warn);
    }
    host.appendChild(row);
  });
}

function addRoleButton() {
  var pick = document.getElementById('rolePick');
  if (!pick || !pick.value) return toast('Pilih role dulu', true);
  if (roleButtons.some(function (b) { return b.roleId === pick.value; })) {
    return toast('Role itu sudah punya tombol', true);
  }
  var role = roleById(pick.value);
  roleButtons.push({
    roleId: pick.value,
    label: 'Ambil role ' + (role ? role.name : ''),
    mode: 'toggle',
  });
  pick.value = '';
  renderRoleButtons();
}

/**
 * Simpan tombol role. Dipanggil sebelum/sesudah menyimpan pesan.
 *
 * Dijalankan sebagai bagian dari savePost supaya admin tidak perlu menekan
 * tombol "simpan role" terpisah — satu tombol Simpan untuk semuanya.
 */
async function saveRoleButtons(postId) {
  var result = await api('/api/posts/' + postId + '/roles', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buttons: roleButtons }),
  });
  if (result.dropped && result.dropped.length) {
    toast('Sebagian tombol role dibuang: ' + result.dropped[0], true);
  }
  return result;
}

/** Muat tombol role saat mengubah pesan yang sudah punya tombol. */
function loadRoleButtonsFor(postId) {
  roleButtons = (ROLE_BUTTONS[postId] || []).map(function (b) {
    return { roleId: b.roleId, label: b.label, mode: b.mode || 'toggle' };
  });
}

loadExisting();
renderBlocks();
renderRoleButtons();
</script>`;

  return appShell({
    active: 'pesan' as PageKey,
    title: 'Pesan',
    subtitle: 'Pesan container buatan admin',
    guildId: options.guildId,
    guildName: options.guildName,
    body,
    status: options.status,
    counts: options.counts,
  });
}
