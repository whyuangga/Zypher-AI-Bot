import type { PostBlock } from './custom-post.js';
import { embedKeExtra, gabungGaleriEmbeds, parseMessageLink, v2ToBlocks } from './discohook-import.js';
import { sanitizeEmbedList, type EmbedExtra } from './post-embed.js';

/**
 * Muat pesan yang SUDAH ada di Discord menjadi blok `/pesan`.
 *
 * Padanan tombol "Load" di Discohook: tempel tautan pesan, lalu pesannya bisa
 * disunting dan dikirim ulang. Tanpa ini, satu-satunya cara memperbaiki pesan
 * lama adalah menyusun ulang dari nol — dan hasilnya tidak akan sama.
 *
 * Modul ini murni: tidak menyentuh discord.js maupun database. Pemanggil
 * mengambil pesannya (jaringan) lalu menyerahkan bentuk mentahnya ke sini.
 *
 * Kenapa tidak memakai `v2ToBlocks` saja: pesan di Discord bisa berisi
 * `content` biasa, satu sampai sepuluh embed, lampiran, dan komponen V2
 * sekaligus. Masing-masing punya aturan sendiri, dan Discord MENOLAK V2
 * bersama `content`/`embeds` — jadi urutan penerjemahannya harus diputuskan di
 * satu tempat.
 */

/** Bentuk mentah pesan Discord yang dibutuhkan (subset yang dipakai). */
export interface LoadedMessage {
  content?: unknown;
  embeds?: unknown[];
  components?: unknown[];
  attachments?: unknown[];
  /** Nama tampilan & avatar pengirim, kalau pesan dikirim lewat webhook. */
  author?: { username?: unknown; bot?: unknown; avatarUrl?: unknown };
  webhookId?: unknown;
  /** Flag pesan Discord (bitmask). 4 = tanpa kartu tautan, 4096 = tanpa notifikasi. */
  flags?: unknown;
  /** Thread yang DIMULAI pesan ini, kalau ada. */
  thread?: { name?: unknown };
  /** ID pesan, dipakai untuk memberi tahu apa yang dimuat. */
  id?: unknown;
}

export interface LoadResult {
  blocks: PostBlock[];
  embed: EmbedExtra[];
  layout: 'container' | 'embed';
  /** Bagian yang tidak bisa dibawa, dalam bahasa manusia. */
  warnings: string[];
  /** Isi teks pesan asli (dipakai sebagai nama pesan kalau ada). */
  content: string;
  /*
   * Pengaturan tingkat pesan. Tanpa ini, memuat pesan lalu mengirim ulang
   * menghapus identitas webhook, nama thread, dan flag-nya: pesan yang tampak
   * sama di editor muncul berbeda di Discord.
   */
  /** `webhook` kalau pesan aslinya dikirim lewat webhook. */
  sender: 'bot' | 'webhook';
  /** Nama & avatar pengirim webhook asli (kosong kalau bukan webhook). */
  webhookName: string;
  webhookAvatar: string;
  /** Nama thread yang dimulai pesan asli. */
  threadName: string;
  /** Flag yang boleh diatur admin (4 dan 4096 saja). */
  flags: number;
}

/** Flag Discord yang boleh diatur dari dashboard. */
const FLAG_TAUTAN = 4;
const FLAG_TANPA_NOTIF = 4096;

/** Batas teks satu blok, sama seperti penyusun payload. */
const MAX_BLOK = 3500;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Pecah teks panjang jadi beberapa blok.
 *
 * Discord membatasi 2000 karakter per pesan, sedangkan satu blok teks bisa
 * lebih panjang di dashboard. Memotong di tengah kata lebih buruk daripada
 * memecah di baris baru; kalau tidak ada baris baru sama sekali, potong paksa.
 */
export function pecahTeks(teks: string, batas = MAX_BLOK): string[] {
  const isi = teks.trim();
  if (!isi) return [];
  if (isi.length <= batas) return [isi];
  const hasil: string[] = [];
  let sisa = isi;
  while (sisa.length > batas) {
    const potongBaris = sisa.lastIndexOf('\n', batas);
    const potong = potongBaris > batas * 0.5 ? potongBaris : batas;
    hasil.push(sisa.slice(0, potong).trimEnd());
    sisa = sisa.slice(potong).trimStart();
  }
  if (sisa) hasil.push(sisa);
  return hasil;
}

/**
 * Terjemahkan pesan Discord yang dimuat menjadi isi editor.
 *
 * Urutan keputusan:
 *   1. Ada komponen V2? → semua jadi blok; embed diterjemahkan jadi kartu teks
 *      karena Discord melarang keduanya sekaligus (dengan peringatan).
 *   2. Hanya embed? → bentuk pesan = embed, embed dipertahankan apa adanya.
 *   3. Hanya teks? → satu blok teks.
 *
 * Tidak ada yang dibuang diam-diam: setiap bagian yang tidak bisa dibawa
 * menghasilkan satu baris `warnings`.
 */
export function messageToDraft(pesan: LoadedMessage): LoadResult {
  const warnings: string[] = [];
  const blocks: PostBlock[] = [];
  const content = asString(pesan.content).trim();
  const komponen = asArray(pesan.components);
  const embeds = asArray(pesan.embeds).map((satu) =>
    satu && typeof satu === 'object' && !Array.isArray(satu) ? (satu as Record<string, unknown>) : null,
  ).filter((satu): satu is Record<string, unknown> => satu !== null);

  /*
   * Lampiran dilaporkan, tidak diimpor: berkasnya hidup di CDN Discord dan
   * tautannya kedaluwarsa. Admin perlu tahu bagian ini harus diunggah ulang.
   */
  const lampiran = asArray(pesan.attachments).length;
  if (lampiran > 0) {
    warnings.push(
      `${lampiran} lampiran tidak ikut dimuat — tautan berkas Discord kedaluwarsa, unggah ulang berkasnya`,
    );
  }

  if (komponen.length > 0) {
    if (content) {
      warnings.push(
        'Teks biasa pesan diletakkan di atas komponen — Discord tidak mengizinkan keduanya sekaligus',
      );
      blocks.push({ kind: 'text', value: content.slice(0, MAX_BLOK) });
    }
    const hasil = v2ToBlocks(komponen);
    blocks.push(...hasil.blocks);
    warnings.push(...hasil.warnings);

    if (embeds.length > 0) {
      warnings.push(
        'Pesan ini memuat embed DAN komponen — embed diterjemahkan menjadi kartu teks karena Discord menolak keduanya sekaligus',
      );
      for (const raw of embeds) {
        const kartu = embedToCard(raw);
        blocks.push(...kartu.blocks);
        warnings.push(...kartu.warnings);
      }
    }

    return { blocks, embed: [], layout: 'container', warnings, content, ...pengaturanPesan(pesan) };
  }

  if (embeds.length > 0) {
    /*
     * Galeri di Discord tampil sebagai beberapa embed yang hanya berisi gambar.
     * Saat dimuat kembali, bentuk itu dibaca ulang sebagai SATU galeri supaya
     * menyuntingnya lagi tidak memaksa admin menempel empat URL dari nol.
     */
    const padat = gabungGaleriEmbeds(embeds);
    const { list, dropped } = sanitizeEmbedList(padat.map(embedKeExtra));
    warnings.push(...dropped);

    /*
     * Embed pertama memakai jalur yang sama dengan impor Discohook: judul jadi
     * nama pesan (dikembalikan lewat `content`), isi jadi blok teks, gambar
     * jadi blok gambar. Sisanya hanya bagian admin.
     */
    const judul = asString(embeds[0]?.title).trim();
    const isiUtama = asString(embeds[0]?.description).trim();
    if (isiUtama) blocks.push(...pecahTeks(isiUtama).map((satu) => ({ kind: 'text' as const, value: satu })));
    const gambarUtama = asString((embeds[0]?.image as Record<string, unknown> | undefined)?.url).trim();
    if (/^https?:\/\//i.test(gambarUtama)) blocks.push({ kind: 'image', value: gambarUtama });

    for (let i = 1; i < embeds.length; i += 1) {
      const isiTambahan = asString(embeds[i]?.description).trim();
      if (!isiTambahan) continue;
      /*
       * Isi embed kedua dan seterusnya tidak punya tempat di model bot (embed
       * tambahan hanya berisi bagian admin). Menaruhnya sebagai blok teks akan
       * tampil di dalam pesan, jadi dipindahkan SEKALI di akhir dan diberi
       * keterangan — lebih baik terlihat daripada hilang.
       */
      blocks.push({ kind: 'text', value: `-# isi embed ${i + 1}: ${isiTambahan.slice(0, MAX_BLOK - 40)}` });
      warnings.push(
        `embed ${i + 1}: isi dipindahkan menjadi blok teks bertanda (hanya embed pertama yang memuat isi)`,
      );
    }

    return {
      blocks,
      embed: list,
      layout: list.length ? 'embed' : 'container',
      warnings,
      content: judul || content,
      ...pengaturanPesan(pesan),
    };
  }

  if (content) {
    blocks.push(...pecahTeks(content).map((satu) => ({ kind: 'text' as const, value: satu })));
    return { blocks, embed: [], layout: 'container', warnings, content, ...pengaturanPesan(pesan) };
  }

  warnings.push('Pesan itu tidak punya teks, komponen, maupun embed — tidak ada yang bisa dimuat');
  return {
    blocks: [],
    embed: [],
    layout: 'container',
    warnings,
    content: '',
    ...pengaturanPesan(pesan),
  };
}

/**
 * Pengaturan tingkat pesan dari pesan Discord yang dimuat.
 *
 * Dipisah supaya tiga jalur keluar (embed, komponen, teks biasa) memakai
 * aturan yang sama — kalau tiap cabang mengisinya sendiri, salah satu cabang
 * pasti tertinggal.
 */
function pengaturanPesan(pesan: LoadedMessage): {
  sender: 'bot' | 'webhook';
  webhookName: string;
  webhookAvatar: string;
  threadName: string;
  flags: number;
} {
  /*
   * Hanya `webhook_id` yang menandai pesan webhook. `author.username` TIDAK
   * bisa dipakai: pesan bot biasa juga punya username, dan menganggapnya
   * webhook akan membuat pesan bot disunting jadi terkirim atas nama webhook.
   */
  const lewatWebhook = Boolean(pesan.webhookId);
  /*
   * Flag disaring ke dua bit yang boleh diatur dashboard. Flag lain (mis.
   * `IS_COMPONENTS_V2` atau `IS_VOICE_MESSAGE`) diurus pengirim; membawanya
   * ke editor akan membuat pesan berikutnya ditolak Discord.
   */
  const mentah = typeof pesan.flags === 'number' && Number.isFinite(pesan.flags) ? pesan.flags : 0;
  return {
    sender: lewatWebhook ? 'webhook' : 'bot',
    /*
     * Nama & avatar hanya dibawa kalau pesannya memang dari webhook: pesan bot
     * biasa punya username bot, dan mengisinya akan membuat pesan berikutnya
     * dikirim dengan nama bot sebagai "pengirim webhook".
     */
    webhookName: lewatWebhook ? asString(pesan.author?.username).trim().slice(0, 80) : '',
    webhookAvatar: lewatWebhook ? asString(pesan.author?.avatarUrl).trim().slice(0, 2048) : '',
    threadName: asString(pesan.thread?.name).trim().slice(0, 100),
    flags: mentah & (FLAG_TAUTAN | FLAG_TANPA_NOTIF),
  };
}

/**
 * Embed mentah → blok kartu teks (jalur "tidak bisa dua-duanya").
 *
 * Dipakai hanya saat pesan membawa komponen V2: embed tidak bisa dikirim
 * bersama komponen, jadi isinya dipindahkan ke kartu. Penulis, footer, dan
 * bidang ikut supaya tidak ada informasi yang hilang.
 */
function embedToCard(raw: Record<string, unknown>): { blocks: PostBlock[]; warnings: string[] } {
  const blocks: PostBlock[] = [];
  const warnings: string[] = [];

  const angka = typeof raw.color === 'number' ? raw.color : null;
  const accent =
    angka !== null && angka >= 0 && angka <= 0xffffff
      ? `#${Math.trunc(angka).toString(16).padStart(6, '0')}`
      : '';
  blocks.push({ kind: 'container', value: '', ...(accent ? { accent } : {}) } as PostBlock);

  const penulis = asString((raw.author as Record<string, unknown> | undefined)?.name).trim();
  if (penulis) blocks.push({ kind: 'text', value: `**${penulis}**` });
  const judul = asString(raw.title).trim();
  if (judul) blocks.push({ kind: 'text', value: `### ${judul}` });
  for (const satu of pecahTeks(asString(raw.description))) {
    blocks.push({ kind: 'text', value: satu });
  }
  for (const field of asArray(raw.fields)) {
    const isi = field && typeof field === 'object' ? (field as Record<string, unknown>) : null;
    if (!isi) continue;
    const nama = asString(isi.name).trim();
    const nilai = asString(isi.value).trim();
    if (!nama && !nilai) continue;
    blocks.push({ kind: 'text', value: `**${nama || '-'}**${nilai ? `\n${nilai}` : ''}` });
  }
  const gambar = asString((raw.image as Record<string, unknown> | undefined)?.url).trim();
  if (/^https?:\/\//i.test(gambar)) blocks.push({ kind: 'image', value: gambar });
  const footer = asString((raw.footer as Record<string, unknown> | undefined)?.text).trim();
  if (footer) blocks.push({ kind: 'text', value: `-# ${footer}` });
  blocks.push({ kind: 'close', value: '' });

  return { blocks, warnings };
}

/** Tautan pesan → tiga ID, atau null. Diteruskan supaya pemanggil tak perlu dua modul. */
export { parseMessageLink };
