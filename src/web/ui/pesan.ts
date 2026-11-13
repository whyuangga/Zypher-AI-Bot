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
  /** Pemicu kirim otomatis (`member_add`/`member_remove`); null = manual. */
  trigger?: 'member_add' | 'member_remove' | null;
  /** Bentuk pesan: container (Components V2) atau embed klasik. */
  layout?: 'container' | 'embed';
}

/** Satu pesan di dalam dokumen multi-pesan (bentuk dari post-series.ts). */
export interface SeriesMessageView {
  id: string;
  name: string;
  blocks: PostBlock[];
  reference?: string;
  threadName?: string;
  flags?: number;
}

/** Dokumen multi-pesan tersimpan (`?grup=`). */
export interface PostDocumentView {
  id: number;
  name: string;
  series: boolean;
  messages: SeriesMessageView[];
  updatedAt: number;
}

export interface PesanPageOptions extends PageContext {
  posts: PostRowView[];
  /** Dokumen multi-pesan yang bisa dibuka lagi lewat `?grup=`. */
  documents?: PostDocumentView[];
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
  /**
   * Aksi komponen per pesan: `{ 'button:12': [aksi…], 'select:string': […] }`.
   *
   * Kunci target memakai prefix yang sama dengan yang dipakai bot, jadi
   * dashboard dan bot tidak perlu tabel terjemahan.
   */
  postActions?: Record<number, Record<string, unknown[]>>;
  /**
   * Batas flow dari `ACTION_LIMITS` di server.
   *
   * Dikirim ke browser supaya pesan "maksimal 6 aksi per komponen" / "15 aksi
   * kirim pesan" di layar admin berasal dari angka yang sama dengan yang
   * ditegakkan sanitizer — bukan angka yang ditulis ulang di JavaScript.
   */
  aksiLimits?: {
    perKomponen: number;
    countedPerFlow: number;
    messagePerFlow: number;
    branchDepth: number;
  };
  /**
   * Jadwal kirim per pesan (`dueAt` = waktu kirim berikutnya, epoch ms).
   *
   * Dikirim bersama daftar pesan supaya editor bisa menampilkan "dikirim
   * otomatis tiap …" tanpa permintaan tambahan per pesan.
   */
  schedules?: Record<number, Array<{ dueAt: number; repeatMinutes: number; lastSentAt: number | null }>>;
  /**
   * Riwayat versi per pesan (yang terbaru lebih dulu).
   *
   * Dikirim sekalian dengan daftar pesan: riwayat dibuka dari tombol di daftar
   * pesan yang belum tentu pesan itu sedang dibuka di editor, dan memuatnya
   * lewat permintaan terpisah berarti daftar pesan tampil dulu tanpa riwayat.
   * Isinya ringkas (tanpa blok penuh) supaya halaman tidak membengkak.
   */
  revisions?: Record<number, Array<{ id: number; name: string; createdAt: number; ringkas: string }>>;
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
          /*
           * Pemicu ditampilkan di daftar, bukan hanya di tab Susun: pesan yang
           * mengirim sendiri tiap ada member masuk adalah hal yang harus
           * langsung terlihat, bukan kejutan saat anggota bergabung.
           */
          const pemicu =
            post.trigger === 'member_add'
              ? badge('member masuk', 'warn')
              : post.trigger === 'member_remove'
                ? badge('member keluar', 'warn')
                : '';
          return `<div class="list-row">
  <span class="avatar-sm">${icon('file', 15)}</span>
  <div class="list-body">
    <div class="list-title">${esc(post.name)} ${status}${pemicu}</div>
    <div class="list-text">${esc(summarize(post.blocks))}</div>
    <div class="list-meta">diperbarui ${esc(relativeTime(post.updatedAt))}</div>
  </div>
  <div class="list-actions">
    <a class="btn btn-ghost btn-sm" href="/pesan?id=${post.id}">${icon('sliders', 15)} Ubah</a>
    <a class="btn btn-ghost btn-sm" href="/pesan?id=${post.id}#riwayat">${icon('history', 15)} Riwayat</a>
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

  /**
   * Isi tab Impor: dua panel yang dulu menumpuk di bawah editor blok.
   *
   * Dipisah ke sini (bukan ditulis ulang di dua tempat) supaya kotak tautan
   * Discohook, tombol ekspor, dan kotak JSON tetap satu sumber.
   */
  const imporHtml = `
    <details class="json-panel" open>
      <summary>${icon('download', 15)} Muat pesan Discord yang sudah terkirim</summary>
      <div class="json-isi">
        <p class="hint" style="margin:0">Klik kanan pesan di Discord → <b>Copy Message Link</b>, lalu tempel di sini. Pesan itu dimuat ke editor supaya bisa diperbaiki dan dikirim ulang — sama seperti tombol <b>Load</b> di Discohook. Bot harus punya izin <b>Read Message History</b> di channel tersebut.</p>
        <input type="text" id="muatTautan" placeholder="https://discord.com/channels/…/…/…" spellcheck="false" />
        <div class="json-aksi">
          <button class="btn btn-ghost btn-sm" type="button" onclick="muatPesanDiscord()">${icon('download', 15)} Muat pesan</button>
          <span class="hint" id="muatStatus" style="margin:0"></span>
        </div>
        <div id="muatSumber" class="hint" style="margin:0"></div>
      </div>
    </details>

    <details class="json-panel">
      <summary>${icon('external', 15)} Impor dari Discohook</summary>
      <div class="json-isi">
        <p class="hint" style="margin:0">Tempel <b>tautan share Discohook</b> (mis. <code>https://discohook.app/?share=abcdefgh</code>) atau <b>ID</b>-nya saja, lalu klik Tarik. Server yang mengunduh, jadi tidak kena masalah CORS. Kalau discohook.app tidak bisa dihubungi, salin JSON-nya dari Discohook (<i>Share → Copy JSON</i>) dan tempel di kotak yang sama — keduanya diterima.</p>
        <textarea id="discoText" rows="5" spellcheck="false" placeholder="https://discohook.app/?share=…  — atau tempel JSON Discohook di sini"></textarea>
        <div class="json-aksi">
          <button class="btn btn-ghost btn-sm" type="button" onclick="importDiscohook()">${icon('download', 15)} Tarik &amp; impor</button>
          <span class="hint" id="discoStatus" style="margin:0"></span>
        </div>
      </div>
    </details>

    <details class="json-panel">
      <summary>${icon('file', 15)} Import / ekspor JSON</summary>
      <div class="json-isi">
        <p class="hint" style="margin:0">Untuk memindahkan susunan pesan ke server lain, atau menyimpan cadangan sebelum mengubah banyak hal. Channel tujuan sengaja <b>tidak</b> ikut — ID channel berbeda di tiap server.</p>
        <div class="json-aksi">
          <button class="btn btn-ghost btn-sm" type="button" onclick="exportJson()">${icon('upload', 15)} Ekspor</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="importJson()">${icon('download', 15)} Impor</button>
          <span class="hint" id="jsonStatus" style="margin:0"></span>
        </div>
        <textarea id="jsonText" rows="8" spellcheck="false" placeholder="Klik Ekspor untuk mengisi, atau tempel JSON di sini lalu klik Impor."></textarea>
      </div>
    </details>

    <details class="json-panel">
      <summary>${icon('cpu', 15)} JSON payload &amp; generator kode</summary>
      <div class="json-isi">
        <p class="hint" style="margin:0">
          Isinya payload yang <b>benar-benar dikirim</b> ke Discord (hasil penyusun yang sama dengan tombol Kirim), bukan terjemahan dari editor.
          Generator kode membaca payload itu juga, jadi kode yang dihasilkan tidak bisa menyimpang dari pesan yang tampil.
        </p>
        <div class="json-aksi">
          <button class="btn btn-ghost btn-sm" type="button" onclick="muatPayloadJson()">${icon('download', 15)} Muat payload</button>
          <span class="select-shell" style="max-width:190px">
            <select id="codegenLib" onchange="muatPayloadJson()">
              <option value="djs14">discord.js v14</option>
              <option value="dpy2">discord.py v2</option>
            </select>
          </span>
          <button class="btn btn-ghost btn-sm" type="button" onclick="salinKode()">${icon('copy', 15)} Salin kode</button>
          <span class="hint" id="codegenStatus" style="margin:0"></span>
        </div>
        <label class="field" for="payloadJson">Payload komponen (JSON Discord)</label>
        <textarea id="payloadJson" rows="10" spellcheck="false" readonly placeholder="Klik Muat payload untuk mengisi dari pesan yang tersimpan."></textarea>
        <label class="field" for="codegenOut">Kode</label>
        <textarea id="codegenOut" rows="12" spellcheck="false" readonly placeholder="Kode muncul di sini."></textarea>
        <p class="hint" id="codegenDocs" style="margin:0"></p>
      </div>
    </details>
  `;

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
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('container')">${icon('sliders', 15)} Container</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('section')">${icon('users', 15)} Section</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('file')">${icon('download', 15)} File</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('select')">${icon('menu', 15)} Select menu</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('row')">${icon('sliders', 15)} Baris baru</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="addBlock('close')">${icon('logout', 15)} Tutup kartu</button>
    </div>
    <div id="usageBar" class="usage-bar" hidden>
      <span id="usageText">0/40 komponen</span>
      <span class="usage-track"><span id="usageFill" class="usage-fill"></span></span>
      <span id="usageWarn" class="usage-warn"></span>
    </div>
    <p class="hint" id="blockHint">Teks mendukung format Discord; baris diawali <code>-#</code> menjadi teks kecil. <b>Container</b> memulai kartu baru (blok sesudahnya masuk ke kartu itu), <b>Section</b> menaruh gambar kecil atau tombol di samping teks. <b>Select menu</b> memakai satu baris penuh, dan <b>Baris baru</b> memotong deretan tombol jadi baris berikutnya — sama seperti Row di Discohook.</p>

  </div>

  <div class="notice">${icon('alert', 16)}<span>Blok <b>Tombol</b> di atas adalah tombol <b>link</b> (membuka URL). Untuk tombol yang memberi role, lihat tab <b>Ambil role</b>.</span></div>
</div>`,
  });

  /**
   * Kartu pratinjau.
   *
   * `hostId` wajib berbeda per pemakaian: halaman memakai pratinjau dua kali
   * (menempel di tab Susun, dan besar di tab Pratinjau). Dua elemen ber-id
   * sama membuat `getElementById` selalu mengambil yang pertama, sehingga
   * salah satu pratinjau tidak pernah diperbarui.
   */
  const previewCard = (hostId: string): string =>
    card({
      title: 'Pratinjau',
      hint: 'tampil seperti di Discord',
      body: `<div id="${hostId}" class="preview-wrap"></div>`,
    });

  const settingCard = card({
    title: 'Tampilan & pengirim',
    hint: 'berlaku untuk seluruh pesan',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <div style="grid-column:1/-1">
    <label class="field" for="postLayout">Bentuk pesan</label>
    <span class="select-shell full">
      <select id="postLayout" onchange="renderPreview()">
        <option value="container">Container (Components V2)</option>
        <option value="embed">Embed klasik</option>
      </select>
      ${icon('chevron', 15)}
    </span>
    <p class="hint">Container: tampilan modern dengan kartu berwarna. Embed klasik: bentuk lama yang tetap rapi di notifikasi. Keduanya tidak bisa dicampur dalam satu pesan.</p>
  </div>
  <div>
    <label class="field" for="postAccent">Warna aksen</label>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="color" id="postAccent" value="#6d8cff" style="width:48px;height:38px;padding:2px;border-radius:8px;border:1px solid var(--line);background:var(--panel)">
      <span class="hint" id="accentText" style="margin:0">#6d8cff</span>
      <button class="btn btn-ghost btn-sm" type="button" onclick="resetAccent()">Bawaan</button>
    </div>
    <p class="hint">Garis warna di kiri kartu. Container boleh punya warna sendiri (tab Susun).</p>
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
  <div style="grid-column:1/-1">
    <label class="field">Flag pesan</label>
    <label class="menu-flags" style="margin-right:14px">
      <input type="checkbox" id="postFlagEmbeds" /> tanpa kartu embed untuk tautan
    </label>
    <label class="menu-flags">
      <input type="checkbox" id="postFlagNotif" /> tanpa notifikasi
    </label>
    <p class="hint">Sama seperti "Message Flags" di Discohook. Flag lain (Components V2) diurus bot dan tidak perlu diatur.</p>
  </div>
  <div style="grid-column:1/-1">
    <label class="field">Kirim juga ke channel lain</label>
    <div class="role-style-row">
      <span class="select-wrap" style="flex:1">
        <select id="targetPilih">
          <option value="">Pilih channel tambahan…</option>
          ${options.channels
            .map((c) => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`)
            .join('')}
        </select>
        ${icon('chevron', 15)}
      </span>
      <button class="btn btn-ghost btn-sm" type="button" onclick="tambahTarget()">${icon('plus', 15)} Tambah</button>
    </div>
    <div id="targetDaftar" class="block-list"></div>
    <p class="hint" id="targetStatus" style="margin:0"></p>
  </div>
  <div style="grid-column:1/-1">
    <label class="field" for="postTrigger">Kirim otomatis saat</label>
    <span class="select-shell full">
      <select id="postTrigger">
        <option value="">Hanya saat saya klik Kirim</option>
        <option value="member_add">Ada member baru bergabung</option>
        <option value="member_remove">Ada member keluar</option>
      </select>
      ${icon('chevron', 15)}
    </span>
    <p class="hint">Pesan yang sama diperbarui tiap kejadian, bukan dikirim ulang berulang — channel tidak dipenuhi versi lama. Sambutan &amp; perpisahan ber-AI tetap berjalan sendiri di halamannya.</p>
  </div>
  <div style="grid-column:1/-1">
    <label class="field">Izinkan ping (allowed_mentions)</label>
    <label class="menu-flags" style="margin-right:14px">
      <input type="checkbox" id="postMentionUsers" /> sebut nama pengguna
    </label>
    <label class="menu-flags" style="margin-right:14px">
      <input type="checkbox" id="postMentionRoles" /> ping role
    </label>
    <label class="menu-flags">
      <input type="checkbox" id="postMentionEveryone" /> @everyone / @here
    </label>
    <p class="hint">Bawaannya <b>tanpa ping sama sekali</b>. Itu bukan kelalaian: pesan yang tidak sengaja berisi @everyone tidak bisa ditarik kembali, dan ping massal tidak bisa dibatalkan. Centang hanya yang memang dibutuhkan.</p>
  </div>
  <div style="grid-column:1/-1">
    <label class="field" for="postThreadName">Nama thread (opsional)</label>
    <input type="text" id="postThreadName" placeholder="mis. Diskusi {server.name}" />
    <p class="hint">Kalau diisi, pesan ini langsung membuka thread dengan nama tersebut — sama seperti <code>thread_name</code> di Discohook. Gagal membuat thread TIDAK membatalkan pesannya; kegagalannya dilaporkan.</p>
  </div>
  <div style="grid-column:1/-1">
    <label class="field">Bagian embed klasik (penulis, footer, bidang)</label>
    <p class="hint" style="margin-top:0">Hanya dipakai saat <b>Bentuk pesan: Embed klasik</b>. Satu pesan boleh berisi sampai <b>10 embed</b> — sama seperti tombol Add Embed di Discohook. Embed pertama dilengkapi isi blok; embed kedua dan seterusnya hanya berisi bagian yang kamu tulis di sini. Tidak ada satu pun yang wajib.</p>
    <div class="block-add" style="margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" type="button" onclick="tambahEmbed()">${icon('plus', 15)} Tambah embed</button>
      <span class="hint" id="embedPilihStatus" style="margin:0"></span>
    </div>
    <div id="embedPilihList" class="block-list" style="margin-bottom:12px"></div>
    <div id="embedEditor" style="display:grid;gap:8px">
      <input type="text" id="embedUrl" placeholder="URL saat judul diklik (opsional, http/https)" />
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="color" id="embedColor" value="#6d8cff" style="width:48px;height:38px;padding:2px;border-radius:8px;border:1px solid var(--line);background:var(--panel)" />
        <span class="hint" id="embedColorText" style="margin:0">warna embed ini (kosong = ikut aksen pesan)</span>
        <button class="btn btn-ghost btn-sm" type="button" onclick="resetEmbedColor()">Ikut aksen pesan</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="embedAuthorName" placeholder="Nama penulis (mis. {server.name})" style="flex:1;min-width:160px" />
        <input type="text" id="embedAuthorIcon" placeholder="URL ikon penulis" style="flex:1;min-width:160px" />
        <input type="text" id="embedAuthorUrl" placeholder="URL tautan penulis" style="flex:1;min-width:160px" />
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="embedFooterText" placeholder="Teks footer (mis. Dikirim oleh {member.name})" style="flex:2;min-width:200px" />
        <input type="text" id="embedFooterIcon" placeholder="URL ikon footer" style="flex:1;min-width:160px" />
      </div>
      <input type="text" id="embedTimestamp" placeholder="Stempel waktu ISO 8601 (mis. 2026-11-12T09:00:00Z)" />
      <div class="subhead" style="margin-top:4px">Bidang embeds (maksimal 25 per embed)</div>
      <div id="embedFieldList" class="block-list"></div>
      <div class="block-add">
        <button class="btn btn-ghost btn-sm" type="button" onclick="tambahBidangEmbed()">${icon('plus', 15)} Tambah bidang</button>
        <span class="hint" id="embedFieldStatus" style="margin:0"></span>
      </div>
    </div>
  </div>
  <div style="grid-column:1/-1">
    <details>
      <summary class="field" style="cursor:pointer">Variabel teks yang bisa dipakai</summary>
      <p class="hint" style="margin-top:6px">Nama yang sama dengan Discohook. Token yang tidak dikenal <b>dibiarkan apa adanya</b>, jadi salah tulis terlihat — bukan menghilang. Berlaku di teks blok, teks aksi, footer/penulis/bidang embed.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 12px;font-size:12px">
        ${[
          ['{member.name}', 'nama tampilan'],
          ['{member.display_name}', 'sama dengan di atas'],
          ['{member.username}', 'username Discord'],
          ['{member.tag}', 'username#1234 (atau username saja)'],
          ['{member.id}', 'ID member'],
          ['{member.mention}', 'sebutan member'],
          ['{member.avatar_url}', 'URL avatar member'],
          ['{member.role_ids}', 'ID role (JSON)'],
          ['{server.name}', 'nama server'],
          ['{server.id}', 'ID server'],
          ['{server.icon_url}', 'URL ikon server'],
          ['{server.members}', 'jumlah member'],
          ['{server.boosts}', 'jumlah boost'],
          ['{server.roles}', 'jumlah role'],
          ['{server.created}', 'server dibuat (stempel waktu)'],
          ['{channel.name}', 'nama channel'],
          ['{channel.mention}', 'sebutan channel'],
          ['{channel.link}', 'tautan channel'],
          ['{role}', 'role hasil aksi role'],
          ['{effect}', 'ditambahkan / dilepas'],
          ['{selected}', 'pilihan menu (gabungan)'],
          ['{selected_value}', 'pilihan menu pertama'],
          ['{selected_values.1}', 'pilihan ke-1, ke-2, dst.'],
          ['{now}', 'waktu sekarang (stempel)'],
          ['{now_relative}', 'waktu sekarang (relatif)'],
          ['{var.nama}', 'variabel flow'],
        ]
          .map(
            ([token, arti]) =>
              `<div><code>${esc(token)}</code> <span style="color:var(--text-2)">${esc(arti)}</span></div>`,
          )
          .join('')}
      </div>
    </details>
  </div>
</div>`,
  });

  /**
   * Kartu riwayat versi & tautan berbagi.
   *
   * Riwayat dibuat OTOMATIS setiap pesan disimpan (bukan tombol "simpan
   * versi"): admin tidak akan ingat menekannya, dan riwayat yang bolong lebih
   * berbahaya daripada tidak ada riwayat sama sekali. Karena itu kartu ini
   * tidak punya tombol simpan — hanya daftar versi dan tombol kembalikan.
   *
   * Tautan berbagi ada di kartu yang sama karena keduanya sama-sama soal
   * "membawa isi pesan ke luar editor": satu ke versi lama, satu ke orang lain.
   */
  const riwayatCard = card({
    title: 'Riwayat & bagikan',
    hint: '20 versi terakhir',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <button class="btn btn-ghost btn-sm" type="button" onclick="muatRiwayat()">${icon('download', 15)} Muat ulang riwayat</button>
    <span class="hint" id="riwayatStatus" style="margin:0"></span>
  </div>
  <div id="riwayatList" class="block-list"></div>
  <p class="hint" style="margin:0">Versi lama muncul di sini setiap kali pesan disimpan atau dikirim ulang. Mengembalikan versi lama <b>tidak</b> menghapus versi terbaru — versi sekarang ikut tersimpan, jadi bisa dibalik lagi.</p>
  <hr class="sep" />
  <div class="subhead">${icon('external', 15)} Tautan berbagi</div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input type="text" id="shareUrl" readonly placeholder="Belum dibuat" style="flex:1;min-width:220px" />
    <button class="btn btn-ghost btn-sm" type="button" onclick="buatShare()">${icon('copy', 15)} Buat tautan</button>
    <button class="btn btn-ghost btn-sm" type="button" onclick="salinShare()">${icon('copy', 15)} Salin</button>
    <button class="btn-danger btn-sm" type="button" onclick="cabutShare()">${icon('trash', 15)} Cabut</button>
  </div>
  <p class="hint" style="margin:0">Tautan <code>/bagi/…</code> bisa dibuka <b>tanpa login</b> dan hanya menampilkan blok pesannya — tanpa daftar role, channel, atau server. Cocok untuk minta pendapat orang lain sebelum pesan dikirim. Cabut tautannya kalau sudah tidak dipakai.</p>
</div>`,
  });

  /**
   * Kartu impor ekspor — dipindah ke tab sendiri supaya tab Susun tidak
   * memanjang oleh dua kotak teks besar yang jarang dipakai.
   */
  const importCard = card({
    title: 'Impor',
    hint: 'dari Discohook, atau cadangan JSON',
    body: `<div class="card-pad" style="padding-top:6px;display:grid;gap:14px">
${imporHtml.trim()}
  <p class="hint" style="margin:0">Format JSON milik halaman ini memakai penanda <code>zypher-post</code>; JSON Discohook (payload Components V2) juga diterima di kotak atas.</p>
</div>`,
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

  /**
   * Satu tombol tab. `hint` tampil kecil di bawah label pada layar lebar.
   *
   * Memakai pola yang sama dengan halaman Sambutan: panel nonaktif hanya
   * diberi atribut `hidden`, jadi tidak ada isian yang hilang saat berpindah.
   */
  const tabPesan = (key: string, label: string, active: boolean, hint: string): string =>
    `<button type="button" role="tab" class="tab${active ? ' is-active' : ''}"
      id="tab-${key}" data-tab="${key}" aria-selected="${active ? 'true' : 'false'}"
      aria-controls="pane-${key}" title="${esc(hint)}"
      onclick="showPesanTab('${key}')">${esc(label)}</button>`;

  const body = `${pageHead({
    kicker: '09 — Pesan bertema',
    title: 'Pesan',
    subtitle: 'Susun pesan container sendiri: rules, ambil roles, pengumuman. Kirim sekali, lalu perbarui tanpa kirim ulang.',
    actions: badge(`${options.posts.length} pesan`, 'brand'),
  })}
${/*
     * Tata letak: daftar pesan tersimpan di atas (satu baris penuh), lalu
     * panel bertab di bawahnya — bukan lagi kartu-kartu yang ditumpuk ke
     * bawah. Tab memakai `hidden`, bukan melepas elemen dari DOM: isian yang
     * belum disimpan tidak hilang saat berpindah tab, dan semua
     * getElementById tetap menemukan elemennya (pola yang sama dengan
     * halaman Sambutan).
     */''}
${listCard}
<div class="tabs" role="tablist" aria-label="Bagian halaman Pesan" style="margin-top:18px">
  ${tabPesan('susun', 'Susun pesan', true, 'teks, gambar, tombol')}
  ${tabPesan('pratinjau', 'Pratinjau', false, 'tampil seperti di Discord')}
  ${tabPesan('role', 'Ambil role', false, 'tombol & menu')}
  ${tabPesan('impor', 'Impor', false, 'Discohook & JSON')}
  ${tabPesan('grup', 'Multi-pesan', false, 'beberapa pesan, berbalas')}
  ${tabPesan('riwayat', 'Riwayat', false, 'versi lama & tautan berbagi')}
  <span class="hint" style="margin:0 0 0 auto;align-self:center">Pindah tab tidak menghapus isian yang belum disimpan.</span>
</div>

<div class="tab-pane" id="pane-susun" role="tabpanel" aria-labelledby="tab-susun">
  <div class="pesan-layout">
    <div class="pesan-sisi">${editorCard}${settingCard}</div>
    <div class="pesan-sisi">
      <div class="pane-sticky">${previewCard('previewHost')}</div>
    </div>
  </div>
</div>

<div class="tab-pane" id="pane-pratinjau" role="tabpanel" aria-labelledby="tab-pratinjau" hidden>
  ${/*
       * Tab ini HANYA berisi pratinjau.
       *
       * Pengaturan warna & pengirim sengaja tidak diulang di sini: kartu yang
       * sama dirender dua kali berarti dua elemen ber-id sama, dan
       * getElementById akan selalu mengambil yang pertama — yang berada di tab
       * tersembunyi. Akibatnya mengubah warna dari tab ini tidak berpengaruh
       * apa pun. Satu elemen, satu tempat.
       */''}
  ${previewCard('previewHostBesar')}
  <p class="hint">Pratinjau memakai data blok yang SAMA dengan yang dikirim ke Discord, jadi yang terlihat di sini bukan tebakan. Warna aksen & pengirim diatur di tab <b>Susun</b>.</p>
</div>

<div class="tab-pane" id="pane-riwayat" role="tabpanel" aria-labelledby="tab-riwayat" hidden>
  ${riwayatCard}
</div>

<div class="tab-pane" id="pane-role" role="tabpanel" aria-labelledby="tab-role" hidden>
  ${roleCard}
  <div class="card" style="margin-top:14px">
    <div class="card-head">
      <div>
        <div class="card-title">Jadwal kirim otomatis</div>
        <div class="card-hint">Kirim ulang pesan ini pada waktu tertentu — sekali, atau berulang tiap beberapa jam.</div>
      </div>
    </div>
    <div class="card-pad" style="padding-top:6px;display:grid;gap:10px">
      <p class="hint" style="margin:0">
        Jadwal memakai jam komputermu. Pesan dikirim sebagai pesan <b>baru</b> (bukan memperbarui yang lama).
        Pengulangan paling rapat <b>2 jam</b>. Bot memeriksa tiap 15 detik, jadi waktunya bisa mundur beberapa detik.
        Kalau bot mati saat waktunya tiba, pengiriman dilakukan begitu bot hidup lagi.
      </p>
      <p class="hint" style="margin:0">
        Mode <b>kalender</b> memakai zona waktu server (WIB/WITA/WIT), bukan jam komputermu — jadi "tiap Senin pukul 09:00" tetap 09:00 di server walau kamu membukanya dari zona lain. Formatnya lima ruas: <code>menit jam tanggal bulan hari</code>, mis. <code>0 9 * * 1</code>. Pola siap pakai ada di daftar; isian teks dipakai kalau polanya tidak ada di daftar.
      </p>
      <div id="scheduleList" class="block-list"></div>
      <div class="block-add">
        <span class="select-shell" style="max-width:220px">
          <select id="scheduleMode" onchange="modeJadwal()">
            <option value="sekali">Mode: waktu tertentu</option>
            <option value="kalender">Mode: kalender (tiap hari/Senin/tanggal)</option>
          </select>
        </span>
        <span class="select-shell" id="schedulePresetShell" hidden style="max-width:260px">
          <select id="schedulePreset" onchange="presetJadwal()">
            <option value="">Pilih pola…</option>
            <option value="0 9 * * *">Tiap hari pukul 09:00</option>
            <option value="0 20 * * *">Tiap hari pukul 20:00</option>
            <option value="0 9 * * 1">Tiap Senin pukul 09:00</option>
            <option value="0 9 * * 1-5">Tiap Senin–Jumat pukul 09:00</option>
            <option value="0 8 1 * *">Tiap tanggal 1 pukul 08:00</option>
            <option value="0 8 1,15 * *">Tiap tanggal 1 &amp; 15 pukul 08:00</option>
            <option value="0 10 * * 0">Tiap Minggu pukul 10:00</option>
            <option value="0 0 1 1 *">Tiap 1 Januari (tahun baru)</option>
          </select>
        </span>
        <input type="text" id="scheduleCron" hidden placeholder="0 9 * * 1" spellcheck="false" style="max-width:200px" />
        <input type="datetime-local" id="scheduleDue" title="Waktu kirim" />
        <span class="select-shell" style="max-width:220px">
          <select id="scheduleRepeat">
            <option value="0">Sekali kirim</option>
            <option value="120">Ulang tiap 2 jam</option>
            <option value="360">Ulang tiap 6 jam</option>
            <option value="720">Ulang tiap 12 jam</option>
            <option value="1440">Ulang tiap 24 jam</option>
            <option value="10080">Ulang tiap 7 hari</option>
          </select>
        </span>
        <button class="btn btn-ghost btn-sm" type="button" onclick="tambahJadwal()">+ Tambah jadwal</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="simpanJadwal()">Simpan jadwal</button>
      </div>
      <p class="hint" id="scheduleStatus" style="margin:0"></p>
    </div>
  </div>
</div>

<div class="tab-pane" id="pane-impor" role="tabpanel" aria-labelledby="tab-impor" hidden>
  <div class="pesan-layout">
    <div class="pesan-sisi">${importCard}</div>
  </div>
</div>

<div class="tab-pane" id="pane-grup" role="tabpanel" aria-labelledby="tab-grup" hidden>
  <div class="pesan-layout">
    <div class="pesan-sisi">
      <div class="card">
        <div class="subhead">${icon('file', 15)} Dokumen multi-pesan</div>
        <p class="hint">Beberapa pesan dalam satu dokumen. Kalau <b>kirim berurutan</b> dicentang, pesan pertama dikirim biasa dan sisanya jadi <b>balasan</b> ke pesan sebelumnya — sama seperti <i>multi-pesan</i> di Discohook. Dokumen disimpan terpisah dari pesan satu-dokumen karena tombol role, jadwal, dan aksi komponen bekerja pada satu pesan.</p>
        <div class="role-style-row">
          <input id="grupNama" type="text" placeholder="Nama dokumen, mis. Pengumuman berurutan" />
          <button class="btn btn-ghost btn-sm" type="button" onclick="tambahPesanGrup()">${icon('plus', 15)} Tambah pesan</button>
        </div>
        <label class="menu-flags"><input type="checkbox" id="grupSeries" /> kirim berurutan sebagai balasan</label>
        <div class="role-style-row">
          <span class="select-wrap">
            <select id="grupChannel">
              ${options.channels
                .map((c) => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`)
                .join('')}
            </select>
            ${icon('chevron', 15)}
          </span>
          <button class="btn-primary btn-sm" type="button" id="grupSimpan" onclick="simpanGrup()">${icon('check', 15)} Simpan</button>
          <button class="btn btn-ghost btn-sm" type="button" id="grupKirim" onclick="kirimGrup()" ${options.botReady ? '' : 'disabled'}>${icon('external', 15)} Kirim</button>
        </div>
        <div id="grupDaftar" class="block-list"></div>
        <p class="hint" id="grupStatus" style="margin:0"></p>
      </div>

      <div class="card">
        <div class="subhead">${icon('file', 15)} Dokumen tersimpan</div>
        <div id="grupTersimpan" class="block-list"></div>
      </div>

      <div class="card">
        <div class="subhead">${icon('sliders', 15)} JSON dokumen</div>
        <p class="hint" style="margin-top:0">
          Seluruh dokumen — semua pesan, rujukan balasan, nama thread — dalam satu kotak JSON.
          Berguna untuk menyunting rangkaian panjang sekaligus atau menyimpan cadangan sebelum mengubah banyak hal.
          Isinya disaring dengan aturan yang sama dengan editor, jadi blok asing tidak bisa menyusup.
        </p>
        <div class="json-aksi">
          <button class="btn btn-ghost btn-sm" type="button" onclick="eksporDokumen()">${icon('upload', 15)} Ekspor dokumen</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="imporDokumen()">${icon('download', 15)} Impor dokumen</button>
          <span class="hint" id="grupJsonStatus" style="margin:0"></span>
        </div>
        <textarea id="grupJson" rows="12" spellcheck="false" placeholder="Klik Ekspor dokumen untuk mengisi, atau tempel JSON dokumen di sini lalu klik Impor."></textarea>
      </div>
    </div>
  </div>
</div>

<div class="pesan-aksi">
  <button class="btn-primary" type="button" id="postSave" onclick="savePost()">${icon('check', 16)} Simpan</button>
  <button class="btn btn-ghost" type="button" id="postSend" onclick="sendPost()" ${options.botReady ? '' : 'disabled title="Bot offline"'}>${icon('external', 16)} Kirim ke Discord</button>
  <span class="hint" id="aksiStatus" style="margin:0"></span>
</div>
<script>
const GUILD = ${jsonForScript(options.guildId)};
/** Daftar role server + alasan tidak bisa dibagi (kalau ada). */
var ROLES = ${jsonForScript(options.roles)};
/** Tombol role per pesan: { pesanId: [...] }. */
/**
 * Channel server (id + nama). Dipakai daftar channel tambahan: menampilkan
 * nama channel, bukan ID mentah, supaya admin tahu channel mana yang dipilih.
 */
var CHANNELS = ${jsonForScript(options.channels.map((c) => ({ id: c.id, name: c.name })))};
var ROLE_BUTTONS = ${jsonForScript(options.roleButtons)};
var ROLE_MENUS = ${jsonForScript(options.roleMenus ?? {})};
/**
 * Aksi komponen per pesan: { pesanId: { 'button:12': [aksi…] } }.
 *
 * Kunci target memakai prefix yang sama dengan yang dibaca bot, jadi tidak ada
 * tabel terjemahan yang bisa menyimpang.
 */
var POST_ACTIONS = ${jsonForScript(options.postActions ?? {})};
/**
 * Daftar pesan tersimpan (id + nama) — dipakai sebagai tujuan aksi "kirim
 * pesan". Hanya dua field itu yang dibutuhkan, jadi blok penuh tidak dikirim
 * ulang ke browser.
 */
var POST_LIST = ${jsonForScript(options.posts.map((p) => ({ id: p.id, name: p.name })))};
/**
 * Jadwal kirim per pesan: { pesanId: [{ dueAt, repeatMinutes, lastSentAt }] }.
 *
 * Waktu dikirim sebagai epoch ms dan diformat di browser, supaya zona waktu
 * yang dilihat admin sama dengan jam di komputernya — bukan zona server.
 */
var POST_SCHEDULES = ${jsonForScript(options.schedules ?? {})};
/** Dokumen multi-pesan tersimpan (dibuka lewat ?grup=). */
var DOKUMEN = ${jsonForScript(options.documents ?? [])};
/** Dokumen yang sedang disusun (salinan; batal = tidak mengubah aslinya). */
var grupAktif = { id: null, name: '', series: false, messages: [] };
/** Tombol role yang sedang disusun (belum disimpan). */
var roleButtons = [];
/** Aksi tombol/menu yang sedang disusun, per target. */
var postActions = {};
/** Target (komponen) yang kartu aksinya sedang dibuka. */
var aksiTerbuka = null;
/** Menu dropdown role yang sedang disusun (biasanya hanya satu). */
var roleMenus = [];
var roleEditingId = null;
/** Blok yang sedang disusun. Disimpan sebagai data, bukan HTML. */
var blocks = [];
/** ID pesan yang sedang diubah (null = pesan baru). */
var editingId = null;
/**
 * Pesan Discord asal yang terakhir dimuat ("Muat pesan"), kalau ada.
 *
 * Disimpan supaya dashboard bisa memberi tahu bahwa pesan itu bisa diperbarui,
 * bukan sekadar diduplikasi.
 */
var MUAT_SUMBER = null;

/**
 * Batas Discord untuk Components V2. Angka 25 yang sering dikutip di internet
 * adalah batas pesan lama — memakainya akan menolak pesan yang sebenarnya sah.
 */
var BATAS = { total: 40, top: 10, teks: 4000, teksAman: 3500, tombolPerBaris: 5 };

/**
 * Batas flow, dikirim server (ACTION_LIMITS) supaya angka di layar admin sama
 * dengan yang ditegakkan saat menyimpan.
 *
 * Ditulis sebagai objek dengan nilai cadangan: halaman ini harus tetap bisa
 * dibuka walau HTML lama (tanpa blok ini) masih tersimpan di cache browser.
 */
var BATAS_AKSI = ${jsonForScript(options.aksiLimits ?? { perKomponen: 6, countedPerFlow: 40, messagePerFlow: 15, branchDepth: 5 })};
/** Kedalaman cabang bersyarat yang boleh disusun di layar. */
var KEDALAMAN_CABANG = Number(BATAS_AKSI.branchDepth) || 5;

/**
 * Jenis aksi yang bisa ditambahkan, dengan labelnya.
 *
 * Satu daftar dipakai editor tingkat atas DAN editor di dalam cabang. Dulu
 * cabang punya daftar sendiri yang lebih pendek, sehingga aksi seperti thread
 * atau webhook tidak bisa dipakai di dalam cabang walau server menerimanya.
 */
var DAFTAR_JENIS_AKSI = [
  ['role', 'Role - beri / lepas'],
  ['reply', 'Balas pengklik'],
  ['message', 'Kirim pesan tersimpan'],
  ['webhook', 'Kirim pesan lewat webhook'],
  ['raw', 'Kirim teks biasa (tanpa komponen)'],
  ['wait', 'Tunggu'],
  ['condition', 'Periksa syarat (dengan cabang)'],
  ['variable', 'Simpan variabel'],
  ['thread', 'Buat thread'],
  ['delete', 'Hapus pesan (ini / hasil aksi sebelumnya)'],
  ['dud', 'Tidak melakukan apa pun'],
  ['stop', 'Hentikan flow']
];

/**
 * Aksi contoh untuk satu jenis.
 *
 * Dikembalikan null kalau jenisnya butuh data yang belum ada (mis. pesan lain
 * untuk dikirim). Pemanggil menampilkan alasannya lewat toast, bukan menambah
 * aksi setengah jadi yang akan ditolak server.
 */
function aksiContoh(jenis) {
  if (jenis === 'role') {
    var role = ROLES.filter(function (r) { return !r.blockedBy; })[0];
    if (!role) {
      toast('Belum ada role yang bisa dipakai - jalankan bot dulu', true);
      return null;
    }
    return { kind: 'role', roleId: role.id, op: 'toggle' };
  }
  if (jenis === 'reply') return { kind: 'reply', text: 'Halo {member.name}, selesai!', hidden: true };
  if (jenis === 'wait') return { kind: 'wait', seconds: 300 };
  if (jenis === 'condition') return { kind: 'condition', value: 'member.name', comparator: 'notEmpty' };
  if (jenis === 'variable') return { kind: 'variable', name: 'pilihan', value: '{member.name}' };
  if (jenis === 'thread') return { kind: 'thread', threadName: 'Diskusi {member.name}', private: false };
  if (jenis === 'raw') return { kind: 'raw', rawText: 'Halo {member.mention}!' };
  if (jenis === 'delete') return { kind: 'delete', what: 'pesan' };
  if (jenis === 'dud') return { kind: 'dud' };
  if (jenis === 'stop') return { kind: 'stop' };
  var lain = POST_LIST.filter(function (p) { return !editingId || p.id !== editingId; });
  if (jenis === 'message' || jenis === 'webhook') {
    if (lain.length === 0) {
      toast('Belum ada pesan lain yang bisa dikirim', true);
      return null;
    }
    return { kind: jenis, postId: lain[0].id, toChannel: true };
  }
  return null;
}

/**
 * Hitung aksi satu flow (satu komponen), termasuk yang ada di dalam cabang.
 *
 * Aturannya SAMA dengan hitungAksiFlow di post-actions.ts: syarat dan
 * hentikan tidak dihitung, aksi kirim pesan dihitung terpisah. Dua salinan
 * memang tidak ideal, tetapi halaman ini hanya menerima HTML+JS jadi: yang
 * penting keduanya memakai batas yang dikirim server, bukan angka yang
 * ditulis ulang di browser.
 */
function hitungAksi(daftar) {
  var hasil = { total: 0, berhitung: 0, pesan: 0 };
  var jalan = function (sisa) {
    (sisa || []).forEach(function (aksi) {
      hasil.total += 1;
      if (aksi.kind !== 'condition' && aksi.kind !== 'stop') hasil.berhitung += 1;
      if (aksi.kind === 'message' || aksi.kind === 'webhook') hasil.pesan += 1;
      if (aksi.kind === 'condition') {
        jalan(aksi.then);
        jalan(aksi.else);
      }
    });
  };
  jalan(daftar);
  return hasil;
}

/**
 * Hitung pemakaian komponen di browser, meniru penyusun payload di server.
 *
 * Server tetap menghitung ulang dan berhak menolak; angka di sini hanya untuk
 * admin, supaya ia melihat batasnya SEBELUM menekan Simpan.
 */
function ukurPemakaian() {
  var total = 0, top = 0, teks = 0;
  var anak = 0, adaIsi = false, tombol = 0, luar = false;

  /*
   * Deretan tombol ditutup menjadi baris utuh.
   *
   * Di dalam kartu, baris tombol menambah jumlah ANAK kartu (bukan total),
   * karena tutup() yang menjumlahkan anak ke total. Menambah ke keduanya
   * membuat tombol terhitung dua kali.
   */
  function selesaiTombol() {
    if (tombol === 0) return;
    var baris = Math.ceil(tombol / BATAS.tombolPerBaris);
    if (luar) { total += baris; top += 1; }
    else { anak += baris; adaIsi = true; }
    tombol = 0;
  }

  function tutup() {
    selesaiTombol();
    if (!adaIsi) return;
    top += 1;
    total += anak;
    anak = 0; adaIsi = false;
  }

  blocks.forEach(function (b) {
    if (b.kind === 'container') { tutup(); luar = false; return; }
    if (b.kind === 'close') { tutup(); luar = true; return; }
    if (b.kind === 'button') { tombol += 1; return; }
    if (b.kind === 'row') { selesaiTombol(); return; }
    // Blok lain menutup deretan tombol sebelumnya supaya urutannya terjaga.
    selesaiTombol();
    if (b.kind === 'select') {
      if (luar) { total += 1; top += 1; }
      else { anak += 1; adaIsi = true; }
      return;
    }
    if (b.kind === 'divider') { if (adaIsi) anak += 1; return; }
    if (b.kind === 'text' || b.kind === 'section') {
      teks += String(b.value || '').length;
      anak += 1; adaIsi = true;
      return;
    }
    if (b.kind === 'image' || b.kind === 'file') { anak += 1; adaIsi = true; }
  });
  tutup();

  // Tombol role & menu juga memakan kuota — dashboard menambahkannya sendiri
  // karena keduanya tersimpan terpisah dari blok.
  var barisRole = Math.ceil(roleButtons.length / BATAS.tombolPerBaris);
  total += barisRole;
  if (barisRole > 0) top = Math.max(top, 1);
  var barisMenu = 0;
  roleMenus.forEach(function (m) { if (m.options && m.options.length) barisMenu += 1; });
  total += barisMenu;

  return { total: total, top: top, teks: teks };
}

function renderUsage() {
  var bar = document.getElementById('usageBar');
  if (!bar) return;
  var u = ukurPemakaian();
  bar.hidden = false;

  var persen = Math.min(100, Math.round((u.total / BATAS.total) * 100));
  var isi = document.getElementById('usageFill');
  if (isi) {
    isi.style.width = persen + '%';
    isi.className = 'usage-fill' + (u.total > BATAS.total ? ' over' : u.total > BATAS.total * 0.8 ? ' warn' : '');
  }
  var label = document.getElementById('usageText');
  if (label) {
    label.textContent = u.total + '/' + BATAS.total + ' komponen · ' +
      u.top + '/' + BATAS.top + ' container · ' + u.teks + '/' + BATAS.teksAman + ' karakter';
  }
  var warn = document.getElementById('usageWarn');
  if (warn) {
    var pesan = [];
    if (u.total > BATAS.total) pesan.push('komponen melebihi batas Discord');
    if (u.top > BATAS.top) pesan.push('terlalu banyak container');
    if (u.teks > BATAS.teksAman) pesan.push('teks terlalu panjang');
    warn.textContent = pesan.length ? '⚠ ' + pesan.join(', ') : '';
  }
}

var LABEL = {
  text: 'Teks',
  image: 'Gambar',
  button: 'Tombol',
  divider: 'Pemisah',
  container: 'Container baru',
  section: 'Section (teks + gambar/tombol)',
  close: 'Tutup kartu (di luar kartu)',
  file: 'File (lampiran)',
  select: 'Select menu (dropdown)',
  row: 'Baris baru (Row)'
};

function lineCount(value) {
  return String(value || '').split('\\n').length;
}


/**
 * Sakelar centang sederhana untuk satu properti blok.
 *
 * Dipakai untuk "spoiler" pada gambar dan berkas. Ditulis sekali supaya
 * perilakunya sama di kedua tempat.
 */
function buatSakelar(index, properti, label) {
  var baris = document.createElement('label');
  baris.className = 'menu-flags';
  var kotak = document.createElement('input');
  kotak.type = 'checkbox';
  kotak.checked = Boolean(blocks[index][properti]);
  kotak.onchange = function () {
    blocks[index][properti] = kotak.checked;
    renderPreview();
  };
  baris.appendChild(kotak);
  baris.appendChild(document.createTextNode(' ' + label));
  return baris;
}

/**
 * Nama jenis select menu seperti yang dipakai Discord/Discohook.
 *
 * Disalin di sini (bukan diimpor) karena berkas ini dikirim ke browser sebagai
 * satu blok skrip; modul server tidak ikut. Urutannya sama dengan daftar di
 * Discohook: String, User, Role, User & Role, Channel.
 */
var SELECT_JENIS = [
  ['string', 'String select (pilihan bebas)'],
  ['user', 'User select (pilih anggota)'],
  ['role', 'Role select (pilih role)'],
  ['mentionable', 'User & Role select'],
  ['channel', 'Channel select (pilih channel)']
];

function selectJenisLabel(block) {
  var jenis = block.selectKind || 'string';
  for (var i = 0; i < SELECT_JENIS.length; i += 1) {
    if (SELECT_JENIS[i][0] === jenis) return SELECT_JENIS[i][1].split(' (')[0];
  }
  return 'Select';
}

/**
 * Editor blok Select menu.
 *
 * Susunannya mengikuti panel komponen Discohook: jenis menu, placeholder,
 * jumlah pilihan minimal/maksimal, dan — khusus jenis string — daftar
 * pilihannya. Jenis selain string memakai daftar bawaan Discord (anggota,
 * role, channel), jadi tidak punya daftar pilihan sendiri.
 */
function buatEditorSelect(index) {
  var bungkus = document.createElement('div');
  bungkus.className = 'block-select';

  var barisJenis = document.createElement('div');
  barisJenis.className = 'role-style-row';

  var pilihJenis = document.createElement('select');
  pilihJenis.className = 'role-mode';
  pilihJenis.title = 'Jenis menu — sama dengan pilihan di Discohook';
  SELECT_JENIS.forEach(function (pasangan) {
    var o = document.createElement('option');
    o.value = pasangan[0];
    o.textContent = pasangan[1];
    if ((blocks[index].selectKind || 'string') === pasangan[0]) o.selected = true;
    pilihJenis.appendChild(o);
  });
  pilihJenis.onchange = function () {
    blocks[index].selectKind = pilihJenis.value;
    // Menu string tanpa pilihan ditolak Discord: beri satu contoh saat beralih.
    if (pilihJenis.value === 'string' && (blocks[index].options || []).length === 0) {
      blocks[index].options = [{ label: 'Pilihan 1', value: 'pilihan-1' }];
    }
    renderBlocks();
    renderPreview();
  };
  barisJenis.appendChild(pilihJenis);

  var min = document.createElement('input');
  min.type = 'number';
  min.className = 'role-angka';
  min.min = '0';
  min.max = '25';
  min.value = String(blocks[index].minValues === undefined ? 1 : blocks[index].minValues);
  min.title = 'Pilihan minimal yang harus diambil';
  min.oninput = function () { blocks[index].minValues = angkaAtau(min.value, 1); renderPreview(); };
  barisJenis.appendChild(min);

  var max = document.createElement('input');
  max.type = 'number';
  max.className = 'role-angka';
  max.min = '1';
  max.max = '25';
  max.value = String(blocks[index].maxValues === undefined ? 1 : blocks[index].maxValues);
  max.title = 'Pilihan maksimal yang boleh diambil';
  max.oninput = function () { blocks[index].maxValues = angkaAtau(max.value, 1); renderPreview(); };
  barisJenis.appendChild(max);
  bungkus.appendChild(barisJenis);

  var placeholder = document.createElement('input');
  placeholder.type = 'text';
  placeholder.value = blocks[index].placeholder || '';
  placeholder.placeholder = 'Teks ajakan di dalam menu, mis. Pilih role…';
  placeholder.oninput = function () {
    blocks[index].placeholder = placeholder.value.slice(0, 150);
    renderPreview();
  };
  bungkus.appendChild(placeholder);

  if ((blocks[index].selectKind || 'string') === 'string') {
    var daftar = document.createElement('div');
    daftar.className = 'select-opsi-daftar';

    (blocks[index].options || []).forEach(function (opsi, nomor) {
      var baris = document.createElement('div');
      baris.className = 'select-opsi';

      var label = document.createElement('input');
      label.type = 'text';
      label.value = opsi.label || '';
      label.placeholder = 'Label pilihan';
      label.oninput = function () {
        blocks[index].options[nomor].label = label.value.slice(0, 100);
        renderPreview();
      };
      baris.appendChild(label);

      var nilai = document.createElement('input');
      nilai.type = 'text';
      nilai.value = opsi.value || '';
      nilai.placeholder = 'Nilai yang dikirim (opsional)';
      nilai.oninput = function () {
        blocks[index].options[nomor].value = nilai.value.slice(0, 100);
        renderPreview();
      };
      baris.appendChild(nilai);

      var deskripsi = document.createElement('input');
      deskripsi.type = 'text';
      deskripsi.value = opsi.description || '';
      deskripsi.placeholder = 'Keterangan (opsional)';
      deskripsi.oninput = function () {
        blocks[index].options[nomor].description = deskripsi.value.slice(0, 100);
        renderPreview();
      };
      baris.appendChild(deskripsi);

      var emoji = document.createElement('input');
      emoji.type = 'text';
      emoji.className = 'role-emoji';
      emoji.value = opsi.emoji || '';
      emoji.placeholder = '🎮';
      emoji.title = 'Emoji di depan label (opsional)';
      emoji.oninput = function () {
        blocks[index].options[nomor].emoji = emoji.value.slice(0, 80);
        renderPreview();
      };
      baris.appendChild(emoji);

      var hapus = document.createElement('button');
      hapus.className = 'btn-danger btn-sm btn-icon';
      hapus.type = 'button';
      hapus.title = 'Hapus pilihan';
      hapus.textContent = '×';
      hapus.onclick = function () {
        blocks[index].options.splice(nomor, 1);
        renderBlocks();
        renderPreview();
      };
      baris.appendChild(hapus);

      /*
       * Aksi untuk PILIHAN ini.
       *
       * Kuncinya nilai pilihan (bukan ID baris): itulah yang dikirim balik
       * Discord saat member memilih. Kalau nilainya belum diisi, label dipakai
       * — sama dengan yang dilakukan penyusun payload, jadi kuncinya cocok
       * dengan yang diterima bot.
       */
      var targetPilihan = 'sel:' + (opsi.value || opsi.label || '');
      if (targetPilihan !== 'sel:') {
        baris.appendChild(kartuAksi(targetPilihan, 'pilihan ' + (opsi.label || '')));
      }

      daftar.appendChild(baris);
    });
    bungkus.appendChild(daftar);

    var tambah = document.createElement('button');
    tambah.className = 'btn btn-ghost btn-sm';
    tambah.type = 'button';
    tambah.textContent = '+ Tambah pilihan';
    tambah.onclick = function () {
      var opsi = blocks[index].options || (blocks[index].options = []);
      if (opsi.length >= 25) return toast('Maksimal 25 pilihan (batas Discord)', true);
      opsi.push({ label: 'Pilihan ' + (opsi.length + 1), value: '' });
      renderBlocks();
      renderPreview();
    };
    bungkus.appendChild(tambah);
  } else {
    var ket = document.createElement('p');
    ket.className = 'hint';
    ket.style.margin = '0';
    ket.textContent = 'Daftar pilihannya disediakan Discord sendiri (anggota, role, atau channel server), jadi tidak perlu diisi. Menu ini hanya tampilan: pilihan tidak mengubah role siapa pun.';
    bungkus.appendChild(ket);
  }

  bungkus.appendChild(buatSakelar(index, 'selectDisabled', 'Nonaktif (tidak bisa dibuka)'));

  /*
   * Pilihan bawaan (default_values) — hanya untuk select yang menunjuk
   * entitas Discord. Select string DITOLAK Discord kalau diberi
   * default_values, jadi isian ini tidak ditampilkan di sana alih-alih
   * ditampilkan lalu diabaikan.
   */
  if ((blocks[index].selectKind || 'string') !== 'string') {
    var isianDefault = document.createElement('input');
    isianDefault.type = 'text';
    isianDefault.value = (blocks[index].defaultValues || []).join(', ');
    isianDefault.placeholder = 'ID pilihan bawaan, mis. 123456789012345678';
    isianDefault.oninput = function () {
      var id = isianDefault.value.split(',').map(function (t) { return t.trim(); })
        .filter(function (t) { return /^[0-9]{5,25}$/.test(t); }).slice(0, 25);
      if (id.length) blocks[index].defaultValues = id;
      else delete blocks[index].defaultValues;
    };
    bungkus.appendChild(isianDefault);

    var catatanDefault = document.createElement('p');
    catatanDefault.className = 'hint';
    catatanDefault.style.margin = '0';
    catatanDefault.textContent =
      'Pilihan yang sudah terpilih saat menu tampil (sama seperti default values di Discohook). Menu single-select hanya boleh punya satu — sisanya dibuang dan dilaporkan.';
    bungkus.appendChild(catatanDefault);
  }

  /*
   * Catatan jujur soal fungsi menu ini.
   *
   * Discord hanya mengirim nilai select ke aplikasi pemilik komponen, dan akun
   * bot tidak bisa membaca daftar anggota dari nilai itu; karena itu menu di
   * sini ditampilkan seperti di Discohook, lalu dijawab singkat saat dipakai.
   * Untuk role sungguhan, tab Ambil role yang dipakai.
   */
  var catatan = document.createElement('p');
  catatan.className = 'hint';
  catatan.style.margin = '0';
  catatan.textContent = 'Menu ini tampil sebagai pratinjau seperti di Discohook; saat member memilih, bot menjawab singkat bahwa menu ini tidak mengubah apa pun. Untuk memberi role, pakai dropdown di tab Ambil role.';
  bungkus.appendChild(catatan);

  return bungkus;
}

/** Angka dari input teks: kosong/invalid memakai nilai cadangan. */
function angkaAtau(nilai, cadangan) {
  var angka = parseInt(String(nilai), 10);
  return isNaN(angka) ? cadangan : angka;
}

/**
 * Editor aksesori untuk blok teks/gambar.
 *
 * Discord hanya punya SATU slot aksesori (tombol link ATAU thumbnail), jadi
 * kolom thumbnail otomatis dinonaktifkan saat tombol diisi — lebih jelas
 * daripada membiarkan admin mengisi keduanya lalu diam-diam hanya satu dipakai.
 */
function buatAksesori(index) {
  var bungkus = document.createElement('div');
  bungkus.className = 'block-aksesori';

  var judul = document.createElement('span');
  judul.className = 'block-aksesori-judul';
  judul.textContent = 'Aksesori (opsional)';
  bungkus.appendChild(judul);

  var label = document.createElement('input');
  label.type = 'text';
  label.value = blocks[index].accessoryLabel || '';
  label.placeholder = 'Teks tombol link';
  bungkus.appendChild(label);

  var url = document.createElement('input');
  url.type = 'text';
  url.value = blocks[index].url || '';
  url.placeholder = 'https://… (tujuan tombol)';
  bungkus.appendChild(url);

  var thumb = document.createElement('input');
  thumb.type = 'text';
  thumb.value = blocks[index].thumbnail || '';
  thumb.placeholder = 'https://…/gambar-kecil.png (thumbnail)';
  bungkus.appendChild(thumb);

  function segarkan() {
    // Tombol dan thumbnail saling meniadakan: hanya satu yang dipakai Discord.
    var adaTombol = Boolean(String(label.value).trim());
    thumb.disabled = adaTombol;
    thumb.title = adaTombol ? 'Kosongkan teks tombol dulu — Discord hanya menerima satu aksesori' : '';
  }
  label.oninput = function () {
    blocks[index].accessoryLabel = label.value;
    segarkan();
    renderPreview();
  };
  url.oninput = function () { blocks[index].url = url.value; renderPreview(); };
  thumb.oninput = function () { blocks[index].thumbnail = thumb.value; renderPreview(); };
  segarkan();

  return bungkus;
}

/**
 * Editor blok File: sumber berkas, nama, dan spoiler.
 *
 * Dua sumber: URL (bot mengunduh saat kirim) atau unggah dari perangkat
 * (dikirim sebagai lampiran). Unggahan dibatasi 8 MB — sama dengan batas
 * unduhan di sisi pengirim, supaya yang terlihat di dashboard dan yang
 * benar-benar terkirim tidak berbeda.
 */
function buatEditorFile(index) {
  var bungkus = document.createElement('div');
  bungkus.className = 'block-file';

  if (blocks[index].data) {
    var ket = document.createElement('p');
    ket.className = 'hint';
    ket.style.margin = '0';
    ket.textContent = 'Berkas dari perangkat: ' + (blocks[index].name || 'tanpa nama') + ' — diunggah sebagai lampiran.';
    bungkus.appendChild(ket);
    var hapus = document.createElement('button');
    hapus.className = 'btn-ghost btn-sm';
    hapus.type = 'button';
    hapus.textContent = 'Ganti dengan URL';
    hapus.onclick = function () {
      blocks[index].data = '';
      renderBlocks();
      renderPreview();
    };
    bungkus.appendChild(hapus);
    bungkus.appendChild(buatSakelar(index, 'spoiler', 'Sembunyikan sebagai spoiler'));
    return bungkus;
  }

  var url = document.createElement('input');
  url.type = 'text';
  url.value = blocks[index].value || '';
  url.placeholder = 'https://…/dokumen.pdf';
  url.oninput = function () { blocks[index].value = url.value; renderPreview(); };
  bungkus.appendChild(url);

  var nama = document.createElement('input');
  nama.type = 'text';
  nama.value = blocks[index].name || '';
  nama.placeholder = 'Nama berkas (opsional, mis. panduan.pdf)';
  nama.oninput = function () { blocks[index].name = nama.value; renderPreview(); };
  bungkus.appendChild(nama);

  var unggah = document.createElement('input');
  unggah.type = 'file';
  unggah.className = 'block-file-unggah';
  unggah.onchange = function () {
    var berkas = unggah.files && unggah.files[0];
    if (!berkas) return;
    // 8 MB: batas yang sama dengan pengunduh di sisi bot.
    if (berkas.size > 8 * 1024 * 1024) {
      alert('Berkas lebih dari 8 MB. Pakai URL, atau perkecil dulu.');
      unggah.value = '';
      return;
    }
    var pembaca = new FileReader();
    pembaca.onload = function () {
      blocks[index].data = String(pembaca.result || '');
      blocks[index].value = '';
      blocks[index].name = berkas.name;
      renderBlocks();
      renderPreview();
    };
    pembaca.readAsDataURL(berkas);
  };
  bungkus.appendChild(unggah);

  bungkus.appendChild(buatSakelar(index, 'spoiler', 'Sembunyikan sebagai spoiler'));
  return bungkus;
}


/**
 * Versi format JSON. Dinaikkan kalau bentuk blok berubah dan impor lama perlu
 * diterjemahkan. Tanpa ini, berkas cadangan lama akan gagal tanpa penjelasan.
 */
var JSON_VERSION = 1;

/**
 * Ekspor susunan pesan ke JSON.
 *
 * Yang diekspor: nama, warna aksen, pengirim, dan semua blok. Yang TIDAK:
 * channel tujuan (ID channel berbeda di tiap server) dan data berkas unggahan
 * (base64 bisa puluhan MB, dan tidak berguna di server lain).
 */

/**
 * Sanitasi RINGAN untuk JSON yang diimpor.
 *
 * Bukan pengganti sanitizer di server — server tetap menyaring ulang setiap
 * kali pesan disimpan, dan itulah yang menentukan. Tujuan versi ini hanya
 * menjaga editor tetap waras: membuang blok yang jenisnya tidak dikenal dan
 * merapikan nilai yang jelas salah, supaya admin melihat hasil impor yang
 * masuk akal, bukan daftar blok yang berantakan.
 */
function sanitizeImported(input) {
  var sah = Object.keys(LABEL);
  var hasil = [];
  var dibuang = [];
  if (!Array.isArray(input)) return { blocks: hasil, dropped: ['isinya bukan daftar'] };

  for (var i = 0; i < input.length; i += 1) {
    var b = input[i];
    if (!b || typeof b !== 'object') {
      dibuang.push('blok ke-' + (i + 1) + ' bukan objek');
      continue;
    }
    var kind = typeof b.kind === 'string' ? b.kind : '';
    if (sah.indexOf(kind) === -1) {
      dibuang.push('jenis blok tidak dikenal: ' + String(kind).slice(0, 20));
      continue;
    }
    // Blok isi tanpa apa pun tidak berguna; blok struktur tetap diterima.
    var nilai = typeof b.value === 'string' ? b.value : '';
    var data = typeof b.data === 'string' ? b.data : '';
    if (kind === 'text' && !nilai.trim()) {
      dibuang.push('teks kosong');
      continue;
    }
    if ((kind === 'image' || kind === 'file') && !nilai.trim() && !data) {
      dibuang.push(kind + ' tanpa gambar/berkas');
      continue;
    }
    hasil.push(normalBlock(b));
  }
  return { blocks: hasil, dropped: dibuang };
}

function exportJson() {
  var isi = payloadBlocks();
  if (isi.length === 0) return toast('Belum ada isi untuk diekspor', true);
  var data = {
    format: 'zypher-post',
    version: JSON_VERSION,
    name: (document.getElementById('postName') || {}).value || '',
    accent: accentNow(),
    sender: (document.getElementById('postSender') || {}).value || 'bot',
    blocks: isi,
    /*
     * Bagian embed ikut diekspor: tanpa ini, ekspor lalu impor ulang
     * diam-diam menghapus penulis/footer/bidang yang sudah ditulis admin.
     */
    embed: payloadEmbed(),
  };
  var teks = JSON.stringify(data, null, 2);
  var kotak = document.getElementById('jsonText');
  if (kotak) kotak.value = teks;
  var status = document.getElementById('jsonStatus');
  if (status) status.textContent = '✅ Siap — ' + isi.length + ' blok (' + Math.round(teks.length / 1024) + ' KB)';

  // Salin ke papan klip kalau browser mengizinkan; kalau tidak, admin masih
  // bisa memilih teks di kotak. Kegagalan menyalin bukan alasan menggagalkan
  // ekspor, jadi tidak ada error yang ditampilkan.
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(teks).then(function () {
      var st = document.getElementById('jsonStatus');
      if (st) st.textContent = '✅ Tersalin ke papan klip — ' + isi.length + ' blok';
    }, function () {});
  }
}

/**
 * Impor JSON ke editor.
 *
 * Memakai sanitizer yang SAMA dengan penyimpanan di server, jadi JSON yang
 * rusak atau berisi jenis blok asing tidak bisa menyusup ke editor. Blok yang
 * dibuang dilaporkan ke admin, bukan hilang diam-diam.
 */
function importJson() {
  var kotak = document.getElementById('jsonText');
  var status = document.getElementById('jsonStatus');
  var teks = kotak ? String(kotak.value || '').trim() : '';
  if (!teks) return toast('Tempel JSON dulu di kotak', true);

  var data;
  try {
    data = JSON.parse(teks);
  } catch (error) {
    toast('JSON tidak valid: ' + error.message, true);
    return;
  }
  if (!data || !Array.isArray(data.blocks)) {
    toast('JSON tidak dikenali — harus punya bagian "blocks" berupa daftar', true);
    return;
  }
  if (data.format && data.format !== 'zypher-post') {
    toast('Berkas ini bukan ekspor halaman /pesan', true);
    return;
  }

  var bersih = sanitizeImported(data.blocks);
  if (bersih.blocks.length === 0) {
    toast('Tidak ada blok yang bisa dipakai: ' + (bersih.dropped[0] || 'isinya kosong'), true);
    return;
  }

  blocks = bersih.blocks;
  if (data.name) document.getElementById('postName').value = String(data.name).slice(0, 120);
  if (data.accent) document.getElementById('postAccent').value = data.accent;
  if (data.sender) {
    var pengirim = document.getElementById('postSender');
    if (pengirim) pengirim.value = data.sender;
  }
  editingId = null; // hasil impor = pesan baru, bukan menimpa yang lama
  // Bagian embed ikut dokumen: dokumen tanpa bagian ini harus MENGOSONGKAN
  // isian lama, bukan menyisakan penulis milik pesan sebelumnya.
  if (data.embed && typeof data.embed === 'object') loadEmbedExtra(data.embed);
  else resetEmbedExtra();
  renderBlocks();
  renderPreview();

  var pesan = '✅ ' + bersih.blocks.length + ' blok dimuat — tekan Simpan untuk menyimpan sebagai pesan baru';
  if (bersih.dropped.length) pesan += '. ' + bersih.dropped.length + ' blok dibuang: ' + bersih.dropped[0];
  if (status) status.textContent = pesan;
  toast(pesan);
  showPesanTab('susun');
}


/**
 * Bentuk baku satu blok di editor.
 *
 * Semua field yang dikenal ikut dimuat. Kalau ada field yang tertinggal di
 * sini, membuka pesan lama (atau mengimpor JSON) lalu menyimpannya akan
 * MENGHAPUS field itu tanpa peringatan — bug yang sudah pernah terjadi pada
 * warna container dan akan terjadi lagi pada spoiler/berkas kalau tidak
 * dirawat di satu tempat.
 */
function normalBlock(b) {
  return {
    kind: b.kind,
    value: b.value || '',
    url: b.url || '',
    data: b.data || '',
    accent: b.accent || '',
    thumbnail: b.thumbnail || '',
    accessoryLabel: b.accessoryLabel || '',
    spacing: b.spacing || '',
    // Aksesori blok teks/gambar (hasil impor maupun data tersimpan).
    accessoryUrl: b.accessoryUrl || '',
    // Berkas: nama unduhan dan penanda spoiler.
    name: b.name || '',
    spoiler: Boolean(b.spoiler),
    blockId: b.blockId || '',
    // Emoji & gaya tombol. Tanpa dua baris ini, mengimpor pesan Discohook
    // lalu menyimpannya akan membuang emoji tombol — bug yang sama seperti
    // dulu pada warna container dan spoiler.
    emoji: b.emoji || '',
    style: b.style || '',
    // Tombol nonaktif dan pemisah tanpa garis (fitur Discohook).
    disabled: Boolean(b.disabled),
    divider: b.divider === false ? false : true,
    // Alt text gambar, dibaca pembaca layar.
    alt: b.alt || '',
    /*
     * Select menu. Tanpa enam baris ini, mengimpor dropdown Discohook lalu
     * menyimpannya akan mengubahnya jadi select string kosong — pilihan dan
     * batas min/maks hilang tanpa jejak.
     */
    selectKind: typeof b.selectKind === 'string' ? b.selectKind : '',
    placeholder: b.placeholder || '',
    minValues: typeof b.minValues === 'number' ? b.minValues : 1,
    maxValues: typeof b.maxValues === 'number' ? b.maxValues : 1,
    options: Array.isArray(b.options)
      ? b.options.filter(function (o) { return o && o.label; }).map(function (o) {
          return {
            label: String(o.label),
            value: String(o.value || o.label),
            description: o.description ? String(o.description) : '',
            emoji: o.emoji ? String(o.emoji) : '',
          };
        })
      : [],
    selectDisabled: Boolean(b.selectDisabled),
    /*
     * Pilihan bawaan. Disimpan sebagai daftar ID; tanpa ini mengimpor lalu
     * menyimpan ulang akan menghapus pilihan bawaan yang sudah disusun.
     */
    defaultValues: Array.isArray(b.defaultValues) ? b.defaultValues.map(String) : [],
  };
}

/**
 * Muat pesan Discord yang sudah terkirim ke editor.
 *
 * Padanan tombol "Load" Discohook. Yang dikirim hanya TAUTAN: pesannya diambil
 * server lewat bot (browser tidak punya token bot, dan tidak boleh punya).
 *
 * Hasilnya menjadi pesan BARU di dashboard — pesan lama di Discord tidak
 * berubah sampai admin menekan Kirim. Kalau alamat pesan asalnya tujuan pesan
 * yang sama, admin diberi tahu bahwa pesan itu akan DIPERBARUI, bukan
 * diduplikasi.
 */
async function muatPesanDiscord() {
  var kotak = document.getElementById('muatTautan');
  var status = document.getElementById('muatStatus');
  var sumberEl = document.getElementById('muatSumber');
  var tautan = kotak ? String(kotak.value || '').trim() : '';
  if (!tautan) return toast('Tempel tautan pesan Discord dulu', true);
  if (status) status.textContent = 'Memuat pesan…';

  var hasil;
  try {
    hasil = await api('/api/posts/load', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: tautan }),
    });
  } catch (error) {
    if (status) status.textContent = '';
    return toast('Gagal memuat: ' + error.message, true);
  }

  blocks = (hasil.blocks || []).map(normalBlock);
  editingId = null;
  loadEmbedExtra(hasil.embed);
  var bentuk = document.getElementById('postLayout');
  if (bentuk) bentuk.value = hasil.layout === 'embed' ? 'embed' : 'container';

  /*
   * Nama pesan TIDAK ditimpa kalau sudah diisi: admin mungkin sedang menyusun
   * pesan dan memuat pesan lain sebagai rujukan isinya.
   */
  var nama = document.getElementById('postName');
  if (nama && hasil.name && !nama.value) nama.value = String(hasil.name).slice(0, 120);

  var warna = blocks.filter(function (b) { return b.kind === 'container' && b.accent; })[0];
  if (warna) {
    var el = document.getElementById('postAccent');
    if (el) el.value = warna.accent;
    var teksWarna = document.getElementById('accentText');
    if (teksWarna) teksWarna.textContent = warna.accent;
  }

  renderBlocks();
  renderEmbedExtra();
  renderPreview();

  /*
   * Alamat asal disimpan di variabel halaman, bukan langsung dipakai: tombol
   * Kirim tetap harus ditekan admin. Dashboard memakai ini untuk mengingatkan
   * bahwa pesan asalnya bisa diperbarui.
   */
  MUAT_SUMBER = hasil.source || null;
  if (sumberEl) {
    sumberEl.textContent = hasil.source
      ? 'Asal: channel ' + hasil.source.channelId + ', pesan ' + hasil.source.messageId +
        (hasil.source.webhook ? ' (dikirim webhook)' : '') +
        ' — tekan Kirim untuk memuatnya sebagai pesan dashboard.'
      : '';
  }

  var peringatan = hasil.warnings || [];
  var ringkas = '✅ ' + blocks.length + ' blok dimuat dari Discord';
  if (peringatan.length) ringkas += '. ' + peringatan.length + ' catatan: ' + peringatan[0];
  if (status) status.textContent = ringkas;
  toast(ringkas);
  showPesanTab('susun');
}

/**
 * Impor pesan Discohook.
 *
 * Yang dikirim ke server hanya **tautan** (atau JSON mentah kalau admin
 * menempelnya). Penerjemahan komponen Discohook -> blok dilakukan di server
 * (src/features/discohook-import.ts), dan alasannya bukan sekadar kerapian:
 *
 *   - Discohook tidak mengirim header CORS pada 'api/v1/share', jadi
 *     'fetch' dari halaman dashboard akan ditolak browser.
 *   - Hanya server yang boleh menentukan host mana yang diunduh. Kalau
 *     browser yang mengunduh lalu mengirim hasilnya, endpoint impor menjadi
 *     alat untuk membaca alamat internal (SSRF).
 *
 * Hasilnya SAMA dengan yang nanti dikirim ke Discord, karena server juga
 * melewatkannya ke sanitizeBlocks sebelum dikembalikan.
 */
async function importDiscohook() {
  var kotak = document.getElementById('discoText');
  var status = document.getElementById('discoStatus');
  var teks = kotak ? String(kotak.value || '').trim() : '';
  if (!teks) return toast('Tempel tautan share Discohook dulu', true);

  if (status) status.textContent = 'Menarik dari Discohook…';

  // JSON ditempel langsung, atau tautan/ID share. Keduanya ke endpoint sama.
  var body = { url: teks };
  if (teks.charAt(0) === '{') {
    try {
      body = { json: JSON.parse(teks) };
    } catch (error) {
      if (status) status.textContent = '';
      return toast('JSON tidak valid: ' + error.message, true);
    }
  }

  var hasil;
  try {
    hasil = await api('/api/posts/import/discohook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (status) status.textContent = '';
    return toast('Gagal impor: ' + error.message, true);
  }

  var pesan = (hasil.messages || [])[0];
  if (!pesan) {
    if (status) status.textContent = '';
    return toast('Tidak ada pesan yang bisa diimpor', true);
  }

  // Selalu jadi pesan BARU: menimpa pesan lama tanpa diminta bukan hal yang
  // boleh dilakukan tombol "Tarik & impor".
  blocks = (pesan.blocks || []).map(normalBlock);
  editingId = null;
  /*
   * Impor Discohook yang isinya embed dikirim sebagai embed asli (bukan kartu
   * teks), lengkap dengan penulis/footer/bidangnya. Bentuk pesannya ikut
   * dipilih, jadi admin tidak perlu mengubah dropdown sendiri.
   */
  loadEmbedExtra(pesan.embed);
  var bentukImpor = document.getElementById('postLayout');
  if (bentukImpor) bentukImpor.value = pesan.layout === 'embed' ? 'embed' : 'container';
  if (pesan.name) {
    var nama = document.getElementById('postName');
    if (nama && !nama.value) nama.value = String(pesan.name).slice(0, 120);
  }

  // Warna aksen pesan diambil dari kartu pertama yang punya warna sendiri,
  // supaya pesan yang tidak memakai container tetap mirip aslinya.
  var berwarna = blocks.filter(function (b) { return b.kind === 'container' && b.accent; })[0];
  if (berwarna) {
    var warna = document.getElementById('postAccent');
    if (warna) warna.value = berwarna.accent;
    var teksWarna = document.getElementById('accentText');
    if (teksWarna) teksWarna.textContent = berwarna.accent;
  }

  renderBlocks();
  renderPreview();

  var peringatan = (pesan.warnings || []).concat(hasil.warnings || []);
  var ringkas = '✅ ' + blocks.length + ' blok dimuat dari Discohook';
  if (hasil.messages.length > 1) {
    // Discohook menyimpan beberapa pesan sekaligus. Yang diimpor adalah pesan
    // pertama; sisanya tidak dibuang diam-diam, tapi dilaporkan.
    ringkas += ' — pesan pertama dari ' + hasil.messages.length + ' (impor satu per satu untuk sisanya)';
  }
  if (peringatan.length) ringkas += '. ' + peringatan.length + ' catatan: ' + peringatan[0];
  if (status) status.textContent = ringkas;
  toast(ringkas);
  // Hasil impor langsung ditampilkan di tab Susun — kalau tetap di tab Impor,
  // admin tidak melihat apa pun berubah dan mengira impornya gagal.
  showPesanTab('susun');
}

/**
 * Kelompokkan blok menjadi "di luar kartu" dan "kartu".
 *
 * Ini aturan tampilan editor, dan sengaja fungsi murni supaya bisa diuji
 * tanpa DOM: hasilnya
 *
 *   [{ kartu: null, isi: [...] },        // komponen di luar kartu
 *    { kartu: <blok container>, isi: [...] }, // satu kartu beserta isinya
 *    { kartu: null, penutup: true, ... }] // baris "tutup kartu"
 *
 * Aturannya SAMA dengan penyusun payload: 'container' membuka kartu,
 * komponen sesudahnya masuk ke situ, 'close' mengeluarkan sisanya. Kalau
 * keduanya berbeda, admin melihat satu susunan di editor dan susunan lain di
 * Discord.
 *
 * Kalau pesan tidak punya container sama sekali, semua isi dikirim dalam satu
 * kartu bawaan — editor menampilkannya sebagai wadah luar biasa (tanpa kotak
 * kartu), karena admin tidak pernah menambahkan kartu itu.
 */
function kelompokkanBlok(daftar, logika) {
  var kelompok = [];
  var adaContainer = daftar.some(function (b) { return b.kind === 'container'; });
  var aktif = { kartu: null, indeks: -1, isi: [] };
  // Wadah luar awal hanya perlu kalau ada container eksplisit (komponen
  // sebelum container pertama tampil polos) atau pesan tanpa container.
  kelompok.push(aktif);

  /**
   * Mode LOGIKA (dipakai tombol ↑↓ editor).
   *
   * Editor mengelompokkan blok per kartu, tetapi blok row hanya bermakna di
   * dalam deretan tombol: Row di antara teks dan gambar tidak mengubah apa pun.
   * Saat admin menaikkan sebuah tombol ke atas Row, tombol itu berpindah
   * kartu — padahal di Discord ia tetap satu baris. Mode ini membuang Row yang
   * tidak lagi memisahkan tombol, supaya pemindahan tidak berujung pada blok
   * pengganggu yang harus dihapus manual.
   */
  /*
   * Pasangan blok + posisi ASLINYA di daftar blok.
   *
   * Posisi asli dipakai tombol naik/turun dan tombol hapus; kalau memakai
   * posisi di daftar yang sudah disaring, tombol akan mengubah blok yang
   * salah. Objek blok tidak bisa dijadikan kunci objek biasa (semuanya jadi
   * "[object Object]"), jadi pasangannya dikumpulkan di sini.
   */
  var pasangan = [];
  if (logika) {
    daftar.forEach(function (block, urut) {
      if (block.kind === 'row') {
        var sebelum = daftar[urut - 1];
        var sesudah = daftar[urut + 1];
        var berguna = Boolean(
          sebelum && sesudah && sebelum.kind === 'button' && sesudah.kind === 'button',
        );
        if (!berguna) return;
      }
      pasangan.push({ block: block, indeks: urut });
    });
  } else {
    daftar.forEach(function (block, urut) {
      pasangan.push({ block: block, indeks: urut });
    });
  }

  pasangan.forEach(function (item) {
    var block = item.block;
    var index = item.indeks;
    if (block.kind === 'container') {
      aktif = { kartu: block, indeks: index, isi: [] };
      kelompok.push(aktif);
      return;
    }
    if (block.kind === 'close') {
      // Penutup tidak punya isi sendiri; ia hanya memindahkan penulisan ke
      // luar kartu. Ditampilkan sebagai baris penanda supaya admin melihat
      // batasnya, bukan menghilang tanpa jejak.
      /*
       * Penutup SELALU ditampilkan, termasuk pada pesan tanpa container
       * (mis. hasil impor Discohook, yang memakai 'close' di awal supaya
       * isinya tidak dibungkus kartu). Kalau barisnya disembunyikan, blok itu
       * tidak bisa dipilih untuk dihapus — admin melihat "di luar kartu" tanpa
       * tahu penyebabnya.
       */
      aktif = { kartu: null, indeks: index, penutup: true, isi: [] };
      kelompok.push(aktif);
      return;
    }
    if (aktif.penutup) {
      // Blok sesudah 'close' menempati wadah luar yang sama.
      if (aktif.isi.length > 0) {
        aktif = { kartu: null, indeks: -1, isi: [] };
        kelompok.push(aktif);
      }
      aktif.penutup = false;
      aktif.indeks = -1;
    }
    aktif.isi.push({ block: block, index: index });
  });

  // Wadah luar yang tidak berisi apa pun dibuang — kecuali baris penutup,
  // yang tetap ditampilkan supaya batas kartunya terlihat.
  return kelompok.filter(function (grup) {
    return grup.kartu || grup.penutup || grup.isi.length > 0;
  });
}

/**
 * Editor blok — digambar sebagai kartu BERTUMPUK, seperti Discohook.
 *
 * Alasannya bukan sekadar cantik: daftar datar menyembunyikan hal yang paling
 * penting saat menyusun pesan container, yaitu **bagian mana yang berada di
 * dalam kartu**. Di sini container menjadi kotak berwarna yang MENGANDUNG
 * komponen sesudahnya, dan setiap komponen punya ikon jenis + tombol
 * duplikat/hapus di kanan atas — tata letak yang sama dengan editor Discohook.
 *
 * Aturan yang dipakai untuk menyalin struktur Discohook ke struktur blok
 * /pesan (sama persis dengan yang dilakukan penyusun payload):
 *   - 'container' membuka kartu baru; komponen sesudahnya masuk ke kartu itu,
 *   - 'close' menutup kartu; komponen sesudahnya tampil di luar kartu,
 *   - tanpa 'close', kartu terakhir dianggap memuat semua sisa komponen.
 */
function renderBlocks() {
  var host = document.getElementById('blockList');
  host.innerHTML = '';
  if (blocks.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.textContent = 'Belum ada isi. Tambahkan komponen di bawah — atau tarik dari Discohook di tab Impor.';
    host.appendChild(kosong);
    return;
  }

  var kelompok = kelompokkanBlok(blocks);

  kelompok.forEach(function (grup) {
    /*
     * Kartu kosong tetap ditampilkan: admin baru saja menambahkannya dan butuh
     * tempat untuk mengatur warna/spoilernya. Wadah luar yang kosong tidak
     * pernah sampai ke sini karena kelompokkanBlok sudah membuangnya.
     */
    if (grup.kartu) {
      host.appendChild(buatKartuEditor(grup));
      return;
    }

    var wadah = document.createElement('div');
    wadah.className = 'blok-stack blok-stack-luar';
    if (grup.penutup) {
      var penanda = document.createElement('div');
      penanda.className = 'blok-pemisah-struktur';
      penanda.textContent = 'di luar kartu — semua komponen di bawah tampil polos';
      wadah.appendChild(penanda);
      // Baris kendali untuk blok 'close' itu sendiri (naik/turun/hapus).
      wadah.insertBefore(buatBarisStruktur(blocks[grup.indeks], grup.indeks), wadah.firstChild);
    }
    grup.isi.forEach(function (item) {
      wadah.appendChild(buatItemEditor(item.block, item.index));
    });
    host.appendChild(wadah);
  });

  renderPreview();
  renderUsage();
}

/** Baris kecil untuk blok struktural ('close') yang tidak punya isi sendiri. */
function buatBarisStruktur(block, index) {
  var baris = document.createElement('div');
  baris.className = 'blok-item';
  var head = document.createElement('div');
  head.className = 'blok-item-head';
  head.appendChild(ikonJenis('⤴'));
  var nama = document.createElement('span');
  nama.className = 'blok-nama';
  nama.textContent = 'Tutup kartu';
  head.appendChild(nama);
  var tag = document.createElement('span');
  tag.className = 'blok-tag';
  tag.textContent = 'struktur';
  head.appendChild(tag);
  head.appendChild(alatBlok(index));
  baris.appendChild(head);
  return baris;
}

/** Kartu container: kotak berwarna yang MENGANDUNG komponen sesudahnya. */
function buatKartuEditor(grup) {
  var block = grup.kartu;
  var index = grup.indeks;
  var kartu = document.createElement('div');
  kartu.className = 'blok-kartu';
  kartu.style.borderLeftColor = block.accent || accentNow();

  var head = document.createElement('div');
  head.className = 'blok-item-head';
  head.appendChild(ikonJenis('▭'));
  var nama = document.createElement('span');
  nama.className = 'blok-nama';
  nama.textContent = 'Container';
  head.appendChild(nama);

  // Warna aksen tampil langsung sebagai kotak kecil — sama seperti Discohook.
  var warna = document.createElement('input');
  warna.type = 'color';
  warna.value = block.accent || accentNow();
  warna.title = 'Warna aksen container ini';
  warna.style.cssText = 'width:26px;height:20px;padding:0;border:1px solid var(--line);border-radius:4px;background:var(--panel);flex:0 0 auto';
  warna.oninput = function () {
    blocks[index].accent = warna.value;
    kartu.style.borderLeftColor = warna.value;
    renderPreview();
  };
  head.appendChild(warna);

  var ikut = document.createElement('button');
  ikut.className = 'btn btn-ghost btn-sm';
  ikut.type = 'button';
  ikut.textContent = 'Ikut warna pesan';
  ikut.title = 'Container memakai warna aksen pesan';
  ikut.onclick = function () {
    blocks[index].accent = '';
    renderBlocks();
    renderPreview();
  };
  head.appendChild(ikut);

  if (blocks[index].spoiler) {
    var tagSpoiler = document.createElement('span');
    tagSpoiler.className = 'blok-tag blok-tag-warn';
    tagSpoiler.textContent = 'spoiler';
    head.appendChild(tagSpoiler);
  }
  head.appendChild(alatBlok(index));
  kartu.appendChild(head);

  /*
   * Pengaturan container: spoiler. Ditaruh di baris head, bukan kotak besar,
   * supaya kartu tetap ringkas dan isinya yang jadi fokus.
   */
  var pengaturan = document.createElement('div');
  pengaturan.className = 'blok-item-isi';
  pengaturan.style.paddingTop = '8px';
  pengaturan.style.paddingBottom = '0';
  pengaturan.appendChild(buatSakelar(index, 'spoiler', 'Spoiler — isi kartu tertutup sampai diklik'));
  kartu.appendChild(pengaturan);

  var isi = document.createElement('div');
  isi.className = 'blok-kartu-isi';
  if (grup.isi.length === 0) {
    var kosong = document.createElement('div');
    kosong.className = 'blok-stack-kosong';
    kosong.textContent = 'Kartu kosong — tambahkan komponen, atau tekan × untuk membuangnya.';
    isi.appendChild(kosong);
  }
  grup.isi.forEach(function (item) {
    isi.appendChild(buatItemEditor(item.block, item.index));
  });
  kartu.appendChild(isi);
  return kartu;
}

/** Ikon kecil penanda jenis komponen. */
function ikonJenis(teks) {
  var el = document.createElement('span');
  el.className = 'blok-ikon';
  el.textContent = teks;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Tombol ⧉ duplikat & × hapus di kanan atas komponen (pola Discohook). */
function alatBlok(index) {
  var alat = document.createElement('div');
  alat.className = 'blok-aksi';

  {
    if (index > 0) {
      var up = document.createElement('button');
      up.className = 'btn-ghost btn-sm btn-icon';
      up.type = 'button';
      up.title = 'Naikkan';
      up.setAttribute('aria-label', 'Naikkan komponen');
      up.textContent = '↑';
      up.onclick = function () { moveBlock(index, -1); };
      alat.appendChild(up);
    }
    if (index < blocks.length - 1) {
      var down = document.createElement('button');
      down.className = 'btn-ghost btn-sm btn-icon';
      down.type = 'button';
      down.title = 'Turunkan';
      down.setAttribute('aria-label', 'Turunkan komponen');
      down.textContent = '↓';
      down.onclick = function () { moveBlock(index, 1); };
      alat.appendChild(down);
    }
  }

  var dup = document.createElement('button');
  dup.className = 'btn-ghost btn-sm btn-icon';
  dup.type = 'button';
  dup.title = 'Duplikat komponen';
  dup.setAttribute('aria-label', 'Duplikat komponen');
  dup.textContent = '⧉';
  dup.onclick = function () { duplicateBlock(index); };
  alat.appendChild(dup);

  var del = document.createElement('button');
  del.className = 'btn-danger btn-sm btn-icon';
  del.type = 'button';
  del.title = 'Hapus komponen';
  del.setAttribute('aria-label', 'Hapus komponen');
  del.textContent = '×';
  del.onclick = function () { removeBlock(index); };
  alat.appendChild(del);
  return alat;
}

var IKON = {
  text: 'T',
  image: '▣',
  button: '🔗',
  divider: '―',
  container: '▭',
  section: '▤',
  close: '⤴',
  file: '📄',
  select: '⌄',
  row: '⇥'
};

/**
 * Satu komponen di dalam kartu: judul kecil + isian.
 *
 * Semua isian dibuat dengan createElement/textContent, tidak lewat innerHTML:
 * isi blok berasal dari admin (dan dari impor Discohook), jadi tidak boleh ada
 * jalan masuk HTML ke halaman dashboard.
 */
function buatItemEditor(block, index) {
  var baris = document.createElement('div');
  baris.className = 'blok-item';

  var head = document.createElement('div');
  head.className = 'blok-item-head';
  head.appendChild(ikonJenis(IKON[block.kind] || '•'));

  var label = document.createElement('span');
  label.className = 'blok-nama';
  label.textContent = LABEL[block.kind] || block.kind;
  head.appendChild(label);

  // Penanda kecil yang menjelaskan keadaan komponen tanpa membuka isiannya.
  if (block.kind === 'image' && block.spoiler) head.appendChild(tagKecil('spoiler'));
  if (block.kind === 'button' && block.disabled) head.appendChild(tagKecil('nonaktif'));
  if (block.kind === 'divider' && block.divider === false) head.appendChild(tagKecil('tanpa garis'));
  if (block.kind === 'section' && block.accessoryLabel) head.appendChild(tagKecil('tombol'));
  if (block.kind === 'section' && !block.accessoryLabel && block.thumbnail) head.appendChild(tagKecil('thumbnail'));
  if (block.kind === 'file' && block.spoiler) head.appendChild(tagKecil('spoiler'));
  if (block.kind === 'select') head.appendChild(tagKecil(selectJenisLabel(block)));
  if (block.kind === 'select' && block.selectDisabled) head.appendChild(tagKecil('nonaktif'));
  if (block.kind === 'select' && block.selectKind === 'string') {
    head.appendChild(tagKecil((block.options || []).length + ' pilihan'));
  }

  head.appendChild(alatBlok(index));
  baris.appendChild(head);

  var isi = document.createElement('div');
  isi.className = 'blok-item-isi';

  if (block.kind === 'divider') {
    var garis = document.createElement('div');
    garis.className = 'block-divider';
    if (block.divider === false) garis.style.background = 'transparent';
    isi.appendChild(garis);

    var jarak = document.createElement('div');
    jarak.className = 'menu-flags';

    var cekJarak = document.createElement('input');
    cekJarak.type = 'checkbox';
    cekJarak.checked = block.spacing === 'large';
    cekJarak.onchange = function () {
      blocks[index].spacing = cekJarak.checked ? 'large' : '';
      renderPreview();
    };
    jarak.appendChild(cekJarak);
    jarak.appendChild(document.createTextNode(' jarak besar'));

    /*
     * Garis pemisah bisa dimatikan (Discord: divider: false) — hasilnya
     * hanya jarak kosong. Discohook menampilkannya sebagai centang
     * "Show Divider"; di sini dibalik supaya lebih jelas maksudnya.
     */
    var cekGaris = document.createElement('input');
    cekGaris.type = 'checkbox';
    cekGaris.checked = block.divider !== false;
    cekGaris.onchange = function () {
      blocks[index].divider = cekGaris.checked;
      renderBlocks();
      renderPreview();
    };
    jarak.appendChild(cekGaris);
    jarak.appendChild(document.createTextNode(' tampilkan garis'));
    isi.appendChild(jarak);
  } else if (block.kind === 'section') {
    var taSection = document.createElement('textarea');
    taSection.rows = Math.min(8, Math.max(2, lineCount(block.value)));
    taSection.value = block.value || '';
    taSection.placeholder = 'Teks section…';
    taSection.oninput = function () { blocks[index].value = taSection.value; renderPreview(); };
    isi.appendChild(taSection);

    var barisAks = document.createElement('div');
    barisAks.className = 'role-style-row';

    // Aksesori: satu saja. Discord menolak section dengan dua aksesori.
    var thumb = document.createElement('input');
    thumb.type = 'text';
    thumb.value = block.thumbnail || '';
    thumb.placeholder = 'URL gambar kecil (kanan)';
    thumb.disabled = Boolean(block.accessoryLabel);
    thumb.oninput = function () {
      blocks[index].thumbnail = thumb.value;
      renderPreview();
    };
    barisAks.appendChild(thumb);
    isi.appendChild(barisAks);

    var barisTombol = document.createElement('div');
    barisTombol.className = 'role-style-row';
    var labelAks = document.createElement('input');
    labelAks.type = 'text';
    labelAks.value = block.accessoryLabel || '';
    labelAks.placeholder = 'Label tombol (kanan)';
    labelAks.oninput = function () {
      blocks[index].accessoryLabel = labelAks.value;
      thumb.disabled = Boolean(labelAks.value);
      renderPreview();
    };
    barisTombol.appendChild(labelAks);

    var urlAks = document.createElement('input');
    urlAks.type = 'text';
    urlAks.value = block.url || '';
    urlAks.placeholder = 'https://…';
    urlAks.oninput = function () { blocks[index].url = urlAks.value; renderPreview(); };
    barisTombol.appendChild(urlAks);

    var emojiAks = document.createElement('input');
    emojiAks.type = 'text';
    emojiAks.className = 'role-emoji';
    emojiAks.value = block.emoji || '';
    emojiAks.placeholder = '🎮';
    emojiAks.title = 'Emoji tombol aksesori (opsional)';
    emojiAks.oninput = function () { blocks[index].emoji = emojiAks.value.slice(0, 80); renderPreview(); };
    barisTombol.appendChild(emojiAks);
    isi.appendChild(barisTombol);

    isi.appendChild(buatSakelar(index, 'disabled', 'Tombol nonaktif'));
  } else if (block.kind === 'select') {
    isi.appendChild(buatEditorSelect(index));
    /*
     * Aksi untuk menu ini. Targetnya select:<jenis> karena customId menu
     * hanya membawa jenis (bukan ID baris): semua select berjenis sama di satu
     * pesan memakai aksi yang sama. Itu batas nyata dari customId, dan lebih
     * jujur ditampilkan begitu daripada menjanjikan aksi per menu.
     */
    isi.appendChild(
      kartuAksi('select:' + (block.selectKind || 'string'), 'menu ' + selectJenisLabel(block)),
    );
    if ((block.selectKind || 'string') === 'string') {
      var ketPilihan = document.createElement('p');
      ketPilihan.className = 'hint';
      ketPilihan.style.margin = '0';
      ketPilihan.textContent =
        'Aksi di atas berlaku untuk SEMUA pilihan yang tidak punya aksi sendiri. Untuk aksi khusus satu pilihan, atur di daftar pilihan di atas.';
      isi.appendChild(ketPilihan);
    }
  } else if (block.kind === 'row') {
    /*
     * Row tidak punya isian: ia hanya pemisah. Penjelasan singkat dipakai
     * supaya admin tahu kenapa tombol di bawahnya pindah baris.
     */
    var ketRow = document.createElement('p');
    ketRow.className = 'hint';
    ketRow.style.margin = '0';
    /*
     * Row hanya berpengaruh di antara tombol: ia memotong deretan tombol yang
     * sedang menumpuk. Di posisi lain ia tidak mengubah apa pun, dan admin
     * perlu tahu itu — bukan mengira susunannya sudah terpisah.
     */
    var lanjutan = blocks[index + 1];
    ketRow.textContent = lanjutan && lanjutan.kind === 'button'
      ? 'Tombol sesudah baris ini dikirim di baris BARU — tombol sebelumnya tetap dikelompokkan sampai lima per baris.'
      : 'Row hanya berpengaruh di antara tombol. Blok sesudah ini bukan tombol, jadi baris ini belum memisahkan apa pun.';
    isi.appendChild(ketRow);
  } else if (block.kind === 'close') {
    var ketTutup = document.createElement('p');
    ketTutup.className = 'hint';
    ketTutup.style.margin = '0';
    ketTutup.textContent = 'Komponen sesudah ini tampil DI LUAR kartu — polos di pesan, seperti teks pembuka dan baris tombol di Discohook. Tambahkan Container untuk masuk ke kartu lagi.';
    isi.appendChild(ketTutup);
  } else if (block.kind === 'text') {
    var ta = document.createElement('textarea');
    ta.rows = Math.min(10, Math.max(2, lineCount(block.value)));
    ta.value = block.value;
    ta.placeholder = 'Tulis isi pesan… (mendukung **tebal**, ### judul, -# teks kecil)';
    ta.oninput = function () { blocks[index].value = ta.value; renderPreview(); };
    isi.appendChild(ta);
    // Aksesori teks — sama seperti "Add Accessory" di Discohook.
    isi.appendChild(buatAksesori(index));
  } else if (block.kind === 'file') {
    isi.appendChild(buatEditorFile(index));
  } else {
    var input = document.createElement('input');
    input.type = 'text';
    input.value = block.value;
    input.placeholder = block.kind === 'image' ? 'https://…/gambar.png' : 'Label tombol';
    input.oninput = function () { blocks[index].value = input.value; renderPreview(); };
    isi.appendChild(input);

    if (block.kind === 'image') {
      // Alt text: deskripsi gambar untuk pembaca layar dan saat gagal muat.
      var alt = document.createElement('input');
      alt.type = 'text';
      alt.value = block.alt || '';
      alt.placeholder = 'Deskripsi gambar (alt text, opsional)';
      alt.oninput = function () { blocks[index].alt = alt.value.slice(0, 1024); renderPreview(); };
      isi.appendChild(alt);
      isi.appendChild(buatAksesori(index));

      var opsiGambar = document.createElement('div');
      opsiGambar.className = 'menu-flags';
      opsiGambar.appendChild(buatSakelar(index, 'spoiler', 'Sembunyikan sebagai spoiler'));
      isi.appendChild(opsiGambar);

      // Unggah dari komputer: hasilnya data URI yang disimpan di blok.
      var baris = document.createElement('div');
      baris.style.display = 'flex';
      baris.style.gap = '8px';
      baris.style.alignItems = 'center';
      baris.style.flexWrap = 'wrap';

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
      isi.appendChild(baris);
    }

    if (block.kind === 'button') {
      var url = document.createElement('input');
      url.type = 'text';
      url.value = block.url || '';
      url.placeholder = 'https://discord.gg/… (wajib)';
      url.oninput = function () { blocks[index].url = url.value; renderPreview(); };
      isi.appendChild(url);

      var barisTombolLink = document.createElement('div');
      barisTombolLink.className = 'role-style-row';

      // Emoji tombol: diketik langsung, mis. 🎮 atau <:nama:123456789>.
      var emojiTombol = document.createElement('input');
      emojiTombol.type = 'text';
      emojiTombol.className = 'role-emoji';
      emojiTombol.value = block.emoji || '';
      emojiTombol.placeholder = '🎮';
      emojiTombol.title = 'Emoji di depan label — boleh emoji biasa atau <:nama:id>';
      emojiTombol.oninput = function () {
        blocks[index].emoji = emojiTombol.value.slice(0, 80);
        renderPreview();
      };
      barisTombolLink.appendChild(emojiTombol);
      barisTombolLink.appendChild(buatSakelar(index, 'disabled', 'Nonaktif (tidak bisa diklik)'));
      isi.appendChild(barisTombolLink);
    }
  }

  /*
   * Komponen tanpa isian (mis. hasil impor yang belum lengkap) tidak perlu
   * kotak isi kosong. Properti children dipakai, bukan childNodes: yang
   * dihitung hanya elemen, dan DOM tiruan pengaman UI menyediakan children.
   */
  if (isi.children.length > 0) baris.appendChild(isi);
  return baris;
}

/** Label kecil di kanan nama komponen. */
function tagKecil(teks) {
  var tag = document.createElement('span');
  tag.className = 'blok-tag';
  tag.textContent = teks;
  return tag;
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
  var blok = { kind: kind, value: '', url: '' };
  if (kind === 'container') blok.accent = '';
  if (kind === 'section') { blok.thumbnail = ''; blok.accessoryLabel = ''; }
  /*
   * Select baru selalu jenis string dengan satu pilihan contoh: menu tanpa
   * pilihan ditolak Discord, jadi blok yang baru ditambahkan harus langsung
   * bisa dipakai — bukan menunggu admin mengisi daftar dulu.
   */
  if (kind === 'select') {
    blok.kind = 'select';
    blok.selectKind = 'string';
    blok.placeholder = 'Pilih salah satu…';
    blok.minValues = 1;
    blok.maxValues = 1;
    blok.options = [{ label: 'Pilihan 1', value: 'pilihan-1' }];
  }
  blocks.push(blok);
  renderBlocks();
}
/** Salin blok ke posisi tepat di bawahnya — sama seperti tombol salin Discohook. */
function duplicateBlock(index) {
  var asli = blocks[index];
  if (!asli) return;
  /*
   * Salinan dalam (deep copy) perlu: blok container punya properti warna, blok
   * gambar punya data unggahan, dan blok file punya nama. Kalau hanya di-shallow
   * copy, dua blok akan berbagi objek yang sama sehingga mengubah satu ikut
   * mengubah yang lain.
   */
  var salinan = JSON.parse(JSON.stringify(asli));
  // blockId harus unik: kalau tidak, select menu role dua blok bertabrakan.
  if (salinan.blockId) salinan.blockId = '';
  blocks.splice(index + 1, 0, salinan);
  renderBlocks();
  renderPreview();
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
    // Row adalah penanda struktur: tanpa Row, tombol setelahnya bergabung ke
    // baris sebelumnya dan susunan di Discord berbeda dari editor.
    if (b.kind === 'row') return true;
    /*
     * Select selalu dikirim kalau punya pilihan (jenis string) atau selalu
     * untuk jenis lain — daftarnya disediakan Discord. Menu string tanpa
     * pilihan memang ditolak server, dan blok itu dibuang saat render.
     */
    if (b.kind === 'select') {
      if ((b.selectKind || 'string') !== 'string') return true;
      return (b.options || []).length > 0;
    }
    // Container & tutup-kartu adalah penanda struktur: tanpa keduanya, blok
    // sesudahnya berpindah tempat dan tampilan pesan berubah tanpa admin sadar.
    if (b.kind === 'container' || b.kind === 'close') return true;
    if (b.kind === 'section') {
      return Boolean(String(b.value || '').trim() || String(b.thumbnail || '').trim());
    }
    if (b.kind === 'image') return Boolean(b.data || String(b.value || '').trim());
    return String(b.value || '').trim().length > 0;
  });
}

/* ---------------- Channel tambahan (targets[]) ---------------- */

/**
 * Channel tambahan untuk pesan yang sedang dibuka.
 *
 * Disimpan terpisah dari postChannel karena sifatnya berbeda: channel utama
 * bisa diganti tanpa mengubah pesan yang sudah terkirim di channel tambahan,
 * dan tiap channel punya ID pesan Discord sendiri.
 */
var TARGET_CHANNEL = [];

/** Batas channel tambahan — sama dengan POST_TARGET_LIMITS di server. */
var TARGET_MAKS = 5;

function renderTarget() {
  var host = document.getElementById('targetDaftar');
  if (!host) return;
  host.innerHTML = '';
  var status = document.getElementById('targetStatus');

  if (TARGET_CHANNEL.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.style.margin = '0';
    kosong.textContent = 'Hanya ke channel utama.';
    host.appendChild(kosong);
  }

  TARGET_CHANNEL.forEach(function (target, urutan) {
    var baris = document.createElement('div');
    baris.className = 'aksi-cabang-baris';

    var teks = document.createElement('span');
    teks.className = 'aksi-cabang-teks';
    teks.textContent = (urutan + 1) + '. #' + namaChannel(target.channelId);
    if (!target.messageId) teks.textContent += ' (belum terkirim)';
    baris.appendChild(teks);

    var hapus = document.createElement('button');
    hapus.className = 'btn-danger btn-sm btn-icon';
    hapus.type = 'button';
    hapus.title = 'Hapus channel ini';
    hapus.textContent = '×';
    hapus.onclick = function () {
      TARGET_CHANNEL.splice(urutan, 1);
      renderTarget();
    };
    baris.appendChild(hapus);
    host.appendChild(baris);
  });

  if (status) {
    status.textContent = TARGET_CHANNEL.length
      ? TARGET_CHANNEL.length + ' channel tambahan — pesan yang sama dikirim ke semuanya'
      : '';
  }
}

/** Nama channel dari daftar di halaman; ID mentah kalau tidak dikenal. */
function namaChannel(id) {
  var ketemu = (CHANNELS || []).filter(function (c) { return c.id === id; })[0];
  return ketemu ? ketemu.name : id;
}

function tambahTarget() {
  var pilih = document.getElementById('targetPilih');
  var id = pilih ? String(pilih.value || '').trim() : '';
  if (!id) return toast('Pilih channel dulu', true);
  if (id === ((document.getElementById('postChannel') || {}).value || '')) {
    return toast('Channel itu sudah jadi tujuan utama', true);
  }
  if (TARGET_CHANNEL.some(function (c) { return c.channelId === id; })) {
    return toast('Channel itu sudah ada di daftar', true);
  }
  if (TARGET_CHANNEL.length >= TARGET_MAKS) {
    return toast('Maksimal ' + TARGET_MAKS + ' channel tambahan', true);
  }
  TARGET_CHANNEL.push({ channelId: id, messageId: null });
  if (pilih) pilih.value = '';
  renderTarget();
}

/** Ambil daftar channel tambahan milik pesan yang dibuka. */
async function loadTargetsFor(postId) {
  resetTarget();
  if (!postId) return;
  try {
    var hasil = await api('/api/posts/' + postId + '/targets');
    TARGET_CHANNEL = (hasil.targets || []).map(function (c) {
      return { channelId: c.channelId, messageId: c.messageId };
    });
    renderTarget();
  } catch (error) {
    // Daftar kosong lebih jujur daripada daftar lama milik pesan lain.
    resetTarget();
  }
}

/** Kosongkan daftar saat membuka pesan lain / pesan baru. */
function resetTarget() {
  TARGET_CHANNEL = [];
  renderTarget();
}

/**
 * Simpan daftar channel tambahan setelah pesan punya ID.
 *
 * Dipisah dari simpan pesan karena endpoint-nya per pesan (targets), sama
 * seperti tombol role. Gagal di sini TIDAK menggagalkan simpan pesan: isi
 * pesannya sudah tersimpan, dan admin diberi tahu channel mana yang gagal.
 */
async function saveTargets(postId) {
  if (!postId) return;
  try {
    var hasil = await apiMetode('/api/posts/' + postId + '/targets', {
      channels: TARGET_CHANNEL.map(function (c) { return c.channelId; }),
    }, 'PUT');
    if (hasil.targets) {
      TARGET_CHANNEL = hasil.targets.map(function (c) { return { channelId: c.channelId, messageId: c.messageId }; });
      renderTarget();
    }
    if (hasil.dropped && hasil.dropped.length) toast(hasil.dropped[0], true);
  } catch (error) {
    toast('Channel tambahan gagal disimpan: ' + error.message, true);
  }
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
        /*
         * Flag digabung dari dua centang. Angkanya HARUS sama dengan yang
         * dipahami server (SUPPRESS_EMBEDS=4, SUPPRESS_NOTIFICATIONS=4096);
         * angka yang salah dibuang diam-diam oleh sanitizer, jadi salah ketik
         * di sini tidak akan terlihat sampai pesannya diperiksa di Discord.
         */
        flags: flagPesan(),
        allowedMentions: allowedMentionsPesan(),
        threadName: ((document.getElementById('postThreadName') || {}).value || '').trim().slice(0, 100),
        // '' = hanya manual; server membaca nilai asing sebagai null juga.
        trigger: (document.getElementById('postTrigger') || {}).value || null,
        layout: (document.getElementById('postLayout') || {}).value || 'container',
        /*
         * Bagian embed (penulis, footer, bidang). Dikirim walau bentuknya
         * container: admin bisa berpindah bentuk tanpa kehilangan tulisan yang
         * sudah dibuat, dan server hanya memakainya saat layout = embed.
         */
        embed: payloadEmbed(),
      }),
    });
    if (result.dropped && result.dropped.length) {
      toast('Sebagian blok dibuang: ' + result.dropped[0], true);
    } else {
      toast('✅ Pesan tersimpan');
    }
    // Tombol role & channel tambahan disimpan setelah pesan punya ID —
    // endpoint-nya per pesan.
    await saveRoleButtons(result.post.id);
    await saveTargets(result.post.id);

    if (andSend) {
      var kirim = await api('/api/posts/' + result.post.id + '/send', { method: 'POST' });
      /*
       * Server mengembalikan komponen/berkas yang TIDAK ikut terkirim.
       * Dulu daftar itu tidak pernah sampai ke dashboard, jadi admin mengira
       * pesannya utuh padahal ada bagian yang dilewati.
       */
      var lewat = [].concat(kirim.dropped || [], kirim.droppedFiles || []);
      if (lewat.length) {
        toast('Terkirim, tetapi ' + lewat.length + ' bagian dilewati: ' + lewat[0], true);
        setAksiStatus('⚠ Terkirim dengan catatan — ' + lewat[0]);
      } else {
        toast('✅ Terkirim ke Discord');
      }
    }

    /*
     * Selesai menyimpan, halaman TIDAK dimuat ulang.
     *
     * Dulu location.href = '/pesan' dipakai supaya daftar di atas ikut
     * segar, tetapi itu membuang tab yang sedang dibuka dan isian yang belum
     * tersimpan di tab lain. Sekarang: pesan yang baru disimpan menjadi
     * "pesan yang sedang diubah" (editingId), dan tautannya diperbarui tanpa
     * memuat ulang halaman — Simpan berikutnya memperbarui pesan yang sama,
     * bukan membuat duplikat.
     */
    editingId = result.post.id;
    try {
      var url = new URL(location.href);
      url.searchParams.set('id', String(result.post.id));
      history.replaceState(null, '', url.toString());
    } catch (e) {}
    var judulKirim = document.getElementById('postSend');
    if (judulKirim) judulKirim.textContent = 'Simpan & kirim ulang';
    /*
     * Riwayat yang tertanam di halaman sudah basi setelah menyimpan (versi
     * sebelum perubahan ini baru saja dibuat di server). Dibuang dari cache
     * lokal supaya tab Riwayat memuatnya lagi saat dibuka, bukan menampilkan
     * daftar lama tanpa versi terbaru.
     */
    delete RIWAYAT[result.post.id];
    setAksiStatus(
      andSend
        ? '✅ Tersimpan & terkirim ' + jamSekarang()
        : '✅ Tersimpan ' + jamSekarang() + ' — pesan berikutnya memperbarui pesan ini',
    );
  } catch (error) {
    toast('Gagal: ' + error.message, true);
    setAksiStatus('❌ Gagal: ' + error.message);
    button.disabled = false;
  }
}

/**
 * Tulis status kecil di bilah aksi (sebelah tombol Simpan).
 *
 * Dipakai supaya admin tahu hasil terakhir tanpa bergantung pada toast yang
 * hilang setelah beberapa detik — terutama setelah tab berpindah.
 */
function setAksiStatus(teks) {
  var el = document.getElementById('aksiStatus');
  if (el) el.textContent = teks || '';
}

function jamSekarang() {
  var d = new Date();
  var dua = function (n) { return (n < 10 ? '0' : '') + n; };
  return dua(d.getHours()) + ':' + dua(d.getMinutes());
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
  /*
   * Flag pesan: dicentang dari bitmask yang tersimpan. Nilai lain diabaikan —
   * hanya dua flag ini yang boleh diatur admin.
   */
  var flagEmbeds = document.getElementById('postFlagEmbeds');
  var flagNotif = document.getElementById('postFlagNotif');
  if (flagEmbeds) flagEmbeds.checked = Boolean((found.flags || 0) & 4);
  if (flagNotif) flagNotif.checked = Boolean((found.flags || 0) & 4096);
  /*
   * Pemicu event: nilai asing ditampilkan sebagai "hanya manual", bukan
   * dibiarkan memilih opsi pertama secara diam-diam — admin harus tahu
   * pesannya tidak lagi punya pemicu.
   */
  var bentuk = document.getElementById('postLayout');
  if (bentuk) bentuk.value = found.layout === 'embed' ? 'embed' : 'container';
  var pemicu = document.getElementById('postTrigger');
  if (pemicu) pemicu.value = found.trigger === 'member_add' || found.trigger === 'member_remove' ? found.trigger : '';
  // normalBlock memuat SEMUA field yang dikenal, termasuk spoiler dan nama
  // berkas — dulu daftarnya ditulis ulang di sini dan dua field itu tertinggal.
  blocks = found.blocks.map(normalBlock);
  // Bagian embed: dimuat dari pesan, bukan dibiarkan dari pesan sebelumnya.
  loadEmbedExtra(found.embed);
  var send = document.getElementById('postSend');
  if (send) send.textContent = 'Simpan & kirim ulang';
  loadRoleButtonsFor(found.id);
  loadActionsFor(found.id);
  /*
   * Riwayat: pakai data yang sudah tertanam di halaman (tidak ada permintaan
   * tambahan saat membuka pesan), lalu tetap bisa dimuat ulang dari tab.
   */
  if (RIWAYAT_AWAL[found.id]) RIWAYAT[found.id] = RIWAYAT_AWAL[found.id];
  loadTargetsFor(found.id);
  renderRiwayat();
  muatJadwal();
  renderRoleButtons();
  renderBlocks();
}


/* ---------------- Payload JSON & generator kode ---------------- */

/**
 * Muat payload komponen asli + kode hasil generate untuk pesan ini.
 *
 * Keduanya diambil dari SATU permintaan: server menyusun payload lewat jalur
 * pengiriman yang sama, lalu menerjemahkannya. Meminta dua kali bisa membuat
 * JSON dan kode berasal dari versi pesan yang berbeda.
 */
async function muatPayloadJson() {
  var status = document.getElementById('codegenStatus');
  if (!editingId) {
    if (status) status.textContent = 'Simpan pesan dulu — payload dihitung dari pesan yang tersimpan.';
    return;
  }
  var lib = (document.getElementById('codegenLib') || {}).value || 'djs14';
  if (status) status.textContent = 'Menyusun…';
  try {
    var hasil = await api('/api/posts/' + editingId + '/json?library=' + encodeURIComponent(lib));
    var json = document.getElementById('payloadJson');
    var kode = document.getElementById('codegenOut');
    if (json) {
      json.value = hasil.components
        ? JSON.stringify(
            {
              flags: hasil.flags,
              allowed_mentions: hasil.allowedMentions,
              thread_name: hasil.threadName || undefined,
              components: hasil.components
            },
            null,
            2
          )
        : 'Pesan ini belum punya komponen yang bisa dikirim.';
    }
    if (kode) {
      kode.value = [String((hasil.codegen && hasil.codegen.imports) || '').trim(), String((hasil.codegen && hasil.codegen.code) || '').trim()]
        .filter(Boolean)
        .join(String.fromCharCode(10) + String.fromCharCode(10));
    }
    var docs = document.getElementById('codegenDocs');
    if (docs) {
      var tautan = (hasil.codegen && hasil.codegen.documentation) || '';
      docs.textContent = tautan ? 'Dokumentasi: ' + tautan : '';
    }
    if (status) {
      var lewat = (hasil.dropped || []).concat((hasil.codegen && hasil.codegen.dropped) || []);
      status.textContent = lewat.length ? 'Sebagian bagian tidak ikut: ' + lewat[0] : '';
    }
  } catch (error) {
    if (status) status.textContent = 'Gagal: ' + error.message;
  }
}

/** Salin kode hasil generate (atau payload JSON kalau kodenya kosong). */
async function salinKode() {
  var kode = document.getElementById('codegenOut');
  var json = document.getElementById('payloadJson');
  var teks = (kode && kode.value) || (json && json.value) || '';
  if (!teks.trim()) return toast('Muat payload dulu', true);
  try {
    await navigator.clipboard.writeText(teks);
    toast('✅ Disalin');
  } catch (error) {
    if (kode) kode.select();
    toast('Salin manual: tekan Ctrl+C', true);
  }
}

/* ---------------- Riwayat versi & tautan berbagi ---------------- */

/**
 * Ambil riwayat versi dari server, lalu gambar daftarnya.
 *
 * Riwayat juga sudah dikirim saat halaman dimuat (RIWAYAT_AWAL), tetapi tombol
 * "Muat ulang" tetap ada: setelah beberapa kali menyimpan, daftar yang
 * tertanam di halaman sudah basi dan admin perlu melihat versi barunya tanpa
 * memuat ulang seluruh halaman.
 */
/**
 * Riwayat yang sudah dimuat bersama halaman: { pesanId: [...] }.
 *
 * Langsung dipakai supaya tab Riwayat tidak berkedip kosong saat dibuka.
 */
var RIWAYAT_AWAL = ${jsonForScript(options.revisions ?? {})};
var RIWAYAT = {};
/**
 * Escape teks untuk disisipkan ke HTML.
 *
 * Fungsi escape dari base.ts hanya dipakai saat server menyusun halaman; kode
 * di dalam script browser tidak melihat fungsi itu. Nama dan waktu versi berasal dari
 * database (nama pesan pernah disunting admin), jadi tetap harus di-escape.
 */
function escAman(teks) {
  return String(teks == null ? '' : teks)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
/** Ikon jam untuk baris riwayat — disisipkan server, bukan digambar di sini. */
var IKON_JAM = ${jsonForScript(icon('clock', 15))};

async function muatRiwayat() {
  if (!editingId) {
    setRiwayatStatus('Simpan pesan ini dulu — riwayat dibuat otomatis sejak penyimpanan pertama.');
    return;
  }
  setRiwayatStatus('Memuat…');
  try {
    var hasil = await api('/api/posts/' + editingId + '/revisions');
    RIWAYAT[editingId] = (hasil.revisions || []).map(function (satu) {
      return { id: satu.id, name: satu.name, createdAt: satu.createdAt };
    });
    renderRiwayat();
    setRiwayatStatus(RIWAYAT[editingId].length ? '' : 'Belum ada versi lama — versi disimpan setiap kali pesan diubah.');
  } catch (error) {
    setRiwayatStatus('Gagal memuat riwayat: ' + error.message);
  }
}

function setRiwayatStatus(teks) {
  var el = document.getElementById('riwayatStatus');
  if (el) el.textContent = teks || '';
}

/**
 * Gambar satu baris per versi.
 *
 * Waktu memakai format lokal (bukan "3 jam lalu"): yang dicari admin biasanya
 * versi sebelum perubahan terakhir, dan jam persis lebih mudah dicocokkan
 * dengan ingatannya daripada selisih waktu yang terus berubah.
 */
function renderRiwayat() {
  var host = document.getElementById('riwayatList');
  if (!host) return;
  host.innerHTML = riwayatHtml();
}

/**
 * HTML daftar versi — dipisah dari penggambarnya supaya isinya bisa diperiksa
 * tanpa DOM sungguhan (uji UI memakai elemen tiruan yang tidak menyimpan HTML).
 */
/* ---------------- Diff versi ---------------- */

/**
 * Bandingkan satu versi lama dengan isi EDITOR saat ini.
 *
 * Pembanding dijalankan di browser, bukan server, karena isi editor bisa belum
 * disimpan. Membandingkan dengan versi tersimpan akan menjawab pertanyaan yang
 * tidak ditanyakan admin ("apa yang berubah sejak simpan terakhir") dan
 * menyembunyikan perubahan yang justru sedang ia kerjakan.
 */
async function bandingkanVersi(revisionId) {
  var panel = document.getElementById('diff-' + revisionId);
  if (!panel) return;
  /*
   * Status buka disimpan di atribut data-buka, bukan dibaca dari properti
   * hidden. Elemen panel dibuat dengan atribut hidden, tetapi hidden juga
   * dipakai saat gagal memuat — memakai properti yang sama untuk dua arti
   * membuat klik kedua justru membuka panel kosong.
   */
  if (panel.dataset.buka === '1') {
    panel.dataset.buka = '';
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  if (!editingId) return;
  panel.dataset.buka = '1';
  panel.hidden = false;
  panel.innerHTML = '<p class="hint" style="margin:6px 0 0">Memuat versi…</p>';
  try {
    /*
     * Snapshot diambil per versi, bukan ikut daftar: 20 versi × blok penuh
     * membuat halaman berat, padahal yang dibandingkan biasanya satu-dua saja.
     */
    var hasil = await api('/api/posts/' + editingId + '/revisions?revision=' + revisionId);
    if (!hasil.revision) throw new Error('versi tidak ditemukan');
    panel.innerHTML = renderDiff(diffRingkas(hasil.revision.snapshot, snapshotEditor()));
  } catch (error) {
    panel.dataset.buka = '';
    panel.hidden = true;
    panel.innerHTML = '';
    toast('Gagal memuat versi: ' + error.message, true);
  }
}

/** Kondisi editor saat ini dalam bentuk yang sama dengan snapshot versi. */
function snapshotEditor() {
  return {
    blocks: blocks.map(function (satu) {
      // Salin: pembanding tidak boleh menyentuh state editor.
      var salinan = {};
      Object.keys(satu).forEach(function (kunci) { salinan[kunci] = satu[kunci]; });
      return salinan;
    }),
    accent: accentNow(),
    sender: (document.getElementById('postSender') || {}).value || 'bot',
    flags: flagPesan(),
    allowedMentions: allowedMentionsPesan(),
    threadName: ((document.getElementById('postThreadName') || {}).value || '').trim() || null,
    // Tanpa dua baris ini, mengubah penulis/footer embed tidak terlihat di
    // panel Bandingkan — perubahan tampilannya jadi tidak pernah tercatat.
    layout: (document.getElementById('postLayout') || {}).value || 'container',
    embed: payloadEmbed() || []
  };
}

/** HTML panel diff: ringkasan, daftar perubahan, lalu teks lama/baru. */
function renderDiff(hasil) {
  var kepala = '<div class="diff-kepala">' + escAman(ringkasDiff(hasil)) + '</div>';
  if (!hasil.total) {
    return kepala + '<p class="hint" style="margin:6px 0 0">Isi editor sekarang sama dengan versi ini.</p>';
  }
  var daftar = hasil.baris.map(function (satu) {
    var jenis = satu.charAt(0) === '+' ? 'tambah' : satu.charAt(0) === '−' ? 'hapus' : 'ubah';
    // Karakter penanda dibuang; warnanya dibawa oleh kelas.
    return '<li class="diff-baris diff-' + jenis + '">' + escAman(satu.slice(2)) + '</li>';
  }).join('');
  var teks = hasil.teks.map(function (satu) {
    return '<div class="diff-teks">' +
      '<div class="diff-label">blok ' + satu.posisi + '</div>' +
      '<div class="diff-lama">' + escAman(satu.lama) + '</div>' +
      '<div class="diff-baru">' + escAman(satu.baru) + '</div>' +
    '</div>';
  }).join('');
  return kepala + '<ul class="diff-daftar">' + daftar + '</ul>' + teks;
}

function riwayatHtml() {
  if (!editingId) {
    return '<p class="hint" style="margin:0">Riwayat muncul untuk pesan yang sudah tersimpan.</p>';
  }
  var daftar = RIWAYAT[editingId] || [];
  if (!daftar.length) {
    return '<p class="hint" style="margin:0">Belum ada versi lama.</p>';
  }
  return daftar.map(function (versi) {
    return '<div class="list-row">' +
      '<span class="avatar-sm">' + IKON_JAM + '</span>' +
      '<div class="list-body">' +
        '<div class="list-title">' + escAman(versi.name || '(tanpa nama)') + '</div>' +
        '<div class="list-meta">disimpan ' + escAman(waktuLokal(versi.createdAt)) + '</div>' +
      '</div>' +
      '<div class="list-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" onclick="bandingkanVersi(' + versi.id + ')">Bandingkan</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" onclick="kembalikanVersi(' + versi.id + ')">Kembalikan</button>' +
      '</div>' +
    '</div>' +
    // Panel diff: diisi saat "Bandingkan" ditekan, bukan dirender di muka.
    '<div class="diff-panel" id="diff-' + versi.id + '" hidden></div>';
  }).join('');
}

async function kembalikanVersi(revisionId) {
  var ok = await askConfirm(
    'Kembalikan versi ini?',
    'Isi pesan diganti dengan versi itu. Blok yang sekarang otomatis tersimpan sebagai versi baru, jadi masih bisa dibalik.',
  );
  if (!ok) return;
  try {
    var hasil = await apiMetode('/api/posts/' + editingId + '/revisions', { revisionId: revisionId }, 'POST');
    var pesan = hasil.post;
    if (pesan) {
      document.getElementById('postName').value = pesan.name || '';
      document.getElementById('postChannel').value = pesan.channelId || '';
      blocks = (pesan.blocks || []).map(normalBlock);
      renderBlocks();
    }
    await muatRiwayat();
    toast('✅ Versi dikembalikan — klik Simpan untuk mengirim perubahannya');
  } catch (error) {
    toast('Gagal: ' + error.message, true);
  }
}

/** Buat tautan berbagi untuk pesan yang sedang dibuka. */
async function buatShare() {
  if (!editingId) return toast('Simpan pesan ini dulu', true);
  try {
    var hasil = await apiMetode('/api/posts/' + editingId + '/share', {}, 'POST');
    // origin kosong hanya terjadi di lingkungan uji; di browser selalu ada.
    var alamat = String(location.origin || '') + '/bagi/' + hasil.token;
    var isian = document.getElementById('shareUrl');
    if (isian) isian.value = alamat;
    toast('✅ Tautan berbagi dibuat');
  } catch (error) {
    toast('Gagal: ' + error.message, true);
  }
}

async function salinShare() {
  var isian = document.getElementById('shareUrl');
  if (!isian || !isian.value) return toast('Buat tautannya dulu', true);
  try {
    await navigator.clipboard.writeText(isian.value);
    toast('✅ Tautan disalin');
  } catch (error) {
    // Clipboard bisa diblokir browser (bukan https / izin ditolak). Isian
    // dibuat bisa dipilih supaya admin tetap bisa menyalin manual.
    isian.select();
    toast('Salin manual: tekan Ctrl+C', true);
  }
}

async function cabutShare() {
  if (!editingId) return;
  var ok = await askConfirm('Cabut tautan berbagi?', 'Siapa pun yang memegang tautannya tidak bisa membukanya lagi.');
  if (!ok) return;
  try {
    await apiMetode('/api/posts/' + editingId + '/share', undefined, 'DELETE');
    var isian = document.getElementById('shareUrl');
    if (isian) isian.value = '';
    toast('✅ Tautan dicabut');
  } catch (error) {
    toast('Gagal: ' + error.message, true);
  }
}

/* ---------------- Pratinjau ---------------- */

/** Warna aksen aktif. */
var ACCENT_DEFAULT = '#6d8cff';

/**
 * Bitmask flag pesan dari centang di tab Susun.
 *
 * Dihitung di satu tempat supaya penyimpanan dan pengiriman ulang tidak bisa
 * memakai angka yang berbeda.
 */
/**
 * Izin ping dari tiga centang.
 *
 * Isi kosong = tanpa ping apa pun, dan itu bawaan yang benar: pesan yang
 * tidak sengaja berisi @everyone tidak bisa ditarik kembali. Daftar hanya
 * menyebut jenis yang DICENTANG, jadi mencentang "ping role" tidak ikut
 * mengizinkan ping pengguna.
 */
function allowedMentionsPesan() {
  var parse = [];
  if ((document.getElementById('postMentionUsers') || {}).checked) parse.push('users');
  if ((document.getElementById('postMentionRoles') || {}).checked) parse.push('roles');
  if ((document.getElementById('postMentionEveryone') || {}).checked) parse.push('everyone');
  return { parse: parse };
}

function flagPesan() {
  var embeds = document.getElementById('postFlagEmbeds');
  var notif = document.getElementById('postFlagNotif');
  var flags = 0;
  if (embeds && embeds.checked) flags |= 4;
  if (notif && notif.checked) flags |= 4096;
  return flags;
}

function accentNow() {
  var el = document.getElementById('postAccent');
  return (el && el.value) || ACCENT_DEFAULT;
}

/* ---------------- Bagian embed klasik (penulis, footer, bidang) ---------------- */

/**
 * Semua bagian embed milik pesan ini, sampai 10 (batas Discord).
 *
 * Disimpan sebagai data (bukan dibaca dari DOM tiap kali) supaya membuka pesan
 * lain tidak menumpuk bidang milik pesan sebelumnya. Elemen pertama melengkapi
 * embed dari blok; sisanya menjadi embed tambahan.
 */
var EMBED_LIST = [embarKosong()];
/** Embed yang sedang diedit di isian bawah. */
var EMBED_AKTIF = 0;
/** Batas embed per pesan & bidang per embed — angka Discord, sama dengan server. */
var EMBED_MAKS = 10;
var EMBED_FIELDS_MAKS = 25;

/** Satu bagian embed kosong. */
function embarKosong() {
  return { url: '', color: '', author: {}, footer: {}, fields: [], timestamp: '' };
}

/** Bagian embed yang sedang diedit (selalu ada, walau daftarnya kosong). */
function embedAktif() {
  if (!EMBED_LIST.length) EMBED_LIST.push(embarKosong());
  if (EMBED_AKTIF >= EMBED_LIST.length) EMBED_AKTIF = EMBED_LIST.length - 1;
  if (EMBED_AKTIF < 0) EMBED_AKTIF = 0;
  return EMBED_LIST[EMBED_AKTIF];
}

/** Kosongkan semua bagian embed (dipakai saat membuka pesan baru). */
function resetEmbedExtra() {
  EMBED_LIST = [embarKosong()];
  EMBED_AKTIF = 0;
  renderEmbedExtra();
}

/** Ada isi di satu bagian embed? (cerminan embedExtraKosong di server) */
function embedTerisi(extra) {
  if (!extra) return false;
  return Boolean(
    extra.url ||
      extra.color ||
      (extra.author && extra.author.name) ||
      (extra.footer && extra.footer.text) ||
      (extra.fields && extra.fields.length) ||
      extra.timestamp,
  );
}

/** Tambah satu embed kosong, lalu pindah ke sana. */
function tambahEmbed() {
  if (EMBED_LIST.length >= EMBED_MAKS) {
    return toast('Maksimal ' + EMBED_MAKS + ' embed per pesan', true);
  }
  EMBED_LIST.push(embarKosong());
  EMBED_AKTIF = EMBED_LIST.length - 1;
  renderEmbedExtra();
  renderPreview();
}

/**
 * Geser satu embed ke atas/bawah.
 *
 * Discohook memberi tombol Move up/Move down per embed. Urutan menentukan mana
 * yang tampil lebih dulu di Discord, jadi tanpa ini admin harus menyusun ulang
 * dengan menyalin isinya.
 */
function pindahEmbed(nomor, arah) {
  var tujuan = nomor + arah;
  if (tujuan < 0 || tujuan >= EMBED_LIST.length) return;
  var dipindah = EMBED_LIST.splice(nomor, 1)[0];
  EMBED_LIST.splice(tujuan, 0, dipindah);
  EMBED_AKTIF = tujuan;
  renderEmbedExtra();
  renderPreview();
}

/**
 * Duplikat satu embed.
 *
 * Disalin dalam (bukan berbagi objek): tanpa itu, mengubah bidang di salinan
 * ikut mengubah aslinya — kesalahan yang sulit terlihat karena tampilannya
 * benar sampai salah satu disunting.
 */
function duplikatEmbed(nomor) {
  if (EMBED_LIST.length >= EMBED_MAKS) {
    return toast('Maksimal ' + EMBED_MAKS + ' embed per pesan', true);
  }
  var sumber = JSON.parse(JSON.stringify(EMBED_LIST[nomor] || embarKosong()));
  EMBED_LIST.splice(nomor + 1, 0, sumber);
  EMBED_AKTIF = nomor + 1;
  renderEmbedExtra();
  renderPreview();
}

/** Pilih embed yang diedit. */
function pilihEmbed(nomor) {
  EMBED_AKTIF = nomor;
  renderEmbedExtra();
}

/**
 * Hapus satu embed.
 *
 * Batasnya satu: pesan tanpa embed sama sekali tidak bisa dikirim, dan
 * mengosongkan isian lebih membingungkan daripada menyisakan satu yang kosong.
 */
function hapusEmbed(nomor) {
  if (EMBED_LIST.length <= 1) return toast('Minimal satu bagian embed', true);
  EMBED_LIST.splice(nomor, 1);
  if (EMBED_AKTIF >= EMBED_LIST.length) EMBED_AKTIF = EMBED_LIST.length - 1;
  renderEmbedExtra();
  renderPreview();
}

/**
 * Muat bagian embed dari pesan yang dibuka.
 *
 * Field yang tidak ada di data dibiarkan kosong — bukan diisi bawaan. Embed
 * pesan lama tidak punya penulis/footer, dan mengisinya dengan teks karangan
 * akan mengubah tampilan pesannya tanpa admin meminta.
 */
function loadEmbedExtra(data) {
  /*
   * Bentuk lama = satu objek, bentuk baru = daftar. Keduanya diterima supaya
   * dokumen JSON yang diekspor sebelum batch ini tetap bisa diimpor.
   */
  var daftar = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  var dinormal = daftar.slice(0, EMBED_MAKS).map(function (satu) {
    var sumber = satu && typeof satu === 'object' ? satu : {};
    return {
      url: String(sumber.url || ''),
      color: String(sumber.color || ''),
      author: {
        name: String((sumber.author || {}).name || ''),
        url: String((sumber.author || {}).url || ''),
        icon_url: String((sumber.author || {}).icon_url || ''),
      },
      footer: {
        text: String((sumber.footer || {}).text || ''),
        icon_url: String((sumber.footer || {}).icon_url || ''),
      },
      timestamp: String(sumber.timestamp || ''),
      fields: Array.isArray(sumber.fields)
        ? sumber.fields.slice(0, EMBED_FIELDS_MAKS).map(function (f) {
            return {
              name: String((f || {}).name || ''),
              value: String((f || {}).value || ''),
              inline: Boolean((f || {}).inline),
            };
          })
        : [],
    };
  });
  EMBED_LIST = dinormal.length ? dinormal : [embarKosong()];
  EMBED_AKTIF = 0;
  renderEmbedExtra();
}

/** Isian teks sederhana yang menulis langsung ke embed yang sedang diedit. */
function isianEmbed(id, jalur, placeholder) {
  var el = document.getElementById(id);
  if (!el) return;
  el.value = jalur.get();
  el.placeholder = placeholder;
  el.oninput = function () {
    jalur.set(el.value);
    renderPreview();
  };
}

/** Pasang nilai ke embed aktif pada jalur bertitik (mis. author.name). */
function targetEmbed(jalur, nilai) {
  var bagian = jalur.split('.');
  var simpul = embedAktif();
  for (var i = 0; i < bagian.length - 1; i += 1) {
    if (!simpul[bagian[i]]) simpul[bagian[i]] = {};
    simpul = simpul[bagian[i]];
  }
  simpul[bagian[bagian.length - 1]] = nilai;
}

function bacaEmbed(jalur) {
  var bagian = jalur.split('.');
  var simpul = embedAktif();
  for (var i = 0; i < bagian.length; i += 1) {
    if (!simpul) return '';
    simpul = simpul[bagian[i]];
  }
  return String(simpul || '');
}

/**
 * Gambar ulang bidang embed.
 *
 * Editor bidang ditulis sebagai baris-baris di dalam kotak, bukan satu JSON
 * mentah: admin yang menyusun pengumuman tidak perlu tahu bentuk embed Discord,
 * dan kesalahan seperti bidang tanpa isi bisa ditolak sebelum dikirim.
 */
function renderEmbedExtra() {
  isianEmbed('embedUrl', {
    get: function () { return bacaEmbed('url'); },
    set: function (v) { embedAktif().url = v.trim(); },
  }, 'URL saat judul diklik (opsional, http/https)');
  isianEmbed('embedAuthorName', {
    get: function () { return bacaEmbed('author.name'); },
    set: function (v) { targetEmbed('author.name', v); },
  }, 'Nama penulis (mis. {server.name})');
  isianEmbed('embedAuthorIcon', {
    get: function () { return bacaEmbed('author.icon_url'); },
    set: function (v) { targetEmbed('author.icon_url', v.trim()); },
  }, 'URL ikon penulis');
  isianEmbed('embedAuthorUrl', {
    get: function () { return bacaEmbed('author.url'); },
    set: function (v) { targetEmbed('author.url', v.trim()); },
  }, 'URL tautan penulis');
  isianEmbed('embedFooterText', {
    get: function () { return bacaEmbed('footer.text'); },
    set: function (v) { targetEmbed('footer.text', v); },
  }, 'Teks footer (mis. Dikirim oleh {member.name})');
  isianEmbed('embedFooterIcon', {
    get: function () { return bacaEmbed('footer.icon_url'); },
    set: function (v) { targetEmbed('footer.icon_url', v.trim()); },
  }, 'URL ikon footer');
  /*
   * Warna per embed: input color selalu punya nilai, jadi "ikut aksen pesan"
   * diwakili oleh string kosong di data, bukan oleh nilai bawaan input.
   */
  var warnaEl = document.getElementById('embedColor');
  var warnaTeks = document.getElementById('embedColorText');
  if (warnaEl) {
    var aktif = embedAktif();
    warnaEl.value = /^#[0-9a-fA-F]{6}$/.test(aktif.color || '') ? aktif.color : accentNow();
    warnaEl.oninput = function () {
      embedAktif().color = warnaEl.value;
      if (warnaTeks) warnaTeks.textContent = warnaEl.value;
      renderPreview();
    };
    if (warnaTeks) {
      warnaTeks.textContent = aktif.color
        ? warnaEl.value
        : 'ikut aksen pesan (' + accentNow() + ')';
    }
  }

  isianEmbed('embedTimestamp', {
    get: function () { return bacaEmbed('timestamp'); },
    set: function (v) { embedAktif().timestamp = v.trim(); },
  }, 'Stempel waktu ISO 8601 (mis. 2026-11-12T09:00:00Z)');

  /*
   * Pemilih embed: satu baris per bagian embed. Tanpa ini, admin tidak punya
   * cara berpindah antara embed pertama dan embed tambahan — isian di bawah
   * hanya menampilkan satu embed, dan sisanya jadi tak terlihat.
   */
  var pilihHost = document.getElementById('embedPilihList');
  if (pilihHost) {
    pilihHost.innerHTML = '';
    EMBED_LIST.forEach(function (extra, nomor) {
      var baris = document.createElement('div');
      baris.className = 'aksi-baris' + (nomor === EMBED_AKTIF ? ' aksi-baris-aktif' : '');

      var head = document.createElement('div');
      head.className = 'aksi-baris-head';
      var tombol = document.createElement('button');
      tombol.className = 'btn btn-ghost btn-sm';
      tombol.type = 'button';
      var ringkas = nomor === 0 ? 'Embed 1 (isi blok)' : 'Embed ' + (nomor + 1);
      tombol.textContent = ringkas + (embedTerisi(extra) ? '' : ' — kosong');
      tombol.onclick = function () { pilihEmbed(nomor); };
      head.appendChild(tombol);

      var alat = document.createElement('span');
      alat.style.display = 'flex';
      alat.style.gap = '4px';

      var naik = document.createElement('button');
      naik.className = 'btn btn-ghost btn-sm btn-icon';
      naik.type = 'button';
      naik.title = 'Naikkan';
      naik.textContent = '↑';
      naik.disabled = nomor === 0;
      naik.onclick = function () { pindahEmbed(nomor, -1); };
      alat.appendChild(naik);

      var turun = document.createElement('button');
      turun.className = 'btn btn-ghost btn-sm btn-icon';
      turun.type = 'button';
      turun.title = 'Turunkan';
      turun.textContent = '↓';
      turun.disabled = nomor === EMBED_LIST.length - 1;
      turun.onclick = function () { pindahEmbed(nomor, 1); };
      alat.appendChild(turun);

      var salin = document.createElement('button');
      salin.className = 'btn btn-ghost btn-sm btn-icon';
      salin.type = 'button';
      salin.title = 'Duplikat';
      salin.textContent = '⧉';
      salin.onclick = function () { duplikatEmbed(nomor); };
      alat.appendChild(salin);

      var hapus = document.createElement('button');
      hapus.className = 'btn-danger btn-sm btn-icon';
      hapus.type = 'button';
      hapus.title = 'Hapus embed';
      hapus.textContent = 'x';
      hapus.disabled = EMBED_LIST.length <= 1;
      hapus.onclick = function () { hapusEmbed(nomor); };
      alat.appendChild(hapus);

      head.appendChild(alat);
      baris.appendChild(head);
      pilihHost.appendChild(baris);
    });

    var statusPilih = document.getElementById('embedPilihStatus');
    if (statusPilih) {
      statusPilih.textContent =
        EMBED_LIST.length + '/' + EMBED_MAKS + ' embed · sedang mengedit embed ' + (EMBED_AKTIF + 1);
    }
  }

  var host = document.getElementById('embedFieldList');
  if (!host) return;
  host.innerHTML = '';

  if (embedAktif().fields.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.style.margin = '0';
    kosong.textContent = 'Belum ada bidang. Bidang berguna untuk rincian seperti harga, jadwal, atau syarat.';
    host.appendChild(kosong);
  }

  embedAktif().fields.forEach(function (bidang, nomor) {
    var baris = document.createElement('div');
    baris.className = 'aksi-baris';

    var head = document.createElement('div');
    head.className = 'aksi-baris-head';
    var label = document.createElement('span');
    label.className = 'aksi-jenis';
    label.textContent = (nomor + 1) + '. Bidang';
    head.appendChild(label);

    var hapus = document.createElement('button');
    hapus.className = 'btn-danger btn-sm btn-icon';
    hapus.type = 'button';
    hapus.title = 'Hapus bidang';
    hapus.textContent = 'x';
    hapus.onclick = function () {
      embedAktif().fields.splice(nomor, 1);
      renderEmbedExtra();
      renderPreview();
    };
    head.appendChild(hapus);
    baris.appendChild(head);

    var nama = document.createElement('input');
    nama.type = 'text';
    nama.value = bidang.name;
    nama.placeholder = 'Nama bidang (maks 256 karakter)';
    nama.oninput = function () { embedAktif().fields[nomor].name = nama.value.slice(0, 256); renderPreview(); };
    baris.appendChild(nama);

    var isi = document.createElement('textarea');
    isi.rows = 2;
    isi.value = bidang.value;
    isi.placeholder = 'Isi bidang (maks 1024 karakter)';
    isi.oninput = function () { embedAktif().fields[nomor].value = isi.value.slice(0, 1024); renderPreview(); };
    baris.appendChild(isi);

    var sebaris = document.createElement('label');
    sebaris.className = 'menu-flags';
    var cek = document.createElement('input');
    cek.type = 'checkbox';
    cek.checked = bidang.inline === true;
    cek.onchange = function () { embedAktif().fields[nomor].inline = cek.checked; renderPreview(); };
    sebaris.appendChild(cek);
    sebaris.appendChild(document.createTextNode(' tampil sebaris dengan bidang lain'));
    baris.appendChild(sebaris);

    host.appendChild(baris);
  });

  var status = document.getElementById('embedFieldStatus');
  if (status) {
    status.textContent = embedAktif().fields.length + '/' + EMBED_FIELDS_MAKS + ' bidang';
  }
}

function tambahBidangEmbed() {
  if (embedAktif().fields.length >= EMBED_FIELDS_MAKS) {
    return toast('Maksimal ' + EMBED_FIELDS_MAKS + ' bidang per embed', true);
  }
  embedAktif().fields.push({ name: '', value: '', inline: false });
  renderEmbedExtra();
}

/**
 * Muatan embed untuk server.
 *
 * Selalu berupa DAFTAR (server menyimpannya sebagai daftar bagian embed).
 * Bagian yang seluruhnya kosong dibuang, dan null dikirim kalau tidak ada satu
 * pun yang terisi — server menyimpannya sebagai kolom kosong, bukan daftar
 * berisi objek kosong yang harus dibaca ulang sebagai "kosong" di tiap tempat.
 */
function payloadEmbed() {
  var hasil = [];
  EMBED_LIST.forEach(function (extra) {
    if (!embedTerisi(extra)) return;
    var satu = {};
    if (extra.url) satu.url = extra.url;
    if (extra.color) satu.color = extra.color;
    if (extra.timestamp) satu.timestamp = extra.timestamp;
    if (extra.author && extra.author.name) {
      satu.author = { name: extra.author.name };
      if (extra.author.url) satu.author.url = extra.author.url;
      if (extra.author.icon_url) satu.author.icon_url = extra.author.icon_url;
    }
    if (extra.footer && extra.footer.text) {
      satu.footer = { text: extra.footer.text };
      if (extra.footer.icon_url) satu.footer.icon_url = extra.footer.icon_url;
    }
    var bidang = (extra.fields || []).filter(function (f) {
      return String(f.name || '').trim() && String(f.value || '').trim();
    });
    if (bidang.length) {
      satu.fields = bidang.map(function (f) {
        return { name: f.name.trim(), value: f.value.trim(), inline: f.inline === true };
      });
    }
    if (Object.keys(satu).length) hasil.push(satu);
  });
  return hasil.length ? hasil : null;
}

/** Kembalikan warna embed yang sedang diedit ke warna aksen pesan. */
function resetEmbedColor() {
  var aktif = embedAktif();
  aktif.color = '';
  renderEmbedExtra();
  renderPreview();
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

/**
 * Bangun elemen Section untuk pratinjau: teks di kiri, satu aksesori di kanan.
 *
 * Dipakai blok section dan blok text yang diberi aksesori - keduanya
 * menghasilkan bentuk yang SAMA di Discord, jadi pratinjaunya pun harus sama.
 */
function buatSectionPratinjau(teks, kecil, blok) {
  var sec = document.createElement('div');
  sec.className = 'pc-section';

  var kiri = document.createElement('div');
  kiri.className = 'pc-section-text';
  var el = document.createElement('div');
  el.className = 'pc-line' + (kecil ? ' pc-small' : '');
  el.textContent = teks;
  kiri.appendChild(el);
  sec.appendChild(kiri);

  var kanan = document.createElement('div');
  kanan.className = 'pc-section-aksesori';
  var label = blok.accessoryLabel || '';
  var url = blok.url || blok.accessoryUrl || '';
  if (label && /^https?:\\/\\//i.test(url)) {
    var btn = document.createElement('span');
    btn.className = 'pc-button pc-button-link' + (blok.disabled ? ' pc-disabled' : '');
    // Emoji tombol aksesori ikut ditampilkan, sama seperti di Discord.
    btn.textContent = teksTombol({ value: label, emoji: blok.emoji });
    kanan.appendChild(btn);
  } else if (blok.thumbnail) {
    var thumb = document.createElement('img');
    thumb.src = blok.thumbnail;
    thumb.className = 'pc-thumb';
    thumb.alt = '';
    kanan.appendChild(thumb);
  }
  sec.appendChild(kanan);
  return sec;
}

/**
 * Gambar ulang SEMUA pratinjau di halaman.
 *
 * Ada dua tempat pratinjau: panel kecil yang menempel di tab Susun, dan panel
 * besar di tab Pratinjau. Keduanya harus berisi gambar yang sama — kalau
 * hanya satu yang diperbarui, admin melihat isi berbeda di dua tab.
 */
function renderPreview() {
  ['previewHost', 'previewHostBesar'].forEach(function (id) {
    renderPreviewKe(id);
  });
}

/**
 * Bangun embed dari blok — cerminan buildClassicEmbed di server.
 *
 * Aturannya harus sama, dan yang paling mudah salah adalah: embed hanya boleh
 * SATU gambar besar, dan tombol/menu tidak masuk embed. Kalau pratinjau
 * menampilkan dua gambar, admin akan bingung kenapa Discord hanya menampilkan
 * satu.
 */
function embedDariBlok() {
  var embed = { title: '', description: '', color: null, image: null, thumbnail: null };
  var nama = (document.getElementById('postName') || {}).value || '';
  embed.title = String(nama).trim().slice(0, 256);
  var aksen = String(accentNow() || '').replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(aksen)) embed.color = parseInt(aksen, 16);

  var baris = [];
  var dilewati = [];
  blocks.forEach(function (b) {
    if (b.kind === 'text' || b.kind === 'section') {
      if (String(b.value || '').trim()) baris.push(String(b.value));
      if (b.kind === 'section' && String(b.thumbnail || '').trim() && !embed.thumbnail) {
        embed.thumbnail = String(b.thumbnail);
      }
      return;
    }
    if (b.kind === 'divider') {
      if (baris.length && baris[baris.length - 1] !== '') baris.push('');
      return;
    }
    if (b.kind === 'image') {
      var url = String(b.url || b.value || '').trim();
      if (!url) return;
      if (embed.image) {
        dilewati.push('gambar kedua tidak muat di embed (maksimal satu)');
        return;
      }
      embed.image = url;
      return;
    }
    if (b.kind === 'file') {
      dilewati.push('berkas jadi lampiran, bukan bagian embed');
      return;
    }
    if (b.kind === 'button' || b.kind === 'select') {
      dilewati.push('tombol/menu dikirim di luar embed (tetap bisa diklik)');
    }
  });

  embed.description = baris.join(String.fromCharCode(10)).trim().slice(0, 4096);
  return { embed: embed, dilewati: dilewati };
}

/**
 * Pratinjau embed klasik — bentuknya mengikuti tampilan Discord.
 *
 * Semua embed digambar, bukan hanya yang sedang diedit: admin harus melihat
 * hasil akhir pesannya (Discord menampilkan semuanya bertumpuk), dan salah
 * satu embed yang kosong akan menggagalkan pengiriman seluruh pesan.
 */
function gambarPratinjauEmbed(host, hostId) {
  var hasil = embedDariBlok();
  var dasar = hasil.embed;
  var daftar = payloadEmbed() || [];

  /*
   * Embed pertama = blok + bagian admin pertama; sisanya hanya bagian admin.
   * Ini cerminan buildClassicEmbeds di server, bukan aturan kedua yang ditulis
   * ulang dengan cara berbeda.
   */
  var adaDasar = Boolean(dasar.title || dasar.description || dasar.image);
  var digambar = 0;
  if (adaDasar || daftar.length) {
    gambarSatuEmbed(host, dasar, daftar[0] || null, adaDasar);
    digambar += 1;
  }
  for (var i = 1; i < daftar.length; i += 1) {
    gambarSatuEmbed(host, { color: null, title: '', description: '', image: null }, daftar[i], false);
    if (embedTerisi(daftar[i])) digambar += 1;
  }

  if (digambar === 0) {
    var kosong = document.createElement('div');
    kosong.className = 'preview-container';
    kosong.style.borderLeftColor = accentNow();
    var isiKosong = document.createElement('div');
    isiKosong.className = 'preview-text';
    isiKosong.textContent = 'Embed masih kosong — tambahkan teks atau gambar.';
    kosong.appendChild(isiKosong);
    host.appendChild(kosong);
    return;
  }

  if (daftar.length > 10) {
    var terlalu = document.createElement('p');
    terlalu.className = 'hint';
    terlalu.style.margin = '8px 0 0';
    terlalu.textContent = 'Embed dibatasi 10 per pesan — Discord menolak pesan yang lebih banyak.';
    host.appendChild(terlalu);
  }

  // Komponen di luar embed tetap ditampilkan: tombol role masih akan muncul.
  var luar = [];
  blocks.forEach(function (b) {
    if (b.kind === 'button' && String(b.value || '').trim()) luar.push('Tombol: ' + b.value);
    if (b.kind === 'select') luar.push('Menu pilihan');
  });
  if (luar.length) {
    var catatan = document.createElement('div');
    catatan.className = 'preview-outside';
    catatan.textContent = 'Di luar embed: ' + luar.join(' · ');
    host.appendChild(catatan);
  }
  if (hasil.dilewati.length && hostId === 'previewHostBesar') {
    var peringatan = document.createElement('p');
    peringatan.className = 'hint';
    peringatan.style.margin = '8px 0 0';
    peringatan.textContent = 'Catatan: ' + hasil.dilewati[0];
    host.appendChild(peringatan);
  }
}

/**
 * Gambar satu kartu embed.
 *
 * dasar berisi judul/isi/gambar hasil terjemahan blok; extra berisi bagian
 * yang ditulis admin. Penulis, bidang, dan footer digambar dari payload yang
 * SAMA dengan yang dikirim ke server — bukan dari tebakan.
 */
function gambarSatuEmbed(host, dasar, extra, pakaiDasar) {
  var kotak = document.createElement('div');
  kotak.className = 'preview-embed';
  /*
   * Urutan warna: warna embed itu sendiri, lalu aksen pesan. Sama dengan
   * server (terapkanExtra menimpa warna dari blok).
   */
  var warnaSendiri = extra && /^#[0-9a-fA-F]{6}$/.test(extra.color || '') ? extra.color : null;
  kotak.style.borderLeftColor =
    warnaSendiri ||
    (dasar.color === null || dasar.color === undefined ? accentNow() : '#' + aksenHex(dasar.color));

  if (extra && extra.author && extra.author.name) {
    var penulis = document.createElement('div');
    penulis.className = 'preview-embed-author';
    penulis.textContent = (extra.author.icon_url ? '🖼 ' : '') + String(extra.author.name);
    kotak.appendChild(penulis);
  }
  var judul = pakaiDasar ? dasar.title : '';
  if (judul) {
    var elJudul = document.createElement('div');
    elJudul.className = 'preview-embed-title';
    elJudul.textContent = judul;
    kotak.appendChild(elJudul);
  }
  if (pakaiDasar && dasar.description) {
    var isi = document.createElement('div');
    isi.className = 'preview-embed-text';
    isi.textContent = dasar.description;
    kotak.appendChild(isi);
  }
  if (extra && extra.fields && extra.fields.length) {
    /*
     * Bidang digambar sebagai baris datar: pratinjau ini mini, dan kolom
     * inline sungguhan akan terbaca sebagai teks yang berdesakan. Yang penting
     * admin melihat ISI dan jumlahnya, bukan tata letak persisnya.
     */
    var daftarBidang = document.createElement('div');
    daftarBidang.className = 'preview-embed-fields';
    extra.fields.forEach(function (bidang) {
      var satu = document.createElement('div');
      satu.className = 'preview-embed-field';
      var nama = document.createElement('b');
      nama.textContent = bidang.name;
      satu.appendChild(nama);
      satu.appendChild(document.createTextNode(' ' + bidang.value + (bidang.inline ? ' (sebaris)' : '')));
      daftarBidang.appendChild(satu);
    });
    kotak.appendChild(daftarBidang);
  }
  if (pakaiDasar && dasar.image) {
    var gambar = document.createElement('div');
    gambar.className = 'preview-embed-image';
    // Alamat gambar dari admin: dipasang lewat style, bukan innerHTML.
    gambar.style.backgroundImage = 'url("' + String(dasar.image).replace(/"/g, '%22') + '")';
    kotak.appendChild(gambar);
  }
  if (extra && extra.footer && extra.footer.text) {
    var footer = document.createElement('div');
    footer.className = 'preview-embed-footer';
    footer.textContent = String(extra.footer.text) + (extra.timestamp ? ' · ' + String(extra.timestamp) : '');
    kotak.appendChild(footer);
  } else if (extra && extra.timestamp) {
    var waktu = document.createElement('div');
    waktu.className = 'preview-embed-footer';
    waktu.textContent = String(extra.timestamp);
    kotak.appendChild(waktu);
  }
  host.appendChild(kotak);
}

/** Angka warna jadi rrggbb untuk CSS. */
function aksenHex(angka) {
  var teks = Number(angka || 0).toString(16);
  while (teks.length < 6) teks = '0' + teks;
  return teks.slice(-6);
}

function renderPreviewKe(hostId) {
  var host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = '';

  /*
   * Bentuk embed: pratinjau memakai pembangun embed yang SAMA dengan server
   * (embedDariBlok), jadi yang terlihat bukan tebakan. Kalau pratinjau
   * menggambar sendiri, admin bisa melihat embed rapi padahal server menolak
   * atau memotong isinya.
   */
  var bentuk = (document.getElementById('postLayout') || {}).value;
  if (bentuk === 'embed') {
    gambarPratinjauEmbed(host, hostId);
    return;
  }

  /*
   * Pratinjau memakai pemisahan wadah yang SAMA dengan penyusun payload:
   * blok container membuka kartu baru, blok isi sesudahnya masuk ke situ.
   * Kalau pratinjau dan hasil kiriman memakai aturan berbeda, admin melihat
   * satu hal di dashboard dan hal lain di Discord.
   */
  var isi = blocks.filter(function (b) {
    if (b.kind === 'divider' || b.kind === 'container' || b.kind === 'close') return true;
    if (b.kind === 'row') return true;
    if (b.kind === 'select') return (b.selectKind || 'string') !== 'string' || (b.options || []).length > 0;
    if (b.kind === 'file') return Boolean(b.data || String(b.value || '').trim());
    if (b.kind === 'section') return Boolean(String(b.value || '').trim() || String(b.thumbnail || '').trim());
    if (b.kind === 'image') return Boolean(b.data || b.value);
    return String(b.value || '').trim().length > 0;
  });

  var adaIsi = isi.some(function (b) {
    return b.kind === 'text' || b.kind === 'image' || b.kind === 'section' || b.kind === 'select';
  });
  if (!adaIsi) {
    var kosong = document.createElement('div');
    kosong.className = 'preview-container';
    kosong.style.borderLeftColor = accentNow();
    var pesanKosong = document.createElement('div');
    pesanKosong.className = 'pc-line pc-small';
    pesanKosong.textContent = 'Belum ada isi — pesan kosong tidak bisa dikirim.';
    kosong.appendChild(pesanKosong);
    host.appendChild(kosong);
    return;
  }

  // Kartu aktif tempat blok ditulis. Kartu kosong dibuang di akhir.
  var kartuList = [];
  var kartu;
  function bukaKartu(warna, spoiler) {
    kartu = document.createElement('div');
    kartu.className = 'preview-container' + (spoiler ? ' pc-spoiler-kartu' : '');
    kartu.style.borderLeftColor = warna || accentNow();
    kartu._adaIsi = false;
    kartuList.push(kartu);
    host.appendChild(kartu);
  }
  /*
   * Ada blok container = blok sebelum container pertama tampil DI LUAR
   * kartu (top-level), sama seperti pesan Discohook. Tanpa container, semua
   * masuk satu kartu seperti perilaku lama.
   */
  var adaContainer = isi.some(function (b) { return b.kind === 'container'; });
  var luar = adaContainer;

  /**
   * Elemen tujuan penulisan: kartu (punya border warna) atau pembungkus polos
   * di luar kartu (tanpa border, karena di Discord pun tanpa kartu).
   */
  var luarHost = document.createElement('div');
  luarHost.className = 'preview-outside';
  host.appendChild(luarHost);

  var tujuanLuar = luarHost;
  function targetTulis() { return luar ? tujuanLuar : kartu; }

  /**
   * Tandai bahwa tujuan yang sedang ditulis sudah berisi.
   *
   * Sengaja memakai targetTulis() dan bukan variabel kartu langsung: saat
   * menulis di luar kartu, variabel kartu masih menunjuk kartu terakhir yang
   * mungkin
   * sudah dibuang, dan menandainya berisi membuatnya lolos dari pembersihan
   * kartu kosong - itulah yang dulu menyisakan kartu hantu di pratinjau.
   */
  function tandaiBerisi() {
    var tujuan = targetTulis();
    if (tujuan) tujuan._adaIsi = true;
  }

  /*
   * Kartu pertama hanya dibuat kalau pesan memang mulai DI DALAM kartu.
   * Kalau pesan diawali di luar kartu (ada blok container), membuat kartu
   * kosong di sini akan menyisakan kartu hantu di pratinjau — kartu itu tidak
   * pernah mendapat isi karena semua blok awal menulis ke pembungkus luar,
   * tetapi sempat ditandai berisi oleh baris else kartu._adaIsi = true.
   */
  if (!luar) bukaKartu(null);

  var tertunda = [];
  function flushTombol() {
    for (var i = 0; i < tertunda.length; i += 5) {
      var baris = document.createElement('div');
      baris.className = 'pc-row';
      tertunda.slice(i, i + 5).forEach(function (t) {
        var b = document.createElement('span');
        b.className = 'pc-button pc-button-link' + (t.disabled ? ' pc-disabled' : '');
        b.textContent = teksTombol(t);
        baris.appendChild(b);
      });
      targetTulis().appendChild(baris);
      tandaiBerisi();
    }
    tertunda = [];
  }

  isi.forEach(function (blok) {
    if (blok.kind === 'container') {
      if (tertunda.length) flushTombol();
      bukaKartu(blok.accent || null, blok.spoiler === true);
      luar = false;
      return;
    }
    if (blok.kind === 'close') {
      if (tertunda.length) flushTombol();
      /*
       * Penanda hanya muncul saat benar-benar ADA transisi dari dalam kartu ke
       * luar. Kalau pesan sudah mulai di luar kartu (karena punya blok
       * container), blok close pertama tidak mengubah apa pun — menampilkan
       * penanda di situ akan menyesatkan admin.
       */
      if (!luar) {
        var batas = document.createElement('div');
        batas.className = 'pc-outside-hint';
        batas.textContent = 'di luar kartu';
        tujuanLuar.appendChild(batas);
      }
      luar = true;
      return;
    }
    if (blok.kind === 'button') { tertunda.push(blok); return; }
    if (blok.kind === 'row') {
      // Baris baru: tombol yang menumpuk dikirim lebih dulu, seperti flushButtons(true).
      if (tertunda.length) flushTombol();
      return;
    }
    if (tertunda.length) flushTombol();

    if (blok.kind === 'select') {
      targetTulis().appendChild(buatSelectPratinjau(blok));
      tandaiBerisi();
      return;
    }

    if (blok.kind === 'section') {
      // Discord: teks di kiri, aksesori (gambar kecil atau tombol) di kanan.
      var kecilSec = /^\\s*-#/.test(blok.value || '');
      var teksSec = kecilSec ? String(blok.value).replace(/^\\s*-#\s*/, '') : (blok.value || '');
      targetTulis().appendChild(buatSectionPratinjau(teksSec, kecilSec, blok));
      tandaiBerisi();
      return;
    }

    if (blok.kind === 'file') {
      /*
       * Berkas selalu tampil di DASAR pesan, terpisah dari kartu — sama seperti
       * lampiran Discord. Karena itu elemennya ditaruh di pembungkus luar, bukan
       * di kartu tempat blok ini kebetulan berada.
       */
      var kartuFile = document.createElement('div');
      kartuFile.className = 'pc-file' + (blok.spoiler ? ' pc-file-spoiler' : '');
      var ikonFile = document.createElement('span');
      ikonFile.className = 'pc-file-ikon';
      ikonFile.textContent = '📄';
      kartuFile.appendChild(ikonFile);
      var isiFile = document.createElement('div');
      isiFile.className = 'pc-file-isi';
      var namaFile = document.createElement('div');
      namaFile.className = 'pc-file-nama';
      namaFile.textContent = blok.name || namaDariUrl(blok.value) || 'berkas';
      isiFile.appendChild(namaFile);
      var ketFile = document.createElement('div');
      ketFile.className = 'pc-file-ket';
      ketFile.textContent = blok.data
        ? 'diunggah dari perangkat'
        : (String(blok.value || '').length > 46 ? String(blok.value).slice(0, 45) + '…' : blok.value || '');
      isiFile.appendChild(ketFile);
      kartuFile.appendChild(isiFile);
      tujuanLuar.appendChild(kartuFile);
      tujuanLuar._adaIsi = true;
      return;
    }

    if (blok.kind === 'divider') {
      var sep = document.createElement('div');
      sep.className = 'pc-sep' +
        (blok.spacing === 'large' ? ' pc-sep-large' : '') +
        (blok.divider === false ? ' pc-sep-none' : '');
      targetTulis().appendChild(sep);
      return;
    }
    if (blok.kind === 'image') {
      if (blok.data) {
        var img = document.createElement('img');
        img.src = blok.data;
        img.className = 'pc-image' + (blok.spoiler ? ' pc-spoiler' : '');
        img.alt = 'gambar unggahan';
        targetTulis().appendChild(img);
      } else {
        var jauh = document.createElement('img');
        jauh.src = blok.value;
        jauh.className = 'pc-image' + (blok.spoiler ? ' pc-spoiler' : '');
        jauh.alt = '';
        jauh.onerror = function () {
          jauh.replaceWith(salinanTeks('[ gambar tidak bisa dimuat ]'));
        };
        targetTulis().appendChild(jauh);
      }
      tandaiBerisi();
      return;
    }
    /*
     * Teks: -# di awal = teks kecil di Discord.
     *
     * Kalau blok teks punya aksesori (tombol link / thumbnail), Discord
     * mengirimnya sebagai Section — jadi pratinjau juga menampilkannya dalam
     * bentuk section, bukan teks polos. Kalau tidak, admin melihat teks biasa
     * padahal hasil di Discord berbeda.
     */
    var kecil = /^\\s*-#/.test(blok.value);
    var teks = kecil ? blok.value.replace(/^\\s*-#\s*/, '') : blok.value;
    var punyaAksesori = Boolean((blok.accessoryLabel && blok.url) || blok.thumbnail);
    if (punyaAksesori) {
      targetTulis().appendChild(buatSectionPratinjau(teks, kecil, blok));
    } else {
      var el = document.createElement('div');
      el.className = 'pc-line' + (kecil ? ' pc-small' : '');
      el.textContent = teks;
      targetTulis().appendChild(el);
    }
    tandaiBerisi();
  });
  if (tertunda.length) flushTombol();

  // Kartu yang tidak mendapat isi sama sekali dibuang: di Discord kartu itu
  // tidak akan muncul, jadi menampilkannya di pratinjau justru menyesatkan.
  // Pembungkus luar juga dibuang kalau tidak terpakai, supaya tidak ada
  // celah kosong di pratinjau.
  for (var k = kartuList.length - 1; k >= 0; k -= 1) {
    if (!kartuList[k]._adaIsi) kartuList[k].remove();
  }
  if (!tujuanLuar._adaIsi) tujuanLuar.remove();

  /*
   * Tombol role & menu selalu menempel di KARTU TERAKHIR yang berisi — sama
   * dengan penyusun payload. Kalau tidak ada kartu berisi sama sekali,
   * keduanya jatuh ke pembungkus luar supaya tetap terlihat.
   */
  var kartuRole = null;
  for (var m = kartuList.length - 1; m >= 0; m -= 1) {
    if (kartuList[m]._adaIsi) { kartuRole = kartuList[m]; break; }
  }
  if (kartuRole) kartu = kartuRole;
  else if (tujuanLuar._adaIsi) kartu = tujuanLuar;

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
 * Pratinjau satu select menu, seperti yang tampil di Discord.
 *
 * Bentuknya sama dengan dropdown role (kotak gelap + panah), tetapi pilihannya
 * ditampilkan semua: admin sedang memeriksa label dan keterangan, dan Discord
 * pun menampilkannya begitu saat menu dibuka.
 */
function buatSelectPratinjau(blok) {
  var kotak = document.createElement('div');
  kotak.className = 'pc-select' + (blok.selectDisabled ? ' pc-disabled' : '');
  var judul = document.createElement('span');
  judul.textContent = blok.placeholder || selectJenisLabel(blok);
  kotak.appendChild(judul);
  kotak.insertAdjacentHTML('beforeend', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>');

  var bungkus = document.createElement('div');
  bungkus.className = 'pc-select-wrap';
  bungkus.appendChild(kotak);

  if ((blok.selectKind || 'string') === 'string') {
    (blok.options || []).forEach(function (opsi) {
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
      bungkus.appendChild(el);
    });
  } else {
    /* Daftar anggota/role/channel tidak diketahui dari dashboard: tampilkan
     * jenisnya saja, jangan mengarang isi. */
    var ket = document.createElement('div');
    ket.className = 'pc-select-opt';
    ket.textContent = 'daftar ' + selectJenisLabel(blok).toLowerCase() + ' diisi Discord';
    bungkus.appendChild(ket);
  }

  return bungkus;
}

/**
 * Emoji + label tombol untuk pratinjau.
 *
 * Emoji kustom berbentuk <:nama:id> tidak bisa digambar tanpa CDN, jadi yang
 * tampil hanya :nama: — cukup untuk memastikan admin memilih emoji yang benar.
 */
/** Ambil nama berkas dari ujung URL, untuk label pratinjau. */
function namaDariUrl(url) {
  var bersih = String(url || '').split('?')[0].split('#')[0];
  var bagian = bersih.split('/').filter(Boolean);
  var akhir = bagian.length ? bagian[bagian.length - 1] : '';
  try {
    return decodeURIComponent(akhir);
  } catch (e) {
    return akhir;
  }
}

function teksTombol(tombol) {
  // Tombol link menyimpan teksnya di value; tombol role di label.
  var label = tombol.value || tombol.label || '(tanpa label)';
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

    // Aksi komponen: tombol role bisa diberi aksi berurutan (versi ringkas
    // flow Discohook). Tanpa aksi, perilakunya tetap seperti sebelumnya.
    row.appendChild(kartuAksi(targetTombol(tombol), '@' + (role ? role.name : 'role')));

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
  renderUsage();
}

function addRoleButton() {
  var pick = document.getElementById('rolePick');
  if (!pick || !pick.value) return toast('Pilih role dulu', true);
  if (roleButtons.some(function (b) { return b.roleId === pick.value; })) {
    return toast('Role itu sudah punya tombol', true);
  }
  var role = roleById(pick.value);
  roleButtons.push({
    // ID dipertahankan bila role ini pernah tersimpan: aksi komponen menempel
    // pada ID itu, dan membuangnya akan menghapus aksi yang sudah disusun
    // admin hanya karena tombolnya dihapus lalu ditambahkan lagi.
    id: cariIdTombol(pick.value) || undefined,
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
    body: JSON.stringify({ buttons: roleButtons, menus: roleMenus, actions: susunAksi() }),
  });
  if (result.dropped && result.dropped.length) {
    toast('Sebagian pengaturan dibuang: ' + result.dropped[0], true);
  }
  /*
   * ID tombol & opsi dibuat ulang setiap simpan, jadi kunci aksi ikut berubah.
   * Hasil server dipakai sebagai sumber kebenaran: tanpa ini, membuka pesan
   * yang baru disimpan akan kehilangan aksinya (kunci lama tidak cocok lagi).
   */
  if (result.actions) {
    postActions = {};
    Object.keys(result.actions).forEach(function (target) {
      postActions[target] = (result.actions[target] || []).map(function (aksi) {
        return JSON.parse(JSON.stringify(aksi));
      });
    });
    if (editingId) POST_ACTIONS[editingId] = JSON.parse(JSON.stringify(postActions));
  }
  return result;
}

/**
 * Aksi yang siap dikirim: kunci target memakai ID yang SUDAH tersimpan.
 *
 * Tombol/opsi baru belum punya ID, jadi aksinya tidak bisa ditempelkan pada
 * tombol itu sebelum disimpan sekali. Ini konsekuensi langsung dari
 * customId berbasis ID baris (bukan teks bebas), dan sengaja tidak ditutupi:
 * dashboard memberi tahu admin lewat kartu aksi.
 */
function susunAksi() {
  var hasil = {};
  Object.keys(postActions).forEach(function (target) {
    var sah = (postActions[target] || []).filter(aksiSah).map(rapikanAksi);
    if (sah.length > 0) hasil[target] = sah;
  });
  return hasil;
}

/**
 * Rapikan satu aksi SESUDAH disaring, termasuk cabangnya.
 *
 * Yang dikerjakan: membuang cabang kosong. Cabang kosong mengubah arti syarat
 * (syarat tanpa cabang menghentikan flow, syarat dengan cabang tidak), jadi
 * bentuk setengah jadi tidak boleh ikut terkirim. Kuota flow TIDAK ditegakkan
 * di sini: server melaporkan aksinya dengan alasan yang bisa dibaca admin,
 * dan memotong diam-diam di browser justru menyembunyikan masalah itu.
 */
function rapikanAksi(aksi) {
  if (aksi.kind !== 'condition') return aksi;
  var salinan = {};
  Object.keys(aksi).forEach(function (kunci) { salinan[kunci] = aksi[kunci]; });
  var then = (aksi.then || []).filter(aksiSah).map(rapikanAksi);
  var otherwise = (aksi.else || []).filter(aksiSah).map(rapikanAksi);
  if (then.length) salinan.then = then;
  else delete salinan.then;
  if (otherwise.length) salinan.else = otherwise;
  else delete salinan.else;
  return salinan;
}

/** Apakah aksi ini cukup lengkap untuk dikirim? (dipakai juga di dalam cabang) */
function aksiSah(aksi) {
  if (!aksi || typeof aksi !== 'object') return false;
  if (aksi.kind === 'role') return Boolean(aksi.roleId);
  if (aksi.kind === 'reply') return Boolean(String(aksi.text || '').trim());
  if (aksi.kind === 'wait') return Number(aksi.seconds) >= 1;
  if (aksi.kind === 'condition') return Boolean(aksi.check) || Boolean(String(aksi.value || '').trim());
  if (aksi.kind === 'variable') return /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(String(aksi.name || ''));
  if (aksi.kind === 'thread') return Boolean(String(aksi.threadName || '').trim());
  if (aksi.kind === 'delete') return true;
  if (aksi.kind === 'dud') return true;
  if (aksi.kind === 'stop') return true;
  if (aksi.kind === 'raw') return Boolean(String(aksi.rawText || '').trim());
  return Boolean(Number(aksi.postId));
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
      var idLama = cariIdOpsi(menu, pick.value);
      menu.options.push({
        ...(idLama ? { id: idLama } : {}),
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
  renderUsage();
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

    kotak.appendChild(kartuAksi(targetOpsi(menu, opsi), 'pilihan ' + (opsi.label || '')));

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
  renderUsage();
}

/** Muat tombol role saat mengubah pesan yang sudah punya tombol. */
function loadRoleButtonsFor(postId) {
  roleButtons = (ROLE_BUTTONS[postId] || []).map(function (b) {
    return {
      id: b.id,
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
        return {
          id: o.id,
          roleId: o.roleId,
          label: o.label,
          emoji: o.emoji || '',
          description: o.description || '',
        };
      }),
    };
  });
  renderRoleMenus();
}

/* ---------------- Aksi komponen (flow ringkas) ---------------- */

/**
 * Muat aksi tersimpan untuk pesan yang sedang diubah.
 *
 * Disalin dalam (deep copy) supaya editor bisa mengubahnya bebas tanpa
 * merusak data sumber — pola yang sama dengan tombol & menu role.
 */
function loadActionsFor(postId) {
  var sumber = POST_ACTIONS[postId] || {};
  postActions = {};
  Object.keys(sumber).forEach(function (target) {
    postActions[target] = (sumber[target] || []).map(function (aksi) {
      return JSON.parse(JSON.stringify(aksi));
    });
  });
  aksiTerbuka = null;
}

/**
 * ID tombol tersimpan untuk role tertentu.
 *
 * Dipakai saat admin menghapus lalu menambahkan lagi tombol dengan role yang
 * sama: ID lamanya dipakai kembali, sehingga aksi yang sudah disusun tidak
 * ikut hilang tanpa alasan.
 */
function cariIdTombol(roleId) {
  var tersimpan = editingId ? ROLE_BUTTONS[editingId] || [] : [];
  for (var i = 0; i < tersimpan.length; i += 1) {
    if (tersimpan[i].roleId === roleId) return tersimpan[i].id;
  }
  return null;
}

/** ID opsi tersimpan untuk role tertentu di dalam satu menu. */
function cariIdOpsi(menu, roleId) {
  if (!editingId) return null;
  var daftar = ROLE_MENUS[editingId] || [];
  // Menu dicocokkan lewat placeholder + urutan pilihan: menu tidak punya ID
  // di state editor sebelum disimpan, jadi itu satu-satunya penanda yang ada.
  for (var i = 0; i < daftar.length; i += 1) {
    var kandidat = daftar[i];
    if (kandidat.placeholder !== menu.placeholder) continue;
    for (var j = 0; j < (kandidat.options || []).length; j += 1) {
      if (kandidat.options[j].roleId === roleId) return kandidat.options[j].id;
    }
  }
  return null;
}

/** Daftar aksi milik satu target; dibuatkan array kosong bila belum ada. */
function aksiUntuk(target) {
  if (!postActions[target]) postActions[target] = [];
  return postActions[target];
}

/** Kunci target tombol role. ID-nya belum ada sebelum disimpan (null). */
function targetTombol(tombol) {
  return tombol.id ? 'button:' + tombol.id : '';
}

/** Kunci target opsi dropdown role. */
function targetOpsi(menu, opsi) {
  return opsi.id ? 'option:' + opsi.id : '';
}

/**
 * Gambar ulang SEMUA tempat kartu aksi bisa muncul.
 *
 * Kartu aksi dipakai tiga tempat: daftar tombol role, pilihan dropdown role,
 * dan editor blok (untuk Select menu). Menyegarkan hanya salah satunya membuat
 * tombol "Atur aksi" pada blok Select tidak bereaksi — kartunya sudah berubah
 * di state, tetapi tidak pernah digambar ulang.
 */
function segarkanAksi() {
  renderBlocks();
  renderRoleButtons();
  renderRoleMenus();
}

/**
 * Kartu aksi untuk satu komponen.
 *
 * Target kosong berarti komponennya belum tersimpan, jadi belum punya ID —
 * aksi tidak bisa ditempelkan ke sana. Kartu tetap ditampilkan dengan
 * penjelasan, supaya admin tahu kenapa dan tidak mengira fiturnya rusak.
 */
function kartuAksi(target, judul) {
  var bungkus = document.createElement('div');
  bungkus.className = 'aksi-kartu';

  var head = document.createElement('div');
  head.className = 'aksi-head';

  var nama = document.createElement('span');
  nama.className = 'aksi-judul';
  var jumlah = target ? aksiUntuk(target).length : 0;
  /*
   * Angka yang ditampilkan adalah kuota flow (aksi berhitung), bukan jumlah
   * baris tingkat atas: cabang ikut dihitung server, dan admin perlu melihat
   * sisa kuotanya sebelum menekan Simpan — bukan sesudah sebagian aksi dibuang.
   */
  var hitung = target ? hitungAksi(aksiUntuk(target)) : { total: 0, berhitung: 0, pesan: 0 };
  nama.textContent = 'Aksi: ' + judul + (jumlah ? ' · ' + hitung.berhitung + '/' + BATAS_AKSI.countedPerFlow + ' dihitung' : '');
  head.appendChild(nama);

  var buka = document.createElement('button');
  buka.className = 'btn btn-ghost btn-sm';
  buka.type = 'button';
  buka.textContent = aksiTerbuka === target && target ? 'Tutup' : 'Atur aksi';
  buka.onclick = function () {
    aksiTerbuka = aksiTerbuka === target ? null : target;
    segarkanAksi();
  };
  head.appendChild(buka);
  bungkus.appendChild(head);

  if (!target) {
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.margin = '0';
    hint.textContent = 'Simpan pesan dulu — setelah tersimpan, tombol ini bisa diberi aksi.';
    bungkus.appendChild(hint);
    return bungkus;
  }

  if (aksiTerbuka !== target) {
    var ringkas = document.createElement('p');
    ringkas.className = 'hint';
    ringkas.style.margin = '0';
    ringkas.textContent = jumlah
      ? aksiUntuk(target).map(function (a) { return ringkasAksi(a); }).join(' → ')
      : 'Belum ada aksi. Komponen ini hanya tampil (tombol link) atau memakai perilaku role bawaan.';
    bungkus.appendChild(ringkas);
    return bungkus;
  }

  var daftar = document.createElement('div');
  daftar.className = 'aksi-daftar';
  aksiUntuk(target).forEach(function (aksi, nomor) {
    daftar.appendChild(buatBarisAksi(target, nomor, aksi));
  });
  bungkus.appendChild(daftar);

  var tambah = document.createElement('div');
  tambah.className = 'block-add';
  var pilih = document.createElement('select');
  pilih.className = 'role-mode';
  pilih.id = 'aksiJenis-' + target.replace(/[^a-z0-9]/gi, '-');
  DAFTAR_JENIS_AKSI.forEach(function (opt) {
    var o = document.createElement('option');
    o.value = opt[0];
    o.textContent = opt[1];
    pilih.appendChild(o);
  });
  tambah.appendChild(pilih);

  var tombolTambah = document.createElement('button');
  tombolTambah.className = 'btn btn-ghost btn-sm';
  tombolTambah.type = 'button';
  tombolTambah.textContent = '+ Tambah aksi';
  tombolTambah.onclick = function () {
    if (aksiUntuk(target).length >= BATAS_AKSI.perKomponen) {
      return toast('Maksimal ' + BATAS_AKSI.perKomponen + ' aksi per komponen', true);
    }
    /*
     * Kuota flow diperiksa SEBELUM aksi ditambahkan, supaya admin tahu
     * sekarang — bukan setelah menyimpan dan melihat sebagian aksinya hilang
     * dari laporan server.
     */
    var hitung = hitungAksi(aksiUntuk(target));
    if (hitung.berhitung >= BATAS_AKSI.countedPerFlow) {
      return toast('Batas ' + BATAS_AKSI.countedPerFlow + ' aksi dihitung per flow sudah tercapai', true);
    }
    var baru = aksiContoh(pilih.value);
    if (!baru) return;
    if ((baru.kind === 'message' || baru.kind === 'webhook') && hitung.pesan >= BATAS_AKSI.messagePerFlow) {
      return toast('Batas ' + BATAS_AKSI.messagePerFlow + ' aksi kirim pesan per flow sudah tercapai', true);
    }
    aksiUntuk(target).push(baru);
    segarkanAksi();
  };
  tambah.appendChild(tombolTambah);
  bungkus.appendChild(tambah);

  var bantuan = document.createElement('p');
  bantuan.className = 'hint';
  bantuan.style.margin = '0';
  bantuan.textContent =
    'Aksi dijalankan berurutan. Bisa memakai {member.name}, {member.mention}, {member.id}, {server.name}, {role}, {effect}, {selected}, dan {var.nama}. ' +
    'Aksi role yang gagal MENGENTIKAN sisa aksi; syarat TANPA cabang juga menghentikan flow bila tidak cocok. ' +
    'Syarat DENGAN cabang menjalankan cabangnya lalu lanjut ke aksi berikutnya, dan cabangnya boleh bersarang sampai ' +
    KEDALAMAN_CABANG + ' tingkat. ' +
    'Kuota flow: ' + BATAS_AKSI.countedPerFlow + ' aksi dihitung (syarat & hentikan tidak dihitung) dan ' +
    BATAS_AKSI.messagePerFlow + ' aksi kirim pesan. ' +
    'Aksi "Tunggu" menyimpan sisa aksi ke database — termasuk sisa aksi di dalam cabang — jadi penantian tetap berjalan walau bot restart.';
  bungkus.appendChild(bantuan);

  return bungkus;
}

/**
 * Satu cabang bersyarat (cocok / tidak cocok), bisa berisi aksi apa pun.
 *
 * Kotak bersarang, bukan daftar datar: cabang adalah bagian dari aksi syarat,
 * dan menampilkannya berderet membuat urutan flow terbaca salah (aksi cabang
 * seolah dijalankan selalu).
 *
 * Isi cabang memakai editor aksi yang SAMA dengan tingkat atas
 * (barisAksiDalam), jadi aksi di dalam cabang bisa diatur selengkap aksi di
 * luar — termasuk menambah syarat lagi di dalamnya. Kedalaman dijaga di
 * KEDALAMAN_CABANG (sama dengan ACTION_LIMITS.branchDepth di server).
 */
function kotakCabang(daftar, nomor, kunci, judul, kedalaman) {
  kedalaman = Number(kedalaman) || 0;
  var isi = daftar[nomor][kunci] || [];
  var kotak = document.createElement('div');
  kotak.className = 'aksi-cabang';

  var head = document.createElement('div');
  head.className = 'aksi-cabang-head';
  var nama = document.createElement('span');
  nama.className = 'aksi-cabang-judul';
  nama.textContent = 'Kalau ' + judul + ' (' + isi.length + ')';
  head.appendChild(nama);

  var tambah = document.createElement('select');
  tambah.className = 'role-mode';
  tambah.id = 'aksiCabang-' + kunci + '-' + nomor;
  DAFTAR_JENIS_AKSI.forEach(function (opt) {
    var o = document.createElement('option');
    o.value = opt[0];
    o.textContent = opt[1];
    tambah.appendChild(o);
  });
  head.appendChild(tambah);

  var tombol = document.createElement('button');
  tombol.className = 'btn btn-ghost btn-sm';
  tombol.type = 'button';
  tombol.textContent = '+';
  tombol.title = 'Tambah aksi ke cabang ini';
  tombol.onclick = function () {
    if (isi.length >= BATAS_AKSI.perKomponen) {
      return toast('Maksimal ' + BATAS_AKSI.perKomponen + ' aksi per cabang', true);
    }
    var jenis = tambah.value;
    /*
     * Menambah syarat ke cabang berarti membuat cabang satu tingkat lebih
     * dalam. Tingkat 0 = daftar tombol, jadi batasnya kedalaman + 1.
     */
    if (jenis === 'condition' && kedalaman + 1 >= KEDALAMAN_CABANG) {
      return toast(
        'Cabang maksimal ' + KEDALAMAN_CABANG + ' tingkat. Syarat lebih dalam bisa ditulis sebagai beberapa aksi syarat berurutan.',
        true,
      );
    }
    var baru = aksiContoh(jenis);
    if (!baru) return;
    isi.push(baru);
    if (!daftar[nomor][kunci]) daftar[nomor][kunci] = isi;
    segarkanAksi();
  };
  head.appendChild(tombol);
  kotak.appendChild(head);

  if (isi.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.style.margin = '0';
    kosong.textContent = 'Belum ada aksi di cabang ini.';
    kotak.appendChild(kosong);
    return kotak;
  }

  /*
   * Isi cabang digambar lewat editor aksi yang SAMA dengan tingkat atas, lalu
   * kotak cabang anaknya ditempelkan ke baris itu sendiri. Menempelkannya ke
   * baris (bukan ke kotak induk) membuat cabang bertingkat terbaca sebagai
   * bagian dari aksi syaratnya, bukan sebagai daftar sejajar.
   */
  isi.forEach(function (anak, urutan) {
    var baris = barisAksiDalam(isi, urutan, anak, segarkanAksi, kedalaman);
    baris.classList.add('aksi-cabang-baris');
    kotak.appendChild(baris);
  });

  var catatan = document.createElement('p');
  catatan.className = 'hint';
  catatan.style.margin = '0';
  catatan.textContent = 'Aksi cabang dijalankan berurutan, lalu flow lanjut ke aksi sesudah syarat.';
  kotak.appendChild(catatan);
  return kotak;
}

/* ---------------- Syarat bertingkat (and / or / not / in) ---------------- */

/**
 * Ringkasan satu simpul syarat.
 *
 * Ditulis ulang di sisi browser (bukan diimpor dari server) karena halaman
 * ini hanya menerima HTML+JS jadi: nilai yang dikirim server sudah berbentuk
 * data, dan label yang dibaca admin harus tetap muncul walau server sedang
 * lambat. Bentuknya SENGAJA sama dengan ringkasSyarat di post-actions.ts.
 */
function ringkasSyarat(node) {
  if (!node) return '(kosong)';
  if (node.type === 'in') {
    var daftar = (node.list || []).join(', ');
    return String(node.value || '?') + ' termasuk [' + daftar + ']';
  }
  if (node.type !== 'leaf') {
    var anak = (node.items || []).map(ringkasSyarat);
    if (anak.length === 0) return '(' + node.type + ')';
    var sambung = node.type === 'and' ? ' DAN ' : node.type === 'or' ? ' ATAU ' : ' DAN TIDAK ';
    return '(' + anak.join(sambung) + ')';
  }
  var banding = {
    equals: 'sama dengan', notEquals: 'tidak sama dengan',
    contains: 'mengandung', notContains: 'tidak mengandung',
    empty: 'kosong', notEmpty: 'tidak kosong'
  }[node.comparator || 'equals'];
  return String(node.value || '?') + ' ' + banding + (node.expected ? ' "' + node.expected + '"' : '');
}

/**
 * Karakter baris baru.
 *
 * Ditulis lewat fromCharCode, BUKAN lewat escape di dalam string: seluruh
 * fungsi ini hidup di dalam template literal halaman, dan escape seperti
 * backslash-n di sana berubah jadi baris baru sungguhan — yang membuat
 * JavaScript halaman gagal di-parse (dan halaman /pesan mati total).
 */
function barisBaru() {
  return String.fromCharCode(10);
}

/** Simpul baru sesuai jenis yang dipilih. */
function simpulBaru(tipe) {
  if (tipe === 'in') return { type: 'in', value: 'member.name', list: ['Wahyu'] };
  if (tipe === 'and' || tipe === 'or' || tipe === 'not') {
    return { type: tipe, items: [{ type: 'leaf', value: 'member.name', comparator: 'notEmpty' }] };
  }
  return { type: 'leaf', value: 'member.name', comparator: 'notEmpty' };
}

/**
 * Kotak editor satu simpul syarat, bersarang untuk and/or/not.
 *
 * Kedalaman pohon syarat dibatasi 3 tingkat di UI (server mengizinkan 4) —
 * bukan karena teknis, tetapi karena kotak yang lebih dalam dari itu tidak
 * terbaca di layar ponsel, dan syarat 4 tingkat hampir selalu bisa ditulis
 * lebih jelas sebagai beberapa aksi syarat berurutan.
 *
 * Ini BUKAN batas yang sama dengan kedalaman CABANG aksi (5 tingkat,
 * KEDALAMAN_CABANG): pohon syarat ada di dalam satu aksi, sedangkan cabang
 * adalah aksi di dalam aksi. Keduanya dihitung terpisah supaya angka yang
 * dilihat admin tidak tertukar.
 */
function kotakSyarat(node, induk, kunci, kedalaman) {
  var kotak = document.createElement('div');
  kotak.className = 'aksi-cabang';

  var head = document.createElement('div');
  head.className = 'aksi-cabang-head';
  var judul = document.createElement('span');
  judul.className = 'aksi-cabang-judul';
  judul.textContent = ringkasSyarat(node).slice(0, 70);
  head.appendChild(judul);

  var pilihTipe = document.createElement('select');
  pilihTipe.className = 'role-mode';
  [
    ['leaf', 'Bandingkan satu nilai'],
    ['and', 'SEMUA benar (dan)'],
    ['or', 'SALAH SATU benar (atau)'],
    ['not', 'SEMUA salah (bukan)'],
    ['in', 'Termasuk daftar']
  ].forEach(function (o) {
    var opt = document.createElement('option');
    opt.value = o[0];
    opt.textContent = o[1];
    if ((node.type || 'leaf') === o[0]) opt.selected = true;
    pilihTipe.appendChild(opt);
  });
  pilihTipe.onchange = function () {
    var baru = simpulBaru(pilihTipe.value);
    // Ganti ISI objek, bukan referensinya: pemanggil memegang objek yang sama
    // (pola yang sama dengan kotakCabang), jadi mengganti referensi akan
    // membuat perubahan tidak terkirim.
    Object.keys(node).forEach(function (k) { delete node[k]; });
    Object.keys(baru).forEach(function (k) { node[k] = baru[k]; });
    segarkanAksi();
  };
  head.appendChild(pilihTipe);

  if (induk) {
    var hapus = document.createElement('button');
    hapus.className = 'btn-danger btn-sm btn-icon';
    hapus.type = 'button';
    hapus.textContent = '×';
    hapus.title = 'Hapus syarat ini';
    hapus.onclick = function () {
      var daftar = induk.items || [];
      var posisi = daftar.indexOf(node);
      if (posisi >= 0) daftar.splice(posisi, 1);
      segarkanAksi();
    };
    head.appendChild(hapus);
  }
  kotak.appendChild(head);

  if (node.type === 'in') {
    var masuk = document.createElement('input');
    masuk.type = 'text';
    masuk.value = node.value || '';
    masuk.placeholder = 'nilai yang dicari, mis. selected';
    masuk.oninput = function () { node.value = masuk.value.slice(0, 64); };
    kotak.appendChild(masuk);

    var list = document.createElement('textarea');
    list.rows = 3;
    list.value = (node.list || []).join(barisBaru());
    list.placeholder = 'satu nilai per baris';
    list.oninput = function () {
      node.list = list.value.split(barisBaru()).map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 50);
    };
    kotak.appendChild(list);
    return kotak;
  }

  if (node.type === 'leaf') {
    var nilai = document.createElement('input');
    nilai.type = 'text';
    nilai.value = node.value || '';
    nilai.placeholder = 'member.name / selected / var.nama';
    nilai.oninput = function () { node.value = nilai.value.slice(0, 64); };
    kotak.appendChild(nilai);

    var banding = document.createElement('select');
    banding.className = 'role-mode';
    [
      ['equals', 'sama dengan'], ['notEquals', 'tidak sama dengan'],
      ['contains', 'mengandung'], ['notContains', 'tidak mengandung'],
      ['empty', 'kosong'], ['notEmpty', 'tidak kosong']
    ].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if ((node.comparator || 'equals') === o[0]) opt.selected = true;
      banding.appendChild(opt);
    });
    banding.onchange = function () {
      node.comparator = banding.value;
      segarkanAksi();
    };
    kotak.appendChild(banding);

    if ((node.comparator || 'equals') !== 'empty' && (node.comparator || 'equals') !== 'notEmpty') {
      var harap = document.createElement('input');
      harap.type = 'text';
      harap.value = node.expected || '';
      harap.placeholder = 'Nilai pembanding';
      harap.oninput = function () { node.expected = harap.value.slice(0, 500); };
      kotak.appendChild(harap);
    }
    return kotak;
  }

  // and / or / not: daftar anak bersarang.
  (node.items || []).forEach(function (anak) {
    kotak.appendChild(kotakSyarat(anak, node, 'items', kedalaman + 1));
  });

  if (kedalaman < 3) {
    var tambah = document.createElement('select');
    tambah.className = 'role-mode';
    [['leaf', 'Bandingkan satu nilai'], ['in', 'Termasuk daftar'], ['and', 'Semua benar'], ['or', 'Salah satu benar']]
      .forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        tambah.appendChild(opt);
      });

    var tombol = document.createElement('button');
    tombol.className = 'btn btn-ghost btn-sm';
    tombol.type = 'button';
    tombol.textContent = '+ Tambah syarat';
    tombol.onclick = function () {
      node.items = node.items || [];
      if (node.items.length >= 10) return toast('Maksimal 10 syarat di satu grup', true);
      node.items.push(simpulBaru(tambah.value));
      segarkanAksi();
    };
    var barisTambah = document.createElement('div');
    barisTambah.className = 'block-add';
    barisTambah.appendChild(tambah);
    barisTambah.appendChild(tombol);
    kotak.appendChild(barisTambah);
  } else {
    var batas = document.createElement('p');
    batas.className = 'hint';
    batas.style.margin = '0';
    batas.textContent =
      'Batas 3 tingkat gabungan syarat (dan / atau / bukan) di editor. Syarat lebih dalam bisa ditulis sebagai beberapa aksi syarat berurutan.';
    kotak.appendChild(batas);
  }

  return kotak;
}

/** Ringkasan satu aksi untuk daftar tertutup. */
function ringkasAksi(aksi) {
  if (aksi.kind === 'wait') return 'tunggu ' + jamAksi(Number(aksi.seconds) || 0);
  if (aksi.kind === 'condition') {
    if (aksi.check) return 'syarat ' + ringkasSyarat(aksi.check);
    var banding = {
      equals: 'sama dengan', notEquals: 'tidak sama dengan',
      contains: 'mengandung', notContains: 'tidak mengandung',
      empty: 'kosong', notEmpty: 'tidak kosong'
    }[aksi.comparator || 'equals'];
    return 'syarat ' + aksi.value + ' ' + banding + (aksi.expected ? ' "' + aksi.expected + '"' : '');
  }
  if (aksi.kind === 'variable') return 'simpan ' + aksi.name + ' = "' + String(aksi.value || '').slice(0, 24) + '"';
  if (aksi.kind === 'thread') return 'buat thread "' + String(aksi.threadName || '').slice(0, 30) + '"';
  if (aksi.kind === 'delete') {
    return aksi.what === 'sebelumnya' ? 'hapus pesan dari aksi sebelumnya' : 'hapus pesan ini';
  }
  if (aksi.kind === 'raw') {
    return 'kirim teks "' + String(aksi.rawText || '').slice(0, 40) + '"';
  }
  if (aksi.kind === 'dud') return 'tidak melakukan apa pun';
  if (aksi.kind === 'stop') return 'hentikan flow' + (aksi.stopMessage ? ' ("' + String(aksi.stopMessage).slice(0, 30) + '")' : '');
  if (aksi.kind === 'role') {
    var role = roleById(aksi.roleId);
    var op = aksi.op === 'give' ? 'beri' : aksi.op === 'remove' ? 'lepas' : 'pasang/lepas';
    return op + ' ' + (role ? '@' + role.name : 'role terhapus');
  }
  if (aksi.kind === 'reply') {
    return 'balas "' + String(aksi.text || '').slice(0, 40) + '"' + (aksi.hidden === false ? ' (publik)' : '');
  }
  var tujuan = POST_LIST.filter(function (p) { return p.id === Number(aksi.postId); })[0];
  var lewat = aksi.kind === 'webhook' ? ' via webhook' : '';
  var keChannel = aksi.channelId ? ' ke channel ' + aksi.channelId : '';
  return 'kirim "' + (tujuan ? tujuan.name : 'pesan #' + aksi.postId) + '"' + lewat + keChannel;
}

/** Label pendek tiap jenis aksi, dipakai di kepala baris aksi. */
function jenisAksiLabel(jenis) {
  return {
    role: 'Role',
    reply: 'Balasan',
    message: 'Kirim pesan',
    wait: 'Tunggu',
    condition: 'Syarat',
    variable: 'Variabel',
    thread: 'Thread',
    delete: 'Hapus pesan',
    dud: 'Tanpa aksi',
    stop: 'Hentikan',
    webhook: 'Kirim webhook',
    raw: 'Kirim teks'
  }[jenis] || jenis;
}

/**
 * Durasi dalam bentuk yang bisa dibaca: "5 menit", "2 jam", "3 hari".
 *
 * Dipakai ringkasan aksi "Tunggu" dan jadwal kirim, supaya admin tidak perlu
 * menghitung detik sendiri.
 */
function jamAksi(detik) {
  if (detik < 60) return Math.round(detik) + ' detik';
  if (detik < 3600) return Math.round(detik / 60) + ' menit';
  if (detik < 86400) return Math.round(detik / 3600) + ' jam';
  return Math.round(detik / 86400) + ' hari';
}

/** Format waktu lokal untuk daftar jadwal. */
function waktuLokal(ms) {
  var tanggal = new Date(Number(ms));
  if (isNaN(tanggal.getTime())) return 'waktu tidak sah';
  var dua = function (n) { return (n < 10 ? '0' : '') + n; };
  return (
    tanggal.getFullYear() + '-' + dua(tanggal.getMonth() + 1) + '-' + dua(tanggal.getDate()) +
    ' ' + dua(tanggal.getHours()) + ':' + dua(tanggal.getMinutes())
  );
}

/**
 * Isian tanggal-jam lokal → epoch ms.
 *
 * Isian datetime-local memberi tanggal dan jam TANPA zona waktu. new Date
 * membacanya sebagai waktu LOKAL, yang memang yang dimaksud admin. Mengubahnya
 * ke UTC akan menggeser jadwal beberapa jam bagi pengguna WIB/WITA/WIT.
 */
function waktuDariInput(nilai) {
  if (!nilai) return 0;
  var ms = new Date(nilai).getTime();
  return isNaN(ms) ? 0 : ms;
}

/** Satu baris aksi: semua isian yang dibutuhkan jenisnya. */
function buatBarisAksi(target, nomor, aksi) {
  return barisAksiDalam(aksiUntuk(target), nomor, aksi, segarkanAksi, 0);
}

/**
 * Satu baris editor aksi untuk DAFTAR mana pun.
 *
 * Dipakai daftar tingkat atas (tombol/menu) DAN daftar di dalam cabang
 * bersyarat. Dulu fungsi ini hanya mengenal daftar milik satu target, jadi
 * cabang terpaksa memakai editor ringkas sendiri — akibatnya aksi di dalam
 * cabang tidak bisa diatur sama lengkapnya dengan aksi di luar (padahal
 * server menegakkan aturan yang sama untuk keduanya). Tinggal satu editor
 * berarti tidak ada dua perilaku yang bisa menyimpang.
 */
function barisAksiDalam(daftar, nomor, aksi, segarkan, kedalaman) {
  kedalaman = Number(kedalaman) || 0;
  var baris = document.createElement('div');
  baris.className = 'aksi-baris';

  var head = document.createElement('div');
  head.className = 'aksi-baris-head';
  var label = document.createElement('span');
  label.className = 'aksi-jenis';
  label.textContent = (nomor + 1) + '. ' + jenisAksiLabel(aksi.kind);
  head.appendChild(label);

  var alat = document.createElement('div');
  alat.className = 'blok-aksi';

  if (nomor > 0) {
    var naik = document.createElement('button');
    naik.className = 'btn-ghost btn-sm btn-icon';
    naik.type = 'button';
    naik.title = 'Naikkan aksi';
    naik.textContent = '↑';
    naik.onclick = function () {
      var tmp = daftar[nomor - 1];
      daftar[nomor - 1] = daftar[nomor];
      daftar[nomor] = tmp;
      segarkan();
    };
    alat.appendChild(naik);
  }

  var hapus = document.createElement('button');
  hapus.className = 'btn-danger btn-sm btn-icon';
  hapus.type = 'button';
  hapus.title = 'Hapus aksi';
  hapus.textContent = '×';
  hapus.onclick = function () {
    daftar.splice(nomor, 1);
    segarkan();
  };
  alat.appendChild(hapus);
  head.appendChild(alat);
  baris.appendChild(head);

  if (aksi.kind === 'role') {
    var pilihRole = document.createElement('select');
    pilihRole.className = 'role-mode';
    ROLES.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.name + (r.blockedBy ? ' — ' + r.blockedBy : '');
      if (aksi.roleId === r.id) o.selected = true;
      pilihRole.appendChild(o);
    });
    pilihRole.onchange = function () { daftar[nomor].roleId = pilihRole.value; };
    baris.appendChild(pilihRole);

    var pilihOp = document.createElement('select');
    pilihOp.className = 'role-mode';
    [['toggle', 'Pasang / lepas'], ['give', 'Hanya beri'], ['remove', 'Hanya lepas']].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if ((aksi.op || 'toggle') === o[0]) opt.selected = true;
      pilihOp.appendChild(opt);
    });
    pilihOp.onchange = function () { daftar[nomor].op = pilihOp.value; };
    baris.appendChild(pilihOp);
    return baris;
  }

  if (aksi.kind === 'reply') {
    var teks = document.createElement('textarea');
    teks.rows = 2;
    teks.value = aksi.text || '';
    teks.placeholder = 'mis. ✅ Role {role} sudah {effect}, {member.mention}!';
    teks.oninput = function () { daftar[nomor].text = teks.value.slice(0, 1800); };
    baris.appendChild(teks);

    var sembunyi = document.createElement('label');
    sembunyi.className = 'menu-flags';
    var cek = document.createElement('input');
    cek.type = 'checkbox';
    cek.checked = aksi.hidden !== false;
    cek.onchange = function () { daftar[nomor].hidden = cek.checked; };
    sembunyi.appendChild(cek);
    sembunyi.appendChild(document.createTextNode(' hanya pengklik yang melihat (ephemeral)'));
    baris.appendChild(sembunyi);
    return baris;
  }

  if (aksi.kind === 'wait') {
    var barisTunggu = document.createElement('div');
    barisTunggu.className = 'role-style-row';
    var detik = document.createElement('input');
    detik.type = 'number';
    detik.min = '1';
    detik.max = String(604800);
    detik.value = String(Math.max(1, Number(aksi.seconds) || 300));
    detik.title = 'Lama penantian dalam detik (maksimal 7 hari)';
    var satuan = document.createElement('select');
    satuan.className = 'role-mode';
    [['1', 'detik'], ['60', 'menit'], ['3600', 'jam'], ['86400', 'hari']].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      satuan.appendChild(opt);
    });
    // Satuan dipilih otomatis dari nilai yang ada, supaya "300" tampil sebagai
    // "5 menit" — bukan angka mentah yang harus dihitung admin.
    var awal = Math.max(1, Number(aksi.seconds) || 300);
    satuan.value = awal % 86400 === 0 ? '86400' : awal % 3600 === 0 ? '3600' : awal % 60 === 0 ? '60' : '1';
    if (satuan.value === '1') detik.value = String(awal);
    else detik.value = String(awal / Number(satuan.value));
    var terapkan = function () {
      var nilai = Math.max(1, Number(detik.value) || 1) * Number(satuan.value);
      daftar[nomor].seconds = Math.min(604800, Math.round(nilai));
    };
    detik.oninput = terapkan;
    satuan.onchange = function () {
      // Nilai diisian dipertahankan sebagai ANGKA SATUAN, bukan detik: admin
      // mengetik "5" lalu memilih "menit", dan itu memang 5 menit.
      terapkan();
    };
    barisTunggu.appendChild(detik);
    barisTunggu.appendChild(satuan);
    baris.appendChild(barisTunggu);

    var catatanTunggu = document.createElement('p');
    catatanTunggu.className = 'hint';
    catatanTunggu.style.margin = '0';
    catatanTunggu.textContent =
      'Sisa aksi disimpan ke database dan dilanjutkan timer, jadi penantian tetap berjalan walau bot restart. Waktunya tidak presisi detik.';
    baris.appendChild(catatanTunggu);
    return baris;
  }

  if (aksi.kind === 'condition') {
    /*
     * Pilihan bentuk syarat. "Gabungan" = pohon dan/or/not/in (seperti
     * Discohook), datar = bentuk lama. Salah satu saja yang dipakai — memakai
     * keduanya membuat hasilnya sulit ditebak, dan server pun memilih pohon
     * lebih dulu.
     */
    var bentuk = document.createElement('select');
    bentuk.className = 'role-mode';
    [['flat', 'Satu pembanding (bentuk lama)'], ['tree', 'Gabungan syarat (dan / atau / bukan / termasuk)']]
      .forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        if ((aksi.check ? 'tree' : 'flat') === o[0]) opt.selected = true;
        bentuk.appendChild(opt);
      });
    bentuk.onchange = function () {
      if (bentuk.value === 'tree') {
        daftar[nomor].check = simpulBaru('and');
        delete daftar[nomor].value;
        delete daftar[nomor].expected;
      } else {
        delete daftar[nomor].check;
        daftar[nomor].value = 'member.name';
        daftar[nomor].comparator = 'notEmpty';
      }
      segarkan();
    };
    baris.appendChild(bentuk);

    if (aksi.check) {
      baris.appendChild(kotakSyarat(aksi.check, null, 'check', 0));
    } else {
    var nilai = document.createElement('input');
    nilai.type = 'text';
    nilai.value = aksi.value || 'member.name';
    nilai.placeholder = 'member.name / selected / var.nama';
    nilai.oninput = function () { daftar[nomor].value = nilai.value.slice(0, 64); };
    baris.appendChild(nilai);

    var banding = document.createElement('select');
    banding.className = 'role-mode';
    [
      ['equals', 'sama dengan'],
      ['notEquals', 'tidak sama dengan'],
      ['contains', 'mengandung'],
      ['notContains', 'tidak mengandung'],
      ['empty', 'kosong'],
      ['notEmpty', 'tidak kosong']
    ].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if ((aksi.comparator || 'equals') === o[0]) opt.selected = true;
      banding.appendChild(opt);
    });
    banding.onchange = function () {
      daftar[nomor].comparator = banding.value;
      segarkan();
    };
    baris.appendChild(banding);

    // Pembanding "kosong"/"tidak kosong" tidak butuh nilai — isiannya
    // disembunyikan, bukan ditampilkan lalu diabaikan diam-diam.
    if ((aksi.comparator || 'equals') !== 'empty' && (aksi.comparator || 'equals') !== 'notEmpty') {
      var harap = document.createElement('input');
      harap.type = 'text';
      harap.value = aksi.expected || '';
      harap.placeholder = 'Nilai pembanding';
      harap.oninput = function () { daftar[nomor].expected = harap.value.slice(0, 500); };
      baris.appendChild(harap);
    }
    }

    /*
     * Dua jalur, seperti Check di Discohook: aksi yang dijalankan bila cocok
     * dan bila tidak. Kalau keduanya kosong, perilakunya tetap seperti versi
     * sebelumnya (tidak cocok = flow berhenti) supaya aksi yang sudah
     * tersimpan tidak berubah arti.
     */
    var adaCabang = (aksi.then && aksi.then.length) || (aksi.else && aksi.else.length);
    var catatanSyarat = document.createElement('p');
    catatanSyarat.className = 'hint';
    catatanSyarat.style.margin = '0';
    catatanSyarat.textContent = adaCabang
      ? 'Syarat cocok: jalankan cabang "cocok". Tidak cocok: jalankan cabang "tidak cocok". Flow lanjut ke aksi berikutnya sesudah cabang selesai.'
      : 'Kedua cabang masih kosong, jadi syarat yang tidak cocok akan MENGENTIKAN sisa flow. Isi salah satu cabang untuk membuat percabangan.';
    baris.appendChild(catatanSyarat);

    /*
     * Cabang digambar DI SINI, bukan oleh pemanggil: satu tempat berarti
     * cabang tingkat atas dan cabang di dalam cabang memakai aturan yang sama,
     * dan tidak ada kotak yang tergambar dua kali.
     */
    baris.appendChild(kotakCabang(daftar, nomor, 'then', 'cocok', kedalaman + 1));
    baris.appendChild(kotakCabang(daftar, nomor, 'else', 'tidak cocok', kedalaman + 1));
    return baris;
  }

  if (aksi.kind === 'stop') {
    var pesanStop = document.createElement('input');
    pesanStop.type = 'text';
    pesanStop.value = aksi.stopMessage || '';
    pesanStop.placeholder = 'Pesan saat flow berhenti (opsional)';
    pesanStop.oninput = function () { daftar[nomor].stopMessage = pesanStop.value.slice(0, 1800); };
    baris.appendChild(pesanStop);

    var catatanStop = document.createElement('p');
    catatanStop.className = 'hint';
    catatanStop.style.margin = '0';
    catatanStop.textContent = 'Sisa aksi tidak dijalankan. Kosongkan pesannya kalau berhenti tanpa penjelasan.';
    baris.appendChild(catatanStop);
    return baris;
  }

  if (aksi.kind === 'dud') {
    var catatanDud = document.createElement('p');
    catatanDud.className = 'hint';
    catatanDud.style.margin = '0';
    catatanDud.textContent =
      'Tidak melakukan apa pun. Berguna sebagai penanda "sengaja dikosongkan" saat menyusun flow bertahap.';
    baris.appendChild(catatanDud);
    return baris;
  }

  if (aksi.kind === 'variable') {
    var namaVar = document.createElement('input');
    namaVar.type = 'text';
    namaVar.value = aksi.name || '';
    namaVar.placeholder = 'nama variabel (huruf, angka, garis bawah)';
    namaVar.oninput = function () { daftar[nomor].name = namaVar.value.slice(0, 32); };
    baris.appendChild(namaVar);

    /*
     * Sumber nilai. Discohook punya tiga jenis variabel; di sini yang
     * "adaptive" hanya menawarkan nilai yang BENAR-BENAR kita punya setelah
     * aksi sebelumnya (pesan/channel/thread). Menawarkan nilai lain hanya akan
     * membuat flow tampak bisa sesuatu yang belum bisa.
     */
    var sumber = document.createElement('select');
    sumber.className = 'role-mode';
    [
      ['static', 'Teks / template'],
      ['adaptive', 'Hasil aksi sebelumnya'],
      ['get', 'Salin variabel lain']
    ].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if ((aksi.source || 'static') === o[0]) opt.selected = true;
      sumber.appendChild(opt);
    });
    sumber.onchange = function () {
      daftar[nomor].source = sumber.value;
      daftar[nomor].value = sumber.value === 'adaptive' ? 'messageId' : sumber.value === 'get' ? 'var.nama' : '';
      segarkan();
    };
    baris.appendChild(sumber);

    if ((aksi.source || 'static') === 'adaptive') {
      var pilihHasil = document.createElement('select');
      pilihHasil.className = 'role-mode';
      [
        ['messageId', 'ID pesan yang baru dikirim'],
        ['channelId', 'ID channel pesan itu'],
        ['threadId', 'ID thread yang baru dibuat']
      ].forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        if (aksi.value === o[0]) opt.selected = true;
        pilihHasil.appendChild(opt);
      });
      pilihHasil.onchange = function () { daftar[nomor].value = pilihHasil.value; };
      baris.appendChild(pilihHasil);
    } else {
      var isiVar = document.createElement('input');
      isiVar.type = 'text';
      isiVar.value = aksi.value || '';
      isiVar.placeholder = (aksi.source || 'static') === 'get'
        ? 'nama variabel lain, mis. var.kode'
        : 'nilai, mis. {member.name} atau teks bebas';
      isiVar.oninput = function () { daftar[nomor].value = isiVar.value.slice(0, 500); };
      baris.appendChild(isiVar);
    }

    var catatanVar = document.createElement('p');
    catatanVar.className = 'hint';
    catatanVar.style.margin = '0';
    catatanVar.textContent = 'Dipakai di aksi berikutnya sebagai {var.' + (aksi.name || 'nama') + '}.';
    baris.appendChild(catatanVar);
    return baris;
  }

  if (aksi.kind === 'thread') {
    var namaThread = document.createElement('input');
    namaThread.type = 'text';
    namaThread.value = aksi.threadName || '';
    namaThread.placeholder = 'Nama thread, mis. "Bantuan {member.name}"';
    namaThread.oninput = function () { daftar[nomor].threadName = namaThread.value.slice(0, 100); };
    baris.appendChild(namaThread);

    var privatLabel = document.createElement('label');
    privatLabel.className = 'menu-flags';
    var cekPrivat = document.createElement('input');
    cekPrivat.type = 'checkbox';
    cekPrivat.checked = aksi.private === true;
    cekPrivat.onchange = function () {
      daftar[nomor].private = cekPrivat.checked;
      segarkan();
    };
    privatLabel.appendChild(cekPrivat);
    privatLabel.appendChild(document.createTextNode(' thread privat (hanya yang diundang)'));
    baris.appendChild(privatLabel);

    /*
     * Setelan lanjutan yang ada di Discohook. Tanpa pilihan ini, thread yang
     * dibuat selalu memakai bawaan Discord (arsip 24 jam, tanpa slowmode) —
     * padahal admin sering ingin arsip lebih lama supaya thread tidak
     * menghilang dari daftar.
     */
    var setelan = document.createElement('div');
    setelan.className = 'role-style-row';

    var arsip = document.createElement('select');
    arsip.className = 'role-mode';
    [
      ['', 'Arsip: bawaan Discord'],
      ['60', 'Arsip 1 jam'],
      ['1440', 'Arsip 1 hari'],
      ['4320', 'Arsip 3 hari'],
      ['10080', 'Arsip 1 minggu']
    ].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if (String(aksi.autoArchiveMinutes || '') === o[0]) opt.selected = true;
      arsip.appendChild(opt);
    });
    arsip.onchange = function () {
      if (arsip.value) daftar[nomor].autoArchiveMinutes = Number(arsip.value);
      else delete daftar[nomor].autoArchiveMinutes;
    };
    setelan.appendChild(arsip);

    var lambat = document.createElement('input');
    lambat.type = 'number';
    lambat.min = '0';
    lambat.max = '21600';
    lambat.value = String(Number(aksi.slowmodeSeconds) || 0);
    lambat.title = 'Slowmode thread (detik per pesan, 0 = mati)';
    lambat.oninput = function () {
      var angka = Math.max(0, Math.min(21600, Math.trunc(Number(lambat.value) || 0)));
      if (angka > 0) daftar[nomor].slowmodeSeconds = angka;
      else delete daftar[nomor].slowmodeSeconds;
    };
    setelan.appendChild(lambat);
    baris.appendChild(setelan);

    if (aksi.private) {
      var undangLabel = document.createElement('label');
      undangLabel.className = 'menu-flags';
      var cekUndang = document.createElement('input');
      cekUndang.type = 'checkbox';
      cekUndang.checked = aksi.invitable !== false;
      cekUndang.onchange = function () { daftar[nomor].invitable = cekUndang.checked; };
      undangLabel.appendChild(cekUndang);
      undangLabel.appendChild(document.createTextNode(' orang lain boleh mengundang ke thread ini'));
      baris.appendChild(undangLabel);
    }

    var tagForum = document.createElement('input');
    tagForum.type = 'text';
    tagForum.value = (aksi.appliedTags || []).join(', ');
    tagForum.placeholder = 'ID tag forum, dipisah koma (maks. 5) — kosongkan untuk channel teks';
    tagForum.oninput = function () {
      var tag = tagForum.value.split(',').map(function (t) { return t.trim(); })
        .filter(function (t) { return /^[0-9]{5,25}$/.test(t); }).slice(0, 5);
      if (tag.length) daftar[nomor].appliedTags = tag;
      else delete daftar[nomor].appliedTags;
    };
    baris.appendChild(tagForum);

    var pembuka = document.createElement('input');
    pembuka.type = 'text';
    pembuka.value = aksi.threadMessage || '';
    pembuka.placeholder = 'Pesan pembuka thread (opsional), boleh pakai {member.name}';
    pembuka.oninput = function () {
      var isi = pembuka.value.slice(0, 1800);
      if (isi.trim()) daftar[nomor].threadMessage = isi;
      else delete daftar[nomor].threadMessage;
    };
    baris.appendChild(pembuka);

    var catatanThread = document.createElement('p');
    catatanThread.className = 'hint';
    catatanThread.style.margin = '0';
    catatanThread.textContent =
      'Tag forum membuat bot memperlakukan channel ini sebagai FORUM: thread dibuat sebagai postingan baru dengan tag tersebut.';
    baris.appendChild(catatanThread);
    return baris;
  }

  if (aksi.kind === 'delete') {
    var pilihHapus = document.createElement('select');
    pilihHapus.className = 'role-mode';
    [
      ['pesan', 'Pesan yang memuat komponen ini'],
      ['sebelumnya', 'Pesan hasil aksi kirim sebelumnya']
    ].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
      if ((aksi.what || 'pesan') === opt[0]) o.selected = true;
      pilihHapus.appendChild(o);
    });
    pilihHapus.onchange = function () { daftar[nomor].what = pilihHapus.value; };
    baris.appendChild(pilihHapus);

    var catatanHapus = document.createElement('p');
    catatanHapus.className = 'hint';
    catatanHapus.style.margin = '0';
    catatanHapus.textContent =
      'Bot butuh izin Manage Messages; kegagalannya diberitahukan ke pengklik, bukan hilang diam-diam. Aksi sesudah ini tidak akan terlihat — pesannya sudah hilang.';
    baris.appendChild(catatanHapus);
    return baris;
  }

  if (aksi.kind === 'raw') {
    var isiMentah = document.createElement('textarea');
    isiMentah.rows = 3;
    isiMentah.spellcheck = false;
    isiMentah.value = aksi.rawText || '';
    isiMentah.placeholder = 'Teks biasa: Halo {member.mention}, cek #pengumuman';
    isiMentah.oninput = function () {
      var isi = isiMentah.value.slice(0, 1800);
      if (isi.trim()) daftar[nomor].rawText = isi;
      else delete daftar[nomor].rawText;
    };
    baris.appendChild(isiMentah);

    var channelMentah = document.createElement('input');
    channelMentah.type = 'text';
    channelMentah.placeholder = 'ID channel tujuan (kosong = channel pesan ini)';
    channelMentah.value = aksi.channelId || '';
    channelMentah.oninput = function () {
      var id = channelMentah.value.replace(/[^0-9]/g, '');
      if (id) daftar[nomor].channelId = id;
      else delete daftar[nomor].channelId;
    };
    baris.appendChild(channelMentah);

    var catatanMentah = document.createElement('p');
    catatanMentah.className = 'hint';
    catatanMentah.style.margin = '0';
    catatanMentah.textContent =
      'Teks dikirim sebagai pesan biasa tanpa komponen — padanan SendRawMessage di Discohook. Templat {member.name}, {server.name}, dan {var.*} berlaku di sini.';
    baris.appendChild(catatanMentah);
    return baris;
  }

  // kind === 'message' atau 'webhook'
  var pilihPesan = document.createElement('select');
  pilihPesan.className = 'role-mode';
  POST_LIST.filter(function (p) { return !editingId || p.id !== editingId; }).forEach(function (p) {
    var o = document.createElement('option');
    o.value = String(p.id);
    o.textContent = p.name;
    if (Number(aksi.postId) === p.id) o.selected = true;
    pilihPesan.appendChild(o);
  });
  pilihPesan.onchange = function () { daftar[nomor].postId = Number(pilihPesan.value); };
  baris.appendChild(pilihPesan);

  if (aksi.kind === 'webhook') {
    var catatanWebhook = document.createElement('p');
    catatanWebhook.className = 'hint';
    catatanWebhook.style.margin = '0';
    catatanWebhook.textContent =
      'Dikirim lewat webhook: pesan tampil atas nama server. Tombol/menu role TIDAK ikut (Discord hanya mengirim interaksi ke aplikasi pengirim), dan bot butuh izin Manage Webhooks.';
    baris.appendChild(catatanWebhook);
  }

  var keChannel = document.createElement('label');
  keChannel.className = 'menu-flags';
  var cekChannel = document.createElement('input');
  cekChannel.type = 'checkbox';
  cekChannel.checked = aksi.toChannel !== false;
  cekChannel.onchange = function () { daftar[nomor].toChannel = cekChannel.checked; };
  keChannel.appendChild(cekChannel);
  keChannel.appendChild(document.createTextNode(' kirim ke channel (bukan balasan)'));
  baris.appendChild(keChannel);

  /*
   * Channel tujuan lain. Kosong = channel pesan pemicu. Ditulis sebagai ID
   * (bukan dropdown) karena daftar channel tidak selalu tersedia di halaman
   * ini saat bot sedang offline — dan ID yang salah DILAPORKAN oleh server,
   * bukan diam-diam jatuh ke channel pemicu.
   */
  var channelTujuan = document.createElement('input');
  channelTujuan.type = 'text';
  channelTujuan.value = aksi.channelId || '';
  channelTujuan.placeholder = 'ID channel tujuan (kosong = channel pesan ini)';
  channelTujuan.oninput = function () {
    var isi = channelTujuan.value.trim();
    if (isi) daftar[nomor].channelId = isi;
    else delete daftar[nomor].channelId;
  };
  baris.appendChild(channelTujuan);

  var susulan = document.createElement('input');
  susulan.type = 'text';
  susulan.value = aksi.followUp || '';
  susulan.placeholder = 'Teks sesudah terkirim (opsional), mis. "Cek {member.mention}!"';
  susulan.oninput = function () { daftar[nomor].followUp = susulan.value.slice(0, 300); };
  baris.appendChild(susulan);
  return baris;
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

/* ---------------- Dokumen multi-pesan (tab "Multi-pesan") ---------------- */

/**
 * Panggil API dengan metode apa pun.
 *
 * postJson bawaan hanya bisa POST, sedangkan dokumen butuh DELETE (hapus)
 * dan POST dengan muatan berbeda. Dibuat pembungkus kecil di sini, bukan
 * diubah di shell: halaman lain memakai postJson sebagai POST dan mengubah
 * artinya akan membuat tombol di halaman lain mengirim metode yang salah.
 */
async function apiMetode(path, payload, method) {
  try {
    return await api(path, {
      method: method,
      headers: { 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
  } catch (error) {
    toast('Gagal: ' + error.message, true);
    return { ok: false, error: error.message };
  }
}

/**
 * Render daftar pesan di dokumen yang sedang disusun.
 *
 * Tiap baris memperlihatkan urutan, rujukan balasan, dan apakah pesan itu
 * memulai thread — tiga hal yang paling menentukan bentuk rangkaiannya, dan
 * yang paling tidak terlihat kalau hanya ditampilkan sebagai teks isi.
 */
function renderGrup() {
  var host = document.getElementById('grupDaftar');
  if (!host) return;
  host.innerHTML = '';

  var nama = document.getElementById('grupNama');
  if (nama) nama.value = grupAktif.name || '';
  var series = document.getElementById('grupSeries');
  if (series) series.checked = grupAktif.series === true;

  if (grupAktif.messages.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.style.margin = '0';
    kosong.textContent =
      'Belum ada pesan. "Tambah pesan" menyalin isi pesan yang sedang dibuka di tab Susun — jadi susun isinya di sana, lalu tambahkan ke dokumen ini.';
    host.appendChild(kosong);
  }

  grupAktif.messages.forEach(function (pesan, urutan) {
    var baris = document.createElement('div');
    baris.className = 'aksi-cabang-baris';

    var teks = document.createElement('span');
    teks.className = 'aksi-cabang-teks';
    var rujukan = pesan.reference ? ' ↳ balasan "' + pesan.reference + '"' : '';
    var thread = pesan.threadName ? ' 🧵 ' + pesan.threadName : '';
    teks.textContent = (urutan + 1) + '. ' + pesan.name + rujukan + thread;
    baris.appendChild(teks);

    var pilihBalas = document.createElement('select');
    pilihBalas.className = 'role-mode';
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'tanpa balasan';
    pilihBalas.appendChild(opt0);
    grupAktif.messages.forEach(function (lain) {
      if (lain.id === pesan.id) return;
      var o = document.createElement('option');
      o.value = lain.id;
      o.textContent = 'balas ' + lain.name;
      if (pesan.reference === lain.id) o.selected = true;
      pilihBalas.appendChild(o);
    });
    pilihBalas.onchange = function () {
      if (pilihBalas.value) pesan.reference = pilihBalas.value;
      else delete pesan.reference;
      renderGrup();
    };
    baris.appendChild(pilihBalas);

    var threadInput = document.createElement('input');
    threadInput.type = 'text';
    threadInput.value = pesan.threadName || '';
    threadInput.placeholder = 'nama thread (opsional)';
    threadInput.oninput = function () {
      var isi = threadInput.value.trim().slice(0, 100);
      if (isi) pesan.threadName = isi;
      else delete pesan.threadName;
    };
    baris.appendChild(threadInput);

    var naik = document.createElement('button');
    naik.className = 'btn btn-ghost btn-sm btn-icon';
    naik.type = 'button';
    naik.textContent = '↑';
    naik.title = 'Naikkan urutan';
    naik.onclick = function () {
      if (urutan === 0) return;
      var tukar = grupAktif.messages[urutan - 1];
      grupAktif.messages[urutan - 1] = pesan;
      grupAktif.messages[urutan] = tukar;
      renderGrup();
    };
    baris.appendChild(naik);

    var hapus = document.createElement('button');
    hapus.className = 'btn-danger btn-sm btn-icon';
    hapus.type = 'button';
    hapus.textContent = '×';
    hapus.title = 'Hapus pesan dari dokumen';
    hapus.onclick = function () {
      grupAktif.messages.splice(urutan, 1);
      /*
       * Rujukan ke pesan yang baru dihapus ikut dilepas: kalau tidak, server
       * akan melaporkannya sebagai "balasan menunjuk pesan yang tidak ada"
       * dan admin bingung kenapa perubahan kecilnya ditolak.
       */
      grupAktif.messages.forEach(function (lain) {
        if (lain.reference === pesan.id) delete lain.reference;
      });
      renderGrup();
    };
    baris.appendChild(hapus);

    host.appendChild(baris);
  });

  renderGrupTersimpan();
}

/** Daftar dokumen tersimpan: bisa dibuka lagi, dikirim, atau dihapus. */
function renderGrupTersimpan() {
  var host = document.getElementById('grupTersimpan');
  if (!host) return;
  host.innerHTML = '';
  if (DOKUMEN.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.style.margin = '0';
    kosong.textContent = 'Belum ada dokumen tersimpan.';
    host.appendChild(kosong);
    return;
  }
  DOKUMEN.forEach(function (dok) {
    var baris = document.createElement('div');
    baris.className = 'list-row';

    var badan = document.createElement('div');
    badan.className = 'list-body';
    var judul = document.createElement('div');
    judul.className = 'list-title';
    judul.textContent = dok.name + (dok.series ? ' · berurutan' : '');
    badan.appendChild(judul);
    var meta = document.createElement('div');
    meta.className = 'list-meta';
    meta.textContent = dok.messages.length + ' pesan';
    badan.appendChild(meta);
    baris.appendChild(badan);

    var aksi = document.createElement('div');
    aksi.className = 'list-actions';

    var buka = document.createElement('button');
    buka.className = 'btn btn-ghost btn-sm';
    buka.type = 'button';
    buka.textContent = 'Buka';
    buka.onclick = function () { bukaGrup(dok.id); };
    aksi.appendChild(buka);

    var hapus = document.createElement('button');
    hapus.className = 'btn-danger btn-sm btn-icon';
    hapus.type = 'button';
    hapus.textContent = '×';
    hapus.title = 'Hapus dokumen';
    hapus.onclick = function () { hapusGrup(dok.id); };
    aksi.appendChild(hapus);

    baris.appendChild(aksi);
    host.appendChild(baris);
  });
}

/** Tambah satu pesan ke dokumen — isinya SALINAN dari editor yang sedang dibuka. */
function tambahPesanGrup() {
  if (grupAktif.messages.length >= 20) return toast('Maksimal 20 pesan per dokumen', true);
  if (!blocks.length) return toast('Susun isi pesan dulu di tab Susun', true);
  /*
   * ID dibuat berurutan dan stabil di dokumen ini (p1, p2, dst). ID acak
   * akan membuat rujukan yang sudah dipilih admin menunjuk ke tempat lain
   * setiap kali dokumen disimpan ulang.
   */
  var nomor = 1;
  while (grupAktif.messages.some(function (p) { return p.id === 'p' + nomor; })) nomor += 1;
  grupAktif.messages.push({
    id: 'p' + nomor,
    name: 'Pesan ' + (grupAktif.messages.length + 1),
    blocks: JSON.parse(JSON.stringify(blocks))
  });
  var empat = document.getElementById('grupNama');
  if (empat && !grupAktif.name) grupAktif.name = (document.getElementById('postName').value || 'Dokumen').slice(0, 80);
  renderGrup();
}

/* ---------------- JSON dokumen multi-pesan ---------------- */

/**
 * Bentuk baku dokumen untuk ekspor/impor.
 *
 * Kolom format dan version disertakan supaya berkas lama bisa dikenali dan ditolak
 * dengan alasan yang jelas, bukan dibaca setengah lalu merusak dokumen yang
 * sedang terbuka.
 */
var DOKUMEN_FORMAT = { format: 'zypher-document', version: 1 };

/** Ekspor dokumen yang sedang dibuka ke kotak JSON. */
function eksporDokumen() {
  var status = document.getElementById('grupJsonStatus');
  if (!grupAktif.messages.length) return toast('Dokumen ini belum punya pesan', true);
  /*
   * Yang diekspor adalah keadaan EDITOR, bukan salinan terakhir dari server:
   * admin menekan ekspor justru untuk menyimpan perubahan yang belum disimpan.
   */
  var data = {
    format: DOKUMEN_FORMAT.format,
    version: DOKUMEN_FORMAT.version,
    name: grupAktif.name || (document.getElementById('grupNama') || {}).value || '',
    series: (document.getElementById('grupSeries') || {}).checked === true,
    messages: grupAktif.messages.map(function (pesan) {
      var satu = { id: pesan.id, name: pesan.name, blocks: payloadBlokPesan(pesan) };
      if (pesan.reference) satu.reference = pesan.reference;
      if (pesan.threadName) satu.threadName = pesan.threadName;
      return satu;
    }),
  };
  var teks = JSON.stringify(data, null, 2);
  var kotak = document.getElementById('grupJson');
  if (kotak) kotak.value = teks;
  if (status) {
    status.textContent = '✅ ' + data.messages.length + ' pesan (' + Math.round(teks.length / 1024) + ' KB)';
  }
}

/**
 * Blok satu pesan dokumen, dalam bentuk yang bisa dikirim ke server.
 *
 * Pesan dokumen menyimpan blok yang sudah "baku" (bukan blok editor), jadi
 * hanya dibersihkan dari field kosong — bukan diubah bentuknya. Menormalkan
 * ulang di sini akan membuat blok hasil impor Discohook kehilangan field yang
 * tidak dikenal editor.
 */
function payloadBlokPesan(pesan) {
  return (pesan.blocks || []).map(function (satu) {
    var salinan = {};
    Object.keys(satu).forEach(function (kunci) {
      var nilai = satu[kunci];
      if (nilai === undefined || nilai === null || nilai === '') return;
      salinan[kunci] = nilai;
    });
    return salinan;
  });
}

/**
 * Impor JSON dokumen ke editor.
 *
 * Rujukan balasan yang menunjuk pesan yang tidak ada DIBUANG dan dilaporkan:
 * menyimpannya akan membuat pengiriman gagal di tengah rangkaian, dan admin
 * hanya melihat sebagian pesan muncul tanpa tahu sebabnya.
 */
function imporDokumen() {
  var kotak = document.getElementById('grupJson');
  var status = document.getElementById('grupJsonStatus');
  var teks = kotak ? String(kotak.value || '').trim() : '';
  if (!teks) return toast('Tempel JSON dokumen dulu', true);

  var data;
  try {
    data = JSON.parse(teks);
  } catch (error) {
    toast('JSON tidak valid: ' + error.message, true);
    return;
  }
  if (!data || !Array.isArray(data.messages)) {
    toast('JSON dokumen harus punya bagian "messages" berupa daftar', true);
    return;
  }
  if (data.format && data.format !== DOKUMEN_FORMAT.format) {
    toast('Berkas ini bukan ekspor dokumen multi-pesan', true);
    return;
  }

  var batas = 20;
  var dipakai = {};
  var pesanBaru = [];
  var dibuang = [];
  data.messages.slice(0, batas).forEach(function (satu, urutan) {
    if (!satu || typeof satu !== 'object') {
      dibuang.push('pesan ke-' + (urutan + 1) + ' bukan objek');
      return;
    }
    var id = String(satu.id || '').trim() || 'm' + (urutan + 1);
    if (dipakai[id]) {
      dibuang.push('id pesan "' + id + '" dipakai dua kali');
      return;
    }
    dipakai[id] = true;
    var baru = {
      id: id,
      name: String(satu.name || 'Pesan ' + (urutan + 1)).slice(0, 120),
      blocks: payloadBlokPesan({ blocks: Array.isArray(satu.blocks) ? satu.blocks : [] }),
    };
    if (satu.threadName) baru.threadName = String(satu.threadName).slice(0, 100);
    pesanBaru.push(baru);
  });

  // Rujukan diperiksa SETELAH semua id terkumpul, supaya balasan ke pesan
  // yang berada di bawahnya (urutan terbalik) tetap sah.
  data.messages.slice(0, batas).forEach(function (satu, urutan) {
    if (!satu || !satu.reference) return;
    var target = pesanBaru[urutan];
    if (!target) return;
    if (!dipakai[String(satu.reference)]) {
      dibuang.push('balasan pesan ' + (urutan + 1) + ' menunjuk pesan yang tidak ada');
      return;
    }
    if (String(satu.reference) === target.id) {
      dibuang.push('pesan ' + (urutan + 1) + ' membalas dirinya sendiri');
      return;
    }
    target.reference = String(satu.reference);
  });

  if (pesanBaru.length === 0) {
    toast('Tidak ada pesan yang bisa dipakai: ' + (dibuang[0] || 'isinya kosong'), true);
    return;
  }

  grupAktif = {
    id: null,
    name: String(data.name || '').slice(0, 120),
    series: data.series === true,
    messages: pesanBaru,
  };
  renderGrup();
  renderGrupTersimpan();
  var info = '✅ ' + pesanBaru.length + ' pesan dimuat — tekan Simpan untuk menyimpan sebagai dokumen baru';
  if (dibuang.length) info += '. ' + dibuang.length + ' bagian dibuang: ' + dibuang[0];
  if (status) status.textContent = info;
  toast(info);
}

/** Simpan dokumen (baru atau perbarui yang sedang dibuka). */
async function simpanGrup() {
  var nama = (document.getElementById('grupNama').value || '').trim();
  if (!nama) return toast('Nama dokumen wajib diisi', true);
  if (grupAktif.messages.length === 0) return toast('Dokumen belum punya pesan', true);
  var series = document.getElementById('grupSeries').checked;
  var status = document.getElementById('grupStatus');
  var tombol = document.getElementById('grupSimpan');
  if (tombol) tombol.disabled = true;
  try {
    var hasil = await apiMetode('/api/post-groups', {
      ...(grupAktif.id ? { id: grupAktif.id } : {}),
      name: nama,
      series: series,
      messages: grupAktif.messages
    }, 'POST');
    if (!hasil.ok) {
      toast(hasil.error || 'Gagal menyimpan dokumen', true);
      if (status) status.textContent = hasil.error || '';
      return;
    }
    /*
     * Balasan tanpa objek dokumen berarti server menerima permintaan tetapi
     * tidak mengembalikan dokumen (mis. versi server lebih lama). Dibedakan
     * dari kegagalan biasa supaya halaman tidak melempar, dan admin tahu
     * dokumennya mungkin tersimpan dengan bentuk yang tidak dikenal.
     */
    if (!hasil.document) {
      toast('Server tidak mengembalikan dokumen — periksa daftar dokumen tersimpan', true);
      return;
    }
    grupAktif = {
      id: hasil.document.id,
      name: hasil.document.name,
      series: hasil.document.series,
      messages: hasil.document.messages
    };
    DOKUMEN = DOKUMEN.filter(function (d) { return d.id !== grupAktif.id; });
    DOKUMEN.unshift(hasil.document);
    /*
     * Bagian yang dibuang server DITAMPILKAN, bukan hanya toast: pesan yang
     * hilang karena terlalu besar atau rujukan yang dilepas mengubah bentuk
     * rangkaian, dan admin harus bisa membacanya lagi.
     */
    var catatan = [];
    if (hasil.dropped && hasil.dropped.length) catatan.push('Dibuang: ' + hasil.dropped.join('; '));
    if (hasil.warnings && hasil.warnings.length) catatan.push('Catatan: ' + hasil.warnings.join('; '));
    if (status) status.textContent = catatan.join(' | ');
    toast('Dokumen tersimpan');
    renderGrup();
  } finally {
    if (tombol) tombol.disabled = false;
  }
}

/** Kirim dokumen tersimpan ke channel yang dipilih. */
async function kirimGrup() {
  if (!grupAktif.id) return toast('Simpan dokumennya dulu', true);
  var channelId = document.getElementById('grupChannel').value;
  if (!channelId) return toast('Pilih channel tujuan', true);
  var tombol = document.getElementById('grupKirim');
  var status = document.getElementById('grupStatus');
  if (tombol) tombol.disabled = true;
  try {
    var hasil = await apiMetode('/api/post-groups/' + grupAktif.id + '/send', { channelId: channelId }, 'POST');
    if (!hasil.ok && !hasil.sent) {
      toast(hasil.error || 'Gagal mengirim', true);
      if (status) status.textContent = hasil.error || '';
      return;
    }
    /*
     * Laporan dikirim apa adanya: kalau tiga dari lima pesan terkirim, admin
     * harus tahu yang mana yang gagal — bukan "berhasil" yang tidak benar.
     */
    var bagian = [(hasil.sent || []).length + ' pesan terkirim'];
    if (hasil.threads && hasil.threads.length) bagian.push(hasil.threads.length + ' thread dibuat');
    if (hasil.failed && hasil.failed.length) {
      bagian.push('gagal: ' + hasil.failed.map(function (f) { return f.name + ' (' + f.error + ')'; }).join('; '));
    }
    if (status) status.textContent = bagian.join(' | ');
    toast(hasil.failed && hasil.failed.length ? 'Sebagian pesan gagal — lihat catatan' : 'Terkirim', Boolean(hasil.failed && hasil.failed.length));
  } finally {
    if (tombol) tombol.disabled = false;
  }
}

/** Buka dokumen tersimpan ke editor. */
function bukaGrup(id) {
  var dok = DOKUMEN.filter(function (d) { return d.id === id; })[0];
  if (!dok) return toast('Dokumen tidak ada', true);
  grupAktif = {
    id: dok.id,
    name: dok.name,
    series: dok.series === true,
    messages: JSON.parse(JSON.stringify(dok.messages))
  };
  renderGrup();
  toast('Dokumen dibuka: ' + dok.name);
}

/** Hapus dokumen tersimpan. */
async function hapusGrup(id) {
  if (!(await askConfirm('Hapus dokumen?', 'Pesan yang sudah terkirim di Discord tidak ikut dihapus.', 'Hapus'))) return;
  var hasil = await apiMetode('/api/post-groups/' + id, undefined, 'DELETE');
  if (!hasil.ok) return toast(hasil.error || 'Gagal menghapus', true);
  DOKUMEN = DOKUMEN.filter(function (d) { return d.id !== id; });
  if (grupAktif.id === id) grupAktif = { id: null, name: '', series: false, messages: [] };
  renderGrup();
  toast('Dokumen dihapus');
}

/* ---------------- Jadwal kirim ---------------- */

/** Jadwal yang sedang disusun untuk pesan yang dibuka. */
var jadwalPesan = [];

/**
 * Muat jadwal milik pesan yang sedang dibuka.
 *
 * Sumbernya data yang dikirim server bersama daftar pesan, jadi tidak perlu
 * permintaan tambahan. Salinan dalam dipakai supaya batal menyimpan tidak
 * mengubah data asli sebelum ditekan "Simpan jadwal".
 */
function muatJadwal() {
  jadwalPesan = editingId ? JSON.parse(JSON.stringify(POST_SCHEDULES[editingId] || [])) : [];
  renderJadwal();
}

/** Gambar daftar jadwal yang sedang disusun. */
function renderJadwal() {
  var host = document.getElementById('scheduleList');
  if (!host) return;
  host.innerHTML = '';
  if (!editingId) {
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.margin = '0';
    hint.textContent = 'Simpan pesan dulu dan pilih channel tujuan sebelum menjadwalkan pengiriman.';
    host.appendChild(hint);
    return;
  }
  if (jadwalPesan.length === 0) {
    var kosong = document.createElement('p');
    kosong.className = 'hint';
    kosong.style.margin = '0';
    kosong.textContent = 'Belum ada jadwal.';
    host.appendChild(kosong);
    return;
  }
  jadwalPesan.forEach(function (jadwal, nomor) {
    var baris = document.createElement('div');
    baris.className = 'aksi-baris';

    var head = document.createElement('div');
    head.className = 'aksi-baris-head';
    var label = document.createElement('span');
    label.className = 'aksi-jenis';
    label.textContent =
      (nomor + 1) + '. ' + waktuLokal(jadwal.dueAt) +
      (jadwal.cron
        ? ' · kalender: ' + jadwal.cron + ' (' + jadwalCronRingkas(jadwal.cron) + ')'
        : jadwal.repeatMinutes > 0
          ? ' · ulang tiap ' + jamAksi(jadwal.repeatMinutes * 60)
          : ' · sekali') +
      (jadwal.lastSentAt ? ' · terakhir ' + waktuLokal(jadwal.lastSentAt) : '');
    head.appendChild(label);

    var hapus = document.createElement('button');
    hapus.className = 'btn-danger btn-sm btn-icon';
    hapus.type = 'button';
    hapus.title = 'Hapus jadwal';
    hapus.textContent = '×';
    hapus.onclick = function () {
      jadwalPesan.splice(nomor, 1);
      renderJadwal();
    };
    head.appendChild(hapus);
    baris.appendChild(head);
    host.appendChild(baris);
  });
}

/** Tambah satu jadwal dari isian di bawah daftar. */
function tambahJadwal() {
  if (!editingId) return toast('Simpan pesan dulu sebelum menjadwalkan', true);
  if (jadwalPesan.length >= 10) return toast('Maksimal 10 jadwal per pesan', true);
  var mode = (document.getElementById('scheduleMode') || {}).value || 'sekali';

  if (mode === 'kalender') {
    var ekspresi = String((document.getElementById('scheduleCron') || {}).value || '').trim();
    if (!ekspresi) return toast('Isi pola kalendernya, mis. 0 9 * * 1', true);
    /*
     * Diperiksa di browser juga, bukan hanya di server: salah ketik ruas cron
     * adalah hal yang paling sering terjadi, dan admin perlu tahu sebelum
     * menekan Simpan — bukan sesudah jadwalnya tidak muncul.
     */
    if (!cronValid(ekspresi)) {
      return toast('Pola cron tidak sah. Format: menit jam tanggal bulan hari (mis. 0 9 * * 1)', true);
    }
    // dueAt hanya penanda; server MENGHITUNG ulang waktu berikutnya dari
    // ekspresinya, jadi angka ini tidak bisa dipakai untuk memaksa jadwal.
    jadwalPesan.push({ dueAt: Date.now() + 60_000, repeatMinutes: 0, cron: ekspresi, lastSentAt: null });
    renderJadwal();
    return;
  }

  var due = waktuDariInput(document.getElementById('scheduleDue').value);
  if (!due) return toast('Isi waktu kirimnya dulu', true);
  if (due <= Date.now()) return toast('Waktu kirim harus di masa depan', true);
  var ulang = Number(document.getElementById('scheduleRepeat').value) || 0;
  jadwalPesan.push({ dueAt: due, repeatMinutes: ulang, lastSentAt: null });
  renderJadwal();
}

/**
 * Validasi cron di sisi browser.
 *
 * Sengaja RINGAN (lima ruas, angka 0-99 di ruas angka, nama hari/bulan
 * dikenal) dan tidak menyalin seluruh parser server: yang penting di sini
 * adalah menahan salah ketik bentuk, sedangkan keputusan akhir — termasuk
 * "terlalu rapat" dan "tanggal mustahil" — tetap di server yang punya parser
 * sungguhan. Menyalin parser penuh ke browser berarti dua sumber kebenaran.
 */
function cronValid(teks) {
  var ruas = String(teks || '').trim().toLowerCase().split(/\\s+/);
  if (ruas.length !== 5) return false;
  var namaHari = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var namaBulan = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var batas = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  for (var i = 0; i < 5; i++) {
    var potong = ruas[i].split(',');
    for (var j = 0; j < potong.length; j++) {
      var bagian = potong[j];
      if (!bagian) return false;
      if (bagian === '*') continue;
      var sisaLangkah = bagian.split('/');
      if (sisaLangkah.length > 2) return false;
      if (sisaLangkah.length === 2 && !/^\\d+$/.test(sisaLangkah[1])) return false;
      var dasar = sisaLangkah[0];
      if (dasar === '*') continue;
      var rentang = dasar.split('-');
      if (rentang.length > 2) return false;
      for (var k = 0; k < rentang.length; k++) {
        var nilai = rentang[k];
        if (/^\\d+$/.test(nilai)) {
          var angka = Number(nilai);
          if (angka < batas[i][0] || angka > batas[i][1]) return false;
        } else if (i === 3 && namaBulan.indexOf(nilai.slice(0, 3)) !== -1) {
          continue;
        } else if (i === 4 && namaHari.indexOf(nilai.slice(0, 3)) !== -1) {
          continue;
        } else {
          return false;
        }
      }
    }
  }
  return true;
}

/** Ringkasan pola cron dalam bahasa manusia (versi ringan untuk daftar). */
function jadwalCronRingkas(ekspresi) {
  var ruas = String(ekspresi || '').trim().split(/\\s+/);
  if (ruas.length !== 5) return ekspresi;
  var jam = (ruas[1] || '').length === 1 ? '0' + ruas[1] : ruas[1];
  var menit = (ruas[0] || '').length === 1 ? '0' + ruas[0] : ruas[0];
  var pukul = /^\\d+$/.test(jam) && /^\\d+$/.test(menit) ? ' pukul ' + jam + ':' + menit : '';
  if (ruas[2] === '*' && ruas[3] === '*' && ruas[4] === '*') return 'tiap hari' + pukul;
  if (ruas[2] === '*' && ruas[3] === '*' && ruas[4] !== '*') return 'tiap ' + namaHariCron(ruas[4]) + pukul;
  if (ruas[3] === '*' && ruas[4] === '*' && ruas[2] !== '*') return 'tiap tanggal ' + ruas[2] + pukul;
  return 'pola kalender';
}

function namaHariCron(ruas) {
  var nama = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  if (/^\\d+$/.test(ruas)) return nama[Number(ruas) % 7];
  var pendek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var posisi = pendek.indexOf(String(ruas).toLowerCase().slice(0, 3));
  return posisi === -1 ? ruas : nama[posisi];
}

/** Tampilkan isian yang sesuai dengan mode jadwal. */
function modeJadwal() {
  var mode = (document.getElementById('scheduleMode') || {}).value || 'sekali';
  var kalender = mode === 'kalender';
  var due = document.getElementById('scheduleDue');
  var ulang = document.getElementById('scheduleRepeat');
  var cron = document.getElementById('scheduleCron');
  var preset = document.getElementById('schedulePresetShell');
  if (due) due.hidden = kalender;
  if (ulang && ulang.parentNode) ulang.parentNode.hidden = kalender;
  if (cron) cron.hidden = !kalender;
  if (preset) preset.hidden = !kalender;
}

/** Isi isian cron dari pola siap pakai. */
function presetJadwal() {
  var nilai = (document.getElementById('schedulePreset') || {}).value || '';
  var cron = document.getElementById('scheduleCron');
  if (nilai && cron) cron.value = nilai;
}

/** Simpan daftar jadwal ke server. */
async function simpanJadwal() {
  if (!editingId) return toast('Simpan pesan dulu sebelum menjadwalkan', true);
  var status = document.getElementById('scheduleStatus');
  try {
    var hasil = await api('/api/posts/' + editingId + '/schedules', {
      method: 'PUT',
      body: JSON.stringify({ schedules: jadwalPesan }),
    });
    POST_SCHEDULES[editingId] = JSON.parse(JSON.stringify(hasil.schedules || []));
    muatJadwal();
    if (status) {
      status.textContent = hasil.dropped && hasil.dropped.length
        ? 'Sebagian jadwal dibuang: ' + hasil.dropped[0]
        : 'Jadwal disimpan.';
    }
    toast('Jadwal disimpan');
  } catch (e) {
    var pesan = (e && e.message) || 'Gagal menyimpan jadwal';
    if (status) status.textContent = pesan;
    toast(pesan, true);
  }
}

/** Apakah pesan yang dibuka punya jadwal (dipakai penanda di daftar). */
function jumlahJadwal(postId) {
  return (POST_SCHEDULES[postId] || []).length;
}

/* ---------------- Tab halaman ---------------- */

/**
 * Pindah tab halaman Pesan.
 *
 * Panel nonaktif hanya diberi hidden (bukan dilepas dari DOM), sama seperti
 * tab Sambutan: isian yang belum disimpan tetap ada, dan semua elemen yang
 * dibaca fungsi lain masih ditemukan.
 *
 * Satu hal yang WAJIB: pratinjau digambar ulang saat tab Pratinjau dibuka.
 * Alasannya bukan kemalasan — renderPreview menulis ke dua host, tetapi
 * elemen di tab tersembunyi tidak punya ukuran di browser. Menggambar ulang
 * saat tab terlihat memastikan gambarnya pas, bukan sisa dari keadaan lama.
 */
function showPesanTab(key) {
  var kunci = ['susun', 'pratinjau', 'role', 'impor', 'grup'];
  for (var i = 0; i < kunci.length; i++) {
    var nama = kunci[i];
    var aktif = nama === key;
    var pane = document.getElementById('pane-' + nama);
    var tab = document.getElementById('tab-' + nama);
    if (pane) pane.hidden = !aktif;
    if (tab) {
      tab.classList.toggle('is-active', aktif);
      tab.setAttribute('aria-selected', aktif ? 'true' : 'false');
    }
  }
  if (key === 'pratinjau') renderPreview();
  // Tab riwayat memakai data yang sudah dimuat bersama halaman; permintaan
  // baru baru dilakukan lewat tombol "Muat ulang riwayat".
  if (key === 'riwayat') {
    if (editingId && !RIWAYAT[editingId] && RIWAYAT_AWAL[editingId]) RIWAYAT[editingId] = RIWAYAT_AWAL[editingId];
    renderRiwayat();
  }
  // Tab terakhir disimpan supaya tidak balik ke Susun setelah menyimpan.
  try { localStorage.setItem('zypher.tab.pesan', key); } catch (e) {}
}

/** Buka tab dari ?tab=… (mis. setelah menyimpan) atau dari localStorage. */
(function bukaTabAwal() {
  var dariUrl = new URLSearchParams(location.search).get('tab');
  var tersimpan = null;
  try { tersimpan = localStorage.getItem('zypher.tab.pesan'); } catch (e) {}
  var kunci = dariUrl || tersimpan;
  if (kunci && ['susun', 'pratinjau', 'role', 'impor', 'grup', 'riwayat'].indexOf(kunci) !== -1) showPesanTab(kunci);
})();

loadExisting();
renderBlocks();
renderEmbedExtra();
renderTarget();
renderRoleButtons();
renderGrup();
muatJadwal();
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
