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

export interface RoleOptionView {
  id: string;
  name: string;
  color: string;
  position: number;
  /** null = role bisa dibagi; selain itu alasannya. */
  blockedBy: string | null;
}

export interface PostRowView {
  id: number;
  name: string;
  channelId: string | null;
  blocks: PostBlock[];
  messageId: string | null;
  updatedAt: number;
  /** Warna aksen `#rrggbb`; null = bawaan. */
  accent: string | null;
  /** `webhook` = tampil atas nama server. */
  sender: 'bot' | 'webhook';
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
  roleButtons: Record<
    number,
    Array<{ id: number; roleId: string; label: string; mode: string; emoji: string | null; style: string }>
  >;
  /** Dropdown role per pesan (pesanId -> menu). */
  roleMenus: Record<
    number,
    Array<{
      id: number;
      placeholder: string;
      minValues: number;
      maxValues: number;
      exclusive: boolean;
      options: Array<{ roleId: string; label: string; emoji: string | null; description: string | null }>;
    }>
  >;
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
  /*
   * `JSON.stringify(undefined)` mengembalikan `undefined` (bukan string), dan
   * `.replace` di atasnya akan melempar — halaman ikut gagal dirender hanya
   * karena satu opsi tidak diisi. Dulu itu nyata terjadi saat `roleMenus`
   * ditambahkan tapi pemanggil lama belum mengirimnya.
   */
  const json = JSON.stringify(value === undefined ? null : value) ?? 'null';
  return json
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

  <div class="grid cols-2" style="gap:12px">
    <div>
      <label class="field" for="postAccent">Warna aksen</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="color" id="postAccent" value="#6d8cff" style="width:48px;height:38px;padding:2px;border-radius:8px;border:1px solid var(--line);background:var(--panel)">
        <span class="hint" id="accentText">#6d8cff</span>
        <button class="btn btn-ghost btn-sm" type="button" onclick="resetAccent()">Bawaan</button>
      </div>
    </div>
    <div>
      <label class="field" for="postSender">Pengirim</label>
      <span class="select-shell full">
        <select id="postSender">
          <option value="bot">Bot (bisa tombol ambil role)</option>
          <option value="webhook">Atas nama server (butuh Manage Webhooks)</option>
        </select>
        ${icon('chevron', 15)}
      </span>
      <p class="hint">Lewat webhook, pesan tampil dengan nama &amp; logo server — tapi tombol ambil role tidak bisa dipakai.</p>
    </div>
  </div>

  <div class="notice">${icon('alert', 16)}<span>Blok <b>Tombol</b> di atas adalah tombol <b>link</b> (membuka URL). Untuk tombol yang memberi role, pakai kartu <b>Tombol ambil role</b> di bawah.</span></div>

  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <button class="btn-primary" type="button" id="postSave" onclick="savePost()">${icon('check', 16)} Simpan</button>
    <button class="btn btn-ghost" type="button" id="postSend" onclick="sendPost()" ${options.botReady ? '' : 'disabled title="Bot offline"'}>${icon('external', 16)} Kirim ke Discord</button>
  </div>
</div>`,
  });

  const previewCard = card({
    title: 'Pratinjau',
    hint: 'tampil seperti di Discord',
    body: `<div id="previewHost" class="preview-wrap"></div>`,
  });

  const roleCard = card({
    title: 'Tombol & menu ambil role',
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
  <hr class="sep" />
  <div class="subhead">${icon('menu', 15)} Menu dropdown role</div>
  <div id="menuList" class="block-list"></div>
  <div class="block-add">
    <button class="btn btn-ghost btn-sm" type="button" onclick="addRoleMenu()">${icon('plus', 15)} Tambah menu</button>
  </div>
  <p class="hint">Dropdown dipakai kalau role-nya banyak: satu menu bisa memuat sampai 25 pilihan. Aktifkan <b>hanya satu pilihan</b> untuk membuatnya eksklusif — memilih role baru otomatis mencabut role lain di menu yang sama.</p>
</div>`,
  });

  const body = `${pageHead({
    kicker: '09 — Pesan bertema',
    title: 'Pesan',
    subtitle: 'Susun pesan container sendiri: rules, ambil roles, pengumuman. Kirim sekali, lalu perbarui tanpa kirim ulang.',
    actions: badge(`${options.posts.length} pesan`, 'brand'),
  })}
<div class="grid cols-2">${listCard}${editorCard}</div>
${previewCard}
${roleCard}
<script>
const GUILD = ${jsonForScript(options.guildId)};
/** Daftar role server + alasan tidak bisa dibagi (kalau ada). */
var ROLES = ${jsonForScript(options.roles)};
/** Tombol role per pesan: { pesanId: [...] }. */
var ROLE_BUTTONS = ${jsonForScript(options.roleButtons)};
var ROLE_MENUS = ${jsonForScript(options.roleMenus ?? {})};
/** Tombol role yang sedang disusun (belum disimpan). */
var roleButtons = [];
/** Menu dropdown role yang sedang disusun (biasanya hanya satu). */
var roleMenus = [];
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
      ta.oninput = function () { blocks[index].value = ta.value; renderPreview(); };
      row.appendChild(ta);
    } else {
      var input = document.createElement('input');
      input.type = 'text';
      input.value = block.value;
      input.placeholder = block.kind === 'image' ? 'https://…/gambar.png' : 'Label tombol';
      input.oninput = function () { blocks[index].value = input.value; renderPreview(); };
      row.appendChild(input);
      if (block.kind === 'button') {
        var url = document.createElement('input');
        url.type = 'text';
        url.value = block.url || '';
        url.placeholder = 'https://discord.gg/…';
        url.oninput = function () { blocks[index].url = url.value; };
        row.appendChild(url);
      }
      if (block.kind === 'image') {
        // Unggah dari komputer: hasilnya data URI yang disimpan di blok.
        // Discord menolak data URI mentah, jadi pengirim mengubahnya jadi
        // lampiran — di dashboard cukup ditampilkan sebagai gambar biasa.
        var baris = document.createElement('div');
        baris.style.display = 'flex';
        baris.style.gap = '8px';
        baris.style.alignItems = 'center';

        var file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/png,image/jpeg,image/webp';
        file.onchange = function () { unggahGambar(index, file); };
        baris.appendChild(file);

        if (block.data) {
          var kecil = document.createElement('img');
          kecil.src = block.data;
          kecil.alt = 'pratinjau unggahan';
          kecil.style.cssText = 'height:40px;border-radius:6px';
          baris.appendChild(kecil);

          var hapus = document.createElement('button');
          hapus.className = 'btn-ghost btn-sm';
          hapus.type = 'button';
          hapus.textContent = 'Pakai URL';
          hapus.onclick = function () { blocks[index].data = ''; renderBlocks(); };
          baris.appendChild(hapus);
        }
        row.appendChild(baris);
      }
    }
    host.appendChild(row);
  });
  renderPreview();
}

/** Batas unggahan gambar (sama dengan banner). */
var MAKS_GAMBAR = 4 * 1024 * 1024;

function unggahGambar(index, input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (file.size > MAKS_GAMBAR) {
    toast('Gambar terlalu besar (maksimal 4 MB)', true);
    input.value = '';
    return;
  }
  var pembaca = new FileReader();
  pembaca.onload = function () {
    blocks[index].data = String(pembaca.result);
    blocks[index].value = '';
    renderBlocks();
    renderPreview();
  };
  pembaca.onerror = function () { toast('Gagal membaca gambar', true); };
  pembaca.readAsDataURL(file);
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

/**
 * Blok yang benar-benar dikirim ke server.
 *
 * Gambar unggahan punya value KOSONG (gambarnya ada di field data), jadi
 * penyaringan tidak boleh hanya melihat value — kalau iya, setiap penyimpanan
 * membuang gambar yang baru saja diunggah admin.
 */
function payloadBlocks() {
  return blocks.filter(function (b) {
    if (b.kind === 'divider') return true;
    if (b.kind === 'image') return Boolean(b.data || String(b.value || '').trim());
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
      body: JSON.stringify({
        name: name,
        channelId: channelId,
        blocks: isi,
        accent: accentNow(),
        sender: (document.getElementById('postSender') || {}).value || 'bot',
      }),
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
      accent: p.accent,
      sender: p.sender,
    })),
  )};
  var id = Number(new URLSearchParams(location.search).get('id'));
  if (!id) return;
  var found = existing.find(function (p) { return p.id === id; });
  if (!found) return;
  editingId = found.id;
  document.getElementById('postName').value = found.name;
  document.getElementById('postChannel').value = found.channelId || '';
  if (found.accent) {
    var warna = document.getElementById('postAccent');
    if (warna) warna.value = found.accent;
  }
  if (found.sender) {
    var pengirim = document.getElementById('postSender');
    if (pengirim) pengirim.value = found.sender;
  }
  blocks = found.blocks.map(function (b) {
    // Field data WAJIB ikut. Tanpa ini, membuka pesan lama lalu menyimpan akan
    // membuang gambar unggahannya — pesan yang sudah rapi berubah jadi tanpa
    // gambar tanpa ada peringatan apa pun.
    return { kind: b.kind, value: b.value || '', url: b.url || '', data: b.data || '' };
  });
  var send = document.getElementById('postSend');
  if (send) send.textContent = 'Simpan & kirim ulang';
  loadRoleButtonsFor(found.id);
  renderRoleButtons();
  renderBlocks();
}


/* ---------------- Pratinjau ---------------- */

/** Warna aksen aktif. */
var ACCENT_DEFAULT = '#6d8cff';

function accentNow() {
  var el = document.getElementById('postAccent');
  return (el && el.value) || ACCENT_DEFAULT;
}

function resetAccent() {
  var el = document.getElementById('postAccent');
  if (el) el.value = ACCENT_DEFAULT;
  renderPreview();
}

/**
 * Gambar pratinjau dari blok yang sedang disusun.
 *
 * Semua isi dimasukkan lewat textContent / atribut, TIDAK lewat innerHTML.
 * Alasan: teks blok berasal dari admin dan bisa berisi apa saja; pratinjau
 * tidak boleh menjadi jalan masuk HTML ke halaman dashboard.
 */
function renderPreview() {
  var host = document.getElementById('previewHost');
  if (!host) return;
  host.innerHTML = '';

  var kartu = document.createElement('div');
  kartu.className = 'preview-container';
  kartu.style.borderLeftColor = accentNow();

  var isi = blocks.filter(function (b) {
    if (b.kind === 'divider') return true;
    if (b.kind === 'image') return Boolean(b.data || b.value);
    return String(b.value || '').trim().length > 0;
  });

  if (isi.length === 0 || !isi.some(function (b) { return b.kind === 'text' || b.kind === 'image'; })) {
    var kosong = document.createElement('div');
    kosong.className = 'pc-line pc-small';
    kosong.textContent = 'Belum ada isi — pesan kosong tidak bisa dikirim.';
    kartu.appendChild(kosong);
    host.appendChild(kartu);
    return;
  }

  var tertunda = [];
  function flushTombol() {
    for (var i = 0; i < tertunda.length; i += 5) {
      var baris = document.createElement('div');
      baris.className = 'pc-row';
      tertunda.slice(i, i + 5).forEach(function (t) {
        var b = document.createElement('span');
        b.className = 'pc-button pc-button-link';
        b.textContent = t.value;
        baris.appendChild(b);
      });
      kartu.appendChild(baris);
    }
    tertunda = [];
  }

  isi.forEach(function (blok) {
    if (blok.kind === 'button') { tertunda.push(blok); return; }
    if (tertunda.length) flushTombol();

    if (blok.kind === 'divider') {
      var sep = document.createElement('div');
      sep.className = 'pc-sep';
      kartu.appendChild(sep);
      return;
    }
    if (blok.kind === 'image') {
      if (blok.data) {
        var img = document.createElement('img');
        img.src = blok.data;
        img.className = 'pc-image';
        img.alt = 'gambar unggahan';
        kartu.appendChild(img);
      } else {
        var jauh = document.createElement('img');
        jauh.src = blok.value;
        jauh.className = 'pc-image';
        jauh.alt = '';
        jauh.onerror = function () {
          jauh.replaceWith(salinanTeks('[ gambar tidak bisa dimuat ]'));
        };
        kartu.appendChild(jauh);
      }
      return;
    }
    // Teks: -# di awal = teks kecil di Discord.
    var kecil = /^\s*-#/.test(blok.value);
    var teks = kecil ? blok.value.replace(/^\s*-#\s*/, '') : blok.value;
    var el = document.createElement('div');
    el.className = 'pc-line' + (kecil ? ' pc-small' : '');
    el.textContent = teks;
    kartu.appendChild(el);
  });
  if (tertunda.length) flushTombol();

  // Tombol role: baris paling bawah, sama seperti pesan sungguhan.
  for (var i = 0; i < roleButtons.length; i += 5) {
    var barisRole = document.createElement('div');
    barisRole.className = 'pc-row';
    roleButtons.slice(i, i + 5).forEach(function (r) {
      var b = document.createElement('span');
      b.className = 'pc-button pc-button-role' + (r.style && r.style !== 'primary' ? ' style-' + r.style : '');
      b.textContent = teksTombol(r);
      barisRole.appendChild(b);
    });
    kartu.appendChild(barisRole);
  }

  // Menu dropdown role, di bawah tombol.
  roleMenus.forEach(function (menu) {
    if (!menu.options || menu.options.length === 0) return;
    var kotak = document.createElement('div');
    kotak.className = 'pc-select';
    var judul = document.createElement('span');
    judul.textContent = menu.placeholder || 'Pilih role';
    kotak.appendChild(judul);
    kotak.insertAdjacentHTML('beforeend', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>');
    kartu.appendChild(kotak);

    // Discord menampilkan pilihan hanya saat dropdown dibuka; di pratinjau
    // sengaja ditampilkan semua supaya admin bisa memeriksa labelnya.
    menu.options.forEach(function (opsi) {
      var el = document.createElement('div');
      el.className = 'pc-select-opt';
      if (opsi.emoji) {
        var em = document.createElement('span');
        em.textContent = opsi.emoji;
        el.appendChild(em);
      }
      el.appendChild(document.createTextNode(opsi.label || '(tanpa label)'));
      if (opsi.description) {
        var ket = document.createElement('span');
        ket.className = 'pc-opt-desc';
        ket.textContent = opsi.description;
        el.appendChild(ket);
      }
      kartu.appendChild(el);
    });
  });

  host.appendChild(kartu);
}

/**
 * Emoji + label tombol untuk pratinjau.
 *
 * Emoji kustom berbentuk <:nama:id> tidak bisa digambar tanpa CDN, jadi yang
 * tampil hanya :nama: — cukup untuk memastikan admin memilih emoji yang benar.
 */
function teksTombol(tombol) {
  var label = tombol.label || '(tanpa label)';
  var emoji = tombol.emoji || '';
  if (!emoji) return label;
  var kustom = /^<a?:([a-zA-Z0-9_]{2,32}):\\d{15,25}>$/.exec(emoji);
  return (kustom ? ':' + kustom[1] + ':' : emoji) + ' ' + label;
}

function salinanTeks(isi) {
  var el = document.createElement('div');
  el.className = 'pc-line pc-small';
  el.textContent = isi;
  return el;
}

/* ---------------- Tombol ambil role ---------------- */

function roleById(id) {
  return ROLES.find(function (r) { return r.id === id; }) || null;
}

/** Gambar ulang daftar tombol role yang sedang disusun. */
function renderRoleButtons() {
  var host = document.getElementById('roleList');
  if (!host) return;
  renderPreview();
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
    del.onclick = function () { roleButtons.splice(index, 1); renderRoleButtons(); renderPreview(); };
    tools.appendChild(del);
    head.appendChild(tools);
    row.appendChild(head);

    var input = document.createElement('input');
    input.type = 'text';
    input.value = tombol.label || '';
    input.placeholder = 'Label tombol, mis. Ambil role Gamer';
    input.oninput = function () { roleButtons[index].label = input.value; renderPreview(); };
    row.appendChild(input);

    // Emoji + warna: dua hal yang membuat tombol mudah dibedakan sekilas.
    var gayaRow = document.createElement('div');
    gayaRow.className = 'role-style-row';

    var emoji = document.createElement('input');
    emoji.type = 'text';
    emoji.className = 'role-emoji';
    emoji.value = tombol.emoji || '';
    emoji.placeholder = '🎮';
    emoji.title = 'Emoji tombol — boleh emoji biasa atau <:nama:id>';
    emoji.oninput = function () {
      // Server tetap memvalidasi; di sini hanya dibatasi panjangnya supaya
      // kotak input tidak dipakai untuk menempel paragraf.
      roleButtons[index].emoji = emoji.value.slice(0, 80);
      renderPreview();
    };
    gayaRow.appendChild(emoji);

    var style = document.createElement('select');
    style.className = 'role-mode';
    [['primary', 'Biru'], ['secondary', 'Abu'], ['success', 'Hijau'], ['danger', 'Merah']].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
      if ((tombol.style || 'primary') === opt[0]) o.selected = true;
      style.appendChild(o);
    });
    style.onchange = function () { roleButtons[index].style = style.value; renderPreview(); };
    gayaRow.appendChild(style);
    row.appendChild(gayaRow);

    if (role && role.blockedBy) {
      var warn = document.createElement('p');
      warn.className = 'hint';
      warn.style.color = 'var(--warn, #ffb454)';
      warn.textContent = 'Akan gagal: ' + role.blockedBy;
      row.appendChild(warn);
    }
    host.appendChild(row);
  });
  renderPreview();
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
    emoji: '',
    style: 'primary',
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
    body: JSON.stringify({ buttons: roleButtons, menus: roleMenus }),
  });
  if (result.dropped && result.dropped.length) {
    toast('Sebagian tombol role dibuang: ' + result.dropped[0], true);
  }
  return result;
}

/* ---------------- Menu dropdown role ---------------- */

/**
 * Gambar ulang editor dropdown.
 *
 * Satu pesan biasanya cukup punya SATU menu; tetap disimpan sebagai array
 * supaya server dan penyusun payload tidak perlu dua bentuk data.
 */
function renderRoleMenus() {
  var host = document.getElementById('menuList');
  if (!host) return;
  host.innerHTML = '';

  if (roleMenus.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.textContent = 'Belum ada menu. Menu cocok kalau role-nya banyak (sampai 25 pilihan).';
    host.appendChild(kosong);
    renderPreview();
    return;
  }

  roleMenus.forEach(function (menu, index) {
    var kotak = document.createElement('div');
    kotak.className = 'block-row';

    var head = document.createElement('div');
    head.className = 'block-head';
    var jenis = document.createElement('span');
    jenis.className = 'block-kind';
    jenis.textContent = 'menu ' + (index + 1) + ' · ' + (menu.options.length) + ' pilihan';
    head.appendChild(jenis);

    var hapus = document.createElement('button');
    hapus.className = 'btn-danger btn-sm btn-icon';
    hapus.type = 'button';
    hapus.title = 'Hapus menu';
    hapus.textContent = '×';
    hapus.onclick = function () { roleMenus.splice(index, 1); renderRoleMenus(); renderPreview(); };
    head.appendChild(hapus);
    kotak.appendChild(head);

    var placeholder = document.createElement('input');
    placeholder.type = 'text';
    placeholder.value = menu.placeholder || '';
    placeholder.placeholder = 'Teks ajakan, mis. Pilih warna namamu';
    placeholder.oninput = function () {
      roleMenus[index].placeholder = placeholder.value;
      renderPreview();
    };
    kotak.appendChild(placeholder);

    // Pengaturan: eksklusif + batas pilihan.
    var flags = document.createElement('div');
    flags.className = 'menu-flags';

    var eksklusif = document.createElement('label');
    eksklusif.className = 'menu-flags';
    var cek = document.createElement('input');
    cek.type = 'checkbox';
    cek.checked = !!menu.exclusive;
    cek.onchange = function () {
      roleMenus[index].exclusive = cek.checked;
      // Eksklusif berarti tepat satu pilihan — batasnya ikut disetel supaya
      // admin tidak menyimpan kombinasi yang saling bertentangan.
      if (cek.checked) {
        roleMenus[index].minValues = 1;
        roleMenus[index].maxValues = 1;
        renderRoleMenus();
      }
      renderPreview();
    };
    eksklusif.appendChild(cek);
    eksklusif.appendChild(document.createTextNode(' hanya satu pilihan (eksklusif)'));
    flags.appendChild(eksklusif);
    kotak.appendChild(flags);

    if (!menu.exclusive) {
      var batas = document.createElement('div');
      batas.className = 'role-style-row';
      [['minValues', 'min'], ['maxValues', 'maks']].forEach(function (pasangan) {
        var label = document.createElement('span');
        label.className = 'hint';
        label.textContent = pasangan[1];
        var num = document.createElement('input');
        num.type = 'number';
        num.min = '1';
        num.max = String(Math.max(1, menu.options.length));
        num.value = String(menu[pasangan[0]] || 1);
        num.style.width = '64px';
        num.onchange = function () {
          var n = parseInt(num.value, 10);
          if (!isFinite(n) || n < 1) n = 1;
          if (n > menu.options.length) n = Math.max(1, menu.options.length);
          roleMenus[index][pasangan[0]] = n;
          // min tidak boleh melebihi maks.
          if (roleMenus[index].minValues > roleMenus[index].maxValues) {
            roleMenus[index].maxValues = roleMenus[index].minValues;
          }
          renderRoleMenus();
          renderPreview();
        };
        batas.appendChild(label);
        batas.appendChild(num);
      });
      kotak.appendChild(batas);
    }
    kotak.appendChild(pilihanMenu(menu, index));

    var tambahOpsi = document.createElement('div');
    tambahOpsi.className = 'block-add';
    var pick = document.createElement('select');
    pick.innerHTML = '<option value="">Pilih role untuk ditambahkan…</option>' + ROLES.filter(function (r) {
      return !menu.options.some(function (o) { return o.roleId === r.id; });
    }).map(function (r) {
      return '<option value="' + r.id + '"' + (r.blockedBy ? ' disabled' : '') + '>' +
        (r.name || '') + (r.blockedBy ? ' — ' + r.blockedBy : '') + '</option>';
    }).join('');
    pick.style.maxWidth = '320px';
    pick.className = 'role-mode';
    var tombol = document.createElement('button');
    tombol.className = 'btn btn-ghost btn-sm';
    tombol.type = 'button';
    tombol.textContent = 'Tambah pilihan';
    tombol.onclick = function () {
      if (!pick.value) return toast('Pilih role dulu', true);
      if (menu.options.length >= 25) return toast('Satu menu maksimal 25 pilihan', true);
      var role = roleById(pick.value);
      menu.options.push({
        roleId: pick.value,
        label: role ? role.name : pick.value,
        emoji: '',
        description: '',
      });
      renderRoleMenus();
      renderPreview();
    };
    tambahOpsi.appendChild(pick);
    tambahOpsi.appendChild(tombol);
    kotak.appendChild(tambahOpsi);

    host.appendChild(kotak);
  });
  renderPreview();
}

/** Daftar pilihan di dalam satu menu, masing-masing bisa diatur. */
function pilihanMenu(menu, menuIndex) {
  var bungkus = document.createElement('div');
  bungkus.className = 'block-list';

  menu.options.forEach(function (opsi, ops) {
    var kotak = document.createElement('div');
    kotak.className = 'menu-opt';

    var head = document.createElement('div');
    head.className = 'menu-opt-head';
    var role = roleById(opsi.roleId);
    var dot = document.createElement('span');
    dot.className = 'role-dot';
    dot.style.background = role && role.color ? role.color : 'var(--text-3)';
    head.appendChild(dot);
    head.appendChild(document.createTextNode(role ? '@' + role.name : 'role terhapus'));
    var hapus = document.createElement('button');
    hapus.className = 'btn-danger btn-sm btn-icon';
    hapus.type = 'button';
    hapus.title = 'Hapus pilihan';
    hapus.textContent = '×';
    hapus.style.marginLeft = 'auto';
    hapus.onclick = function () {
      menu.options.splice(ops, 1);
      renderRoleMenus();
      renderPreview();
    };
    head.appendChild(hapus);
    kotak.appendChild(head);

    var label = document.createElement('input');
    label.type = 'text';
    label.value = opsi.label || '';
    label.placeholder = 'Label pilihan';
    label.oninput = function () { menu.options[ops].label = label.value; renderPreview(); };
    kotak.appendChild(label);

    var baris = document.createElement('div');
    baris.className = 'role-style-row';
    var emoji = document.createElement('input');
    emoji.type = 'text';
    emoji.className = 'role-emoji';
    emoji.value = opsi.emoji || '';
    emoji.placeholder = '🎨';
    emoji.oninput = function () { menu.options[ops].emoji = emoji.value.slice(0, 80); renderPreview(); };
    baris.appendChild(emoji);

    var ket = document.createElement('input');
    ket.type = 'text';
    ket.value = opsi.description || '';
    ket.placeholder = 'Keterangan kecil (opsional)';
    ket.oninput = function () { menu.options[ops].description = ket.value.slice(0, 100); renderPreview(); };
    baris.appendChild(ket);
    kotak.appendChild(baris);

    if (role && role.blockedBy) {
      var warn = document.createElement('p');
      warn.className = 'hint';
      warn.style.color = 'var(--warn, #ffb454)';
      warn.textContent = 'Akan gagal: ' + role.blockedBy;
      kotak.appendChild(warn);
    }
    bungkus.appendChild(kotak);
  });

  if (menu.options.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.textContent = 'Menu tanpa pilihan tidak akan dikirim — tambahkan minimal satu role.';
    bungkus.appendChild(kosong);
  }
  return bungkus;
}

/** Tambah satu menu kosong (maksimal 5 per pesan, sama seperti server). */
function addRoleMenu() {
  if (roleMenus.length >= 5) return toast('Maksimal 5 menu per pesan', true);
  roleMenus.push({
    placeholder: 'Pilih role',
    minValues: 1,
    maxValues: 1,
    exclusive: false,
    options: [],
  });
  renderRoleMenus();
}

/** Muat tombol role saat mengubah pesan yang sudah punya tombol. */
function loadRoleButtonsFor(postId) {
  roleButtons = (ROLE_BUTTONS[postId] || []).map(function (b) {
    return {
      roleId: b.roleId,
      label: b.label,
      mode: b.mode || 'toggle',
      emoji: b.emoji || '',
      style: b.style || 'primary',
    };
  });
  // Dicopy dalam, bukan referensi ke ROLE_MENUS: editor mengubah objek ini
  // saat admin menyusun, dan objek sumber harus tetap utuh sampai disimpan.
  roleMenus = (ROLE_MENUS[postId] || []).map(function (m) {
    return {
      placeholder: m.placeholder,
      minValues: m.minValues,
      maxValues: m.maxValues,
      exclusive: !!m.exclusive,
      options: (m.options || []).map(function (o) {
        return { roleId: o.roleId, label: o.label, emoji: o.emoji || '', description: o.description || '' };
      }),
    };
  });
  renderRoleMenus();
}

// Pemantau perubahan warna aksen — pratinjau ikut berubah saat digeser.
(function pantauWarna() {
  var el = document.getElementById('postAccent');
  if (!el) return;
  el.addEventListener('input', function () {
    var teks = document.getElementById('accentText');
    if (teks) teks.textContent = el.value;
    renderPreview();
  });
})();

loadExisting();
renderBlocks();
renderRoleButtons();
renderPreview();
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
