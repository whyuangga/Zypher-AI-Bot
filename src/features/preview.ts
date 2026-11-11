/**
 * Pratinjau / demo fitur "kehadiran" tanpa membutuhkan Discord.
 *
 * Masalah yang dipecahkan: admin menyalakan sambutan atau AI Agent, lalu
 * menunggu member baru bergabung untuk tahu apakah hasilnya bagus. Itu lambat
 * dan tidak bisa diulang. Di sini teks sapaan/kata perpisahan/balasan agent
 * dibuat **persis dengan fungsi yang dipakai bot sungguhan** — prompt, gaya,
 * dan aturan panjangnya sama — hanya sumber datanya yang berbeda:
 *
 *   - nama member → nama contoh yang diketik admin (atau nama admin sendiri),
 *   - isi pesan member → teks contoh yang diketik admin,
 *   - pengaturan → nilai yang sedang tampil di form (belum tentu tersimpan),
 *     jadi admin bisa mencoba gaya lain tanpa menekan Simpan dulu.
 *
 * Hasilnya selalu berisi `source` supaya dashboard bisa jujur menulis
 * "ditulis AI" atau "dari template (AI mati / gagal)" — bukan pura-pura sukses.
 *
 * Modul ini sengaja tidak mengimpor discord.js supaya bisa dipanggil dari
 * server web tanpa membawa Client Discord.
 */
import type { AgentSettings, GoodbyeSettings, WelcomeSettings } from '../db/repo.js';
import { config } from '../config.js';
import type { ContainerMock, EmbedMock } from './embed-mock.js';
import { chat, type ChatMessage } from '../lib/llm.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { clockInZone, partOfDayInZone, timeZoneLabel } from '../lib/timezone.js';
import {
  MEMORY_TURNS,
  QUIET_MAX_CHARS,
  QUIET_SYSTEM_PROMPT,
  buildAntiRepeatBlock,
  channelRole,
  isQuietHour,
  pickQuietAngle,
  shouldBreakSilence,
  type AgentState,
  type MemoryTurn,
} from './agent-core.js';
import { DEFAULT_GOODBYE_TEMPLATE, DEFAULT_WELCOME_TEMPLATE, fillText } from './greeting-text.js';
import { composePayload } from './welcome.js';
import { containerToMock, embedToMock } from './embed-mock.js';
import { normalizeDisplayMode, type DisplayMode } from './display-mode.js';

/** Nama contoh kalau admin tidak mengetik nama apa pun. */
export const SAMPLE_MEMBER_NAME = 'Sky';

/** Data member tiruan — bentuk minimal yang dibutuhkan prompt. */
export interface PreviewMember {
  name: string;
  guildName: string;
}

export interface PreviewResult {
  text: string;
  /** 'ai' = ditulis model, 'template' = teks cadangan, 'error' = AI gagal total. */
  source: 'ai' | 'template' | 'error';
  /** Catatan singkat untuk ditampilkan di dashboard (mis. alasan fallback). */
  note: string | null;
  /** true kalau kartu PNG berhasil dirender (hanya sambutan). */
  card?: boolean;
  /** Ukuran kartu dalam byte, untuk memastikan benar-benar tergambar. */
  cardBytes?: number;
  /** Kartu siap ditampilkan di <img> — hanya diisi saat pratinjau dashboard. */
  cardDataUri?: string;
  /**
   * Bentuk embed yang akan dikirim — supaya dashboard bisa menggambar
   * pratinjaunya, bukan hanya menampilkan kalimat sapaan.
   *
   * `null` = mode ini tidak memakai embed (card/text/container), atau embed
   * tidak bisa dibangun.
   */
  embedMock?: EmbedMock | null;
  /** Bentuk kartu Components V2, kalau mode yang dipakai `container`. */
  containerMock?: ContainerMock | null;
  /**
   * Teks `content` yang menyertai pesan (mention + teks pada mode card/text).
   * Ditampilkan terpisah di pratinjau karena di Discord ia muncul DI ATAS
   * embed — dan itu satu-satunya alasan mention bisa memicu notifikasi.
   */
  contentText?: string | null;
  /** Mode yang benar-benar dipakai (bisa berbeda dari setelan karena fallback). */
  mode?: string | null;
}

/**
 * Jam lokal server untuk menentukan pagi/siang/malam.
 *
 * `timeZone` = zona server (WIB/WITA/WIT). Tanpa argumen, memakai
 * `TIMEZONE` dari .env (cadangan untuk pemanggil lama).
 */
export function partOfDay(now = new Date(), timeZone?: string | null): string {
  return partOfDayInZone(now, timeZone ?? config.features.timeZone);
}

/* ------------------------------------------------------------------ */
/*  Sambutan                                                           */
/* ------------------------------------------------------------------ */

/**
 * Instruksi gaya untuk model sambutan — **satu-satunya** sumber prompt.
 *
 * `welcome.ts` memanggil fungsi ini juga, jadi pratinjau di dashboard tidak
 * mungkin menyimpang dari sapaan yang benar-benar dikirim bot.
 */
export function buildWelcomePrompt(settings: WelcomeSettings, member: PreviewMember, when: string): string {
  const name = member.name;
  return [
    'Kamu anggota komunitas yang ramah, bukan asisten dan bukan bot pengumuman.',
    `Tulis SATU sapaan untuk member baru bernama "${name}" yang baru saja bergabung di server "${member.guildName}".`,
    `Waktu saat ini: ${when}. Sebut waktu itu kalau terasa pas.`,
    `Gaya: ${settings.style?.trim() || 'hangat, santai, seperti orang sungguhan menyapa'}.`,
    settings.example?.trim() ? `Contoh nada yang ingin ditiru (jangan disalin): "${settings.example.trim()}"` : '',
    'Aturan:',
    '- Maksimal 2 kalimat pendek, tidak lebih dari 220 karakter.',
    '- Sapa pakai nama panggilannya, jangan pakai kata "member" atau "user".',
    '- Jangan memakai pembuka khas AI: "Halo! Selamat datang", "Hai, aku bot", "Semoga betul-betul".',
    '- Jangan membuat janji, tautan, atau menyebut aturan server.',
    '- Boleh menyebut satu hal ringan untuk memulai obrolan (mis. tanya lagi ngapain).',
    'Balas HANYA dengan teks sapaannya.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Instruksi gaya untuk model salam perpisahan. */
export function buildGoodbyePrompt(settings: GoodbyeSettings, member: PreviewMember): string {
  return [
    'Kamu anggota komunitas yang santai.',
    `Tulis SATU salam perpisahan singkat untuk "${member.name}" yang baru saja keluar dari server "${member.guildName}".`,
    `Gaya: ${settings.style?.trim() || 'sopan, hangat, tanpa berlebihan'}.`,
    settings.example?.trim() ? `Contoh nada yang ingin ditiru (jangan disalin): "${settings.example.trim()}"` : '',
    'Aturan:',
    '- Maksimal 1–2 kalimat pendek, tidak lebih dari 180 karakter.',
    '- Jangan menanyakan alasan keluar, jangan menyindir, jangan menyebut aturan server.',
    '- Jangan memakai kata "member" atau "user".',
    '- Boleh mendoakan hal baik secara umum.',
    'Balas HANYA dengan teks salamnya.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Bersihkan keluaran model: buang tanda kutip pembungkus & spasi lebih. */
function cleanReply(raw: string | null | undefined, maxChars: number): string | null {
  const text = (raw ?? '').trim().replace(/^["'“”]|["'“”]$/g, '').trim();
  return text ? truncate(text, maxChars) : null;
}

/**
 * Penyebab paling umum jawaban kosong, dengan saran yang bisa langsung dicoba.
 *
 * Model populer sekarang banyak yang "reasoning" (gpt-oss, DeepSeek-R1, QwQ):
 * jawabannya masuk ke `reasoning_content`/`thinking`, sedangkan `content` bisa
 * kosong kalau jatah token habis untuk proses berpikir. Tanpa penjelasan ini,
 * admin hanya melihat "teks kosong" dan tidak tahu harus berbuat apa.
 */
export const EMPTY_REPLY_HINT =
  'Model mengembalikan jawaban kosong. Biasanya karena model reasoning kehabisan jatah token ' +
  'sebelum menulis jawaban. Coba naikkan AI_MAX_TOKENS (mis. 1500) atau ganti AI_MODEL ke model ' +
  'non-reasoning, lalu tes lagi.';

export interface AskResult {
  text: string | null;
  /** Alasan kegagalan yang siap ditampilkan ke admin. */
  error: string | null;
  /** true = model menjawab tapi isinya kosong (bukan error jaringan/kuota). */
  empty: boolean;
}

async function askModel(
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  label: string,
): Promise<AskResult> {
  try {
    const result = await chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      maxTokens,
    });

    // Sebagian provider menaruh jawaban di field lain saat mode reasoning.
    const raw = result.message as unknown as {
      content?: string | null;
      reasoning_content?: string | null;
    };
    const content = raw.content?.trim();
    const reasoning = raw.reasoning_content?.trim();
    const picked = content || reasoning || null;
    const text = cleanReply(picked, maxTokens >= 200 ? 260 : 220);

    if (!text) {
      logger.warn(`Pratinjau ${label}: model (${result.provider}/${result.model}) mengembalikan teks kosong.`);
      return { text: null, error: EMPTY_REPLY_HINT, empty: true };
    }
    return { text, error: null, empty: false };
  } catch (error) {
    logger.warn(`Pratinjau ${label} gagal memanggil model`, errorMessage(error));
    return { text: null, error: `AI gagal: ${errorMessage(error)}`, empty: false };
  }
}

export interface WelcomePreviewOptions {
  settings: WelcomeSettings;
  name: string;
  guildName: string;
  /** Paksa jalur template walau `useAi` menyala (tombol "tanpa AI"). */
  templateOnly?: boolean;
  /** Render kartu PNG juga — memakan waktu, jadi opsional. */
  withCard?: boolean;
  /** Pemanggil menyediakan renderer supaya modul ini tidak bergantung paket gambar. */
  renderCard?: (input: {
    name: string;
    text: string;
    guildName: string;
    bannerDataUri?: string | null;
    kicker?: string;
  }) => Promise<Buffer | null>;
  /** Banner unggahan admin (data URI) untuk ikut dirender di kartu. */
  bannerDataUri?: string | null;
  /** Zona waktu server (WIB/WITA/WIT) untuk menentukan pagi/siang/sore. */
  timeZone?: string | null;
  /** Judul kecil di kartu: "SELAMAT DATANG" atau "SAMPAI JUMPA". */
  kicker?: string;
  /**
   * Data member tiruan untuk membangun bentuk pesan.
   *
   * Tidak wajib: tanpa ini pratinjau tetap menghasilkan teks & kartu seperti
   * dulu, hanya tanpa mock embed/container. Dashboard selalu mengirimnya.
   */
  member?: PreviewMemberLike;
}

/**
 * Bagian dari `GuildMember` yang dipakai `composePayload()`.
 *
 * Ditulis sebagai tipe minimal, bukan `GuildMember`, supaya modul pratinjau
 * tidak butuh Discord client — dan supaya test bisa memakai objek biasa.
 */
export interface PreviewMemberLike {
  id: string;
  displayName?: string;
  /**
   * `displayName` ikut ditulis di sini karena discord.js punya keduanya, dan
   * objek tiruan dari server mengisi keduanya. `composePayload()` memakai
   * guild.members.me untuk displayName hanya pada objek asli; pada objek
   * tiruan ia jatuh ke `user.displayName`.
   */
  user?: { username?: string; displayName?: string; tag?: string };
  guild?: { name?: string; memberCount?: number };
  displayAvatarURL?: (options?: { extension?: string; size?: number }) => string;
}

/**
 * Member tiruan untuk pratinjau.
 *
 * Dipakai kalau pemanggil tidak mengirim `member` (mis. test lama). Bentuknya
 * sengaja minimal: yang dibutuhkan `composePayload()` hanya id, nama, jumlah
 * member, dan URL avatar.
 *
 * `displayAvatarURL` mengembalikan string kosong, BUKAN avatar contoh dari
 * internet: pratinjau tidak boleh bergantung pada jaringan, dan gambar yang
 * gagal dimuat hanya tampil sebagai kotak rusak di halaman.
 */
export function previewMember(name: string, guildName: string): PreviewMemberLike {
  return {
    id: '0',
    displayName: name,
    user: { username: name },
    guild: { name: guildName, memberCount: 0 },
    displayAvatarURL: () => '',
  };
}

/**
 * Bangun bentuk pesan (embed/container/content) untuk pratinjau.
 *
 * Memakai `composePayload()` — fungsi yang SAMA dengan sambutan sungguhan.
 * Itu inti perbaikannya: pratinjau tidak boleh punya aturan sendiri, karena
 * setiap aturan yang ditulis ulang di sini akan melenceng dari produksi
 * (persis seperti pesan uji yang dulu kehilangan avatar).
 *
 * Tidak ada pengiriman: `member` di sini objek tiruan tanpa channel, dan
 * `allowed.attach` false supaya tidak ada file yang dibaca dari disk.
 */
async function shapePreview(options: {
  mode: DisplayMode;
  text: string;
  member: PreviewMemberLike;
  kind: 'welcome' | 'goodbye';
  settings: { bannerPath: string | null; bannerData: { mime: string; base64: string } | null; embedAvatar: boolean; embedAuthor: boolean; cardAvatar: boolean };
  /** Data URI banner: hanya untuk mock, tidak pernah dikirim. */
  bannerDataUri?: string | null;
  /** Nama member yang dipakai kalau objek member tidak punya displayName. */
  name: string;
}): Promise<{ contentText: string; embedMock: EmbedMock | null; containerMock: ContainerMock | null }> {
  // Avatar: pratinjau memakai URL apa adanya (tidak ada file untuk diunggah).
  const avatarUrl =
    options.settings.embedAvatar || options.settings.embedAuthor
      ? options.member.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? null
      : null;

  try {
    const payload = await composePayload({
      mode: options.mode,
      text: options.text,
      member: options.member as never,
      kind: options.kind,
      channelName: null,
      attachment: null,
      includeAvatar: options.settings.cardAvatar,
      embedAvatar: options.settings.embedAvatar,
      embedAuthor: options.settings.embedAuthor,
      // Banner tidak dibaca dari disk di sini: `allowed.attach` false membuat
      // readBannerAttachment() tidak dipanggil sama sekali.
      bannerPath: null,
      bannerData: options.settings.bannerData,
      allowed: { embed: true, attach: false },
      // Mention di pratinjau selalu ditampilkan: admin perlu melihat bahwa
      // mention memang ikut di `content`, di luar embed.
      mentionUser: true,
      // Avatar di container: pratinjau memakai URL, bukan lampiran.
      containerAvatarUrl: options.mode === 'container' ? avatarUrl : null,
    });

    const embedMock = payload.embeds[0] ? embedToMock(payload.embeds[0]) : null;
    const containerMock = payload.components?.[0] ? containerToMock(payload.components[0]) : null;

    // Banner disuntikkan sesudah bentuknya dibaca: `attachment://x.png` diganti
    // data URI banner supaya gambar benar-benar terlihat di browser.
    if (embedMock && options.bannerDataUri) {
      embedMock.imageUrl = options.bannerDataUri;
    }
    if (containerMock && options.bannerDataUri) {
      // Media Gallery kontainer hanya berisi avatar (kalau ada); banner asli
      // masuk ke daftar gambar supaya terlihat di bawah teks.
      containerMock.imageUrls.push(options.bannerDataUri);
    }

    return { contentText: payload.content, embedMock, containerMock };
  } catch (error) {
    // Pratinjau tidak boleh gagal total hanya karena mock-nya bermasalah:
    // teks sapaan sudah dihitung dan tetap berguna.
    logger.warn('Gagal membangun bentuk pratinjau', errorMessage(error));
    return { contentText: '', embedMock: null, containerMock: null };
  }
}

/** Hasil sambutan seperti yang akan diterima member — tanpa mengirim apa pun. */
export async function previewWelcome(options: WelcomePreviewOptions): Promise<PreviewResult> {
  const { settings, name, guildName } = options;
  const template = settings.template?.trim() || DEFAULT_WELCOME_TEMPLATE;

  let text: string | null = null;
  let note: string | null = null;

  if (settings.useAi && !options.templateOnly) {
    const result = await askModel(
      'Kamu menulis satu sapaan singkat. Balas hanya teks sapaannya.',
      buildWelcomePrompt(settings, { name, guildName }, partOfDay(new Date(), options.timeZone)),
      0.9,
      config.ai.brevityTokens,
      'sambutan',
    );
    text = result.text;
    if (!text) note = result.error;
  } else {
    note = settings.useAi ? 'Mode template dipaksa.' : 'AI dimatikan di pengaturan.';
  }

  const source: PreviewResult['source'] = text ? 'ai' : 'template';
  const finalText = text ?? fillText(template, previewValues(name, guildName));

  const result: PreviewResult = { text: finalText, source, note: text ? null : note };

  if (options.withCard && options.renderCard) {
    try {
      const buffer = await options.renderCard({
        name,
        text: finalText,
        guildName,
        bannerDataUri: options.bannerDataUri ?? null,
        // Default di sini, bukan di pemanggil: dulu dashboard mengandalkan
        // server mengirim judul, dan lupa bahwa itu opsional.
        kicker: options.kicker ?? 'SELAMAT DATANG',
      });
      result.card = Boolean(buffer);
      result.cardBytes = buffer?.byteLength ?? 0;
      result.cardDataUri = buffer ? `data:image/png;base64,${buffer.toString('base64')}` : undefined;
      if (!buffer) {
        result.note = mergeNote(result.note, 'Kartu PNG tidak bisa dirender — embed teks dipakai.');
      }
    } catch (error) {
      logger.warn('Gagal merender kartu pada pratinjau', errorMessage(error));
      result.card = false;
      result.cardBytes = 0;
      result.note = mergeNote(result.note, `Kartu gagal dirender: ${errorMessage(error)}`);
    }
  }

  // Bentuk pesan dibangun SESUDAH teksnya pasti, memakai `composePayload()` —
  // fungsi yang sama dengan sambutan sungguhan. Jadi pratinjau tidak bisa
  // "lebih rapi" atau "lebih lengkap" daripada yang benar-benar dikirim bot.
  const previewMode = normalizeDisplayMode(settings.displayMode);
  result.mode = previewMode;
  const shaped = await shapePreview({
    mode: previewMode,
    text: finalText,
    member: options.member ?? previewMember(name, guildName),
    kind: 'welcome',
    settings,
    bannerDataUri: options.bannerDataUri ?? null,
    name,
  });
  result.contentText = shaped.contentText;
  result.embedMock = shaped.embedMock;
  result.containerMock = shaped.containerMock;

  return result;
}

export interface PreviewGoodbyeOptions {
  settings: GoodbyeSettings;
  name: string;
  guildName: string;
  /** Paksa jalur template walau `useAi` menyala (tombol "tanpa AI"). */
  templateOnly?: boolean;
  /** Render kartu PNG juga — memakan waktu, jadi opsional. */
  withCard?: boolean;
  /** Renderer disuntikkan supaya modul ini tidak bergantung paket gambar. */
  renderCard?: (input: {
    name: string;
    text: string;
    guildName: string;
    bannerDataUri?: string | null;
    kicker?: string;
  }) => Promise<Buffer | null>;
  /** Banner unggahan admin (data URI) untuk ikut dirender di kartu. */
  bannerDataUri?: string | null;
  /** Judul kecil di kartu. */
  kicker?: string;
  /** Data member tiruan untuk membangun bentuk pesan — lihat `WelcomePreviewOptions`. */
  member?: PreviewMemberLike;
}

/** Hasil salam perpisahan seperti yang akan diposting ke channel. */
export async function previewGoodbye(options: PreviewGoodbyeOptions): Promise<PreviewResult> {
  const { settings, name, guildName } = options;
  const template = settings.template?.trim() || DEFAULT_GOODBYE_TEMPLATE;

  let text: string | null = null;
  let note: string | null = null;

  if (settings.useAi && !options.templateOnly) {
    const result = await askModel(
      'Kamu menulis satu salam perpisahan singkat. Balas hanya teksnya.',
      buildGoodbyePrompt(settings, { name, guildName }),
      0.8,
      config.ai.brevityTokens,
      'salam perpisahan',
    );
    text = result.text;
    if (!text) note = result.error;
  } else {
    note = settings.useAi ? 'Mode template dipaksa.' : 'AI dimatikan di pengaturan.';
  }

  const finalText = text ?? fillText(template, previewValues(name, guildName));
  const result: PreviewResult = { text: finalText, source: text ? 'ai' : 'template', note: text ? null : note };

  // Kartu perpisahan: jalurnya harus sama persis dengan sambutan. Sebelumnya
  // pratinjau perpisahan tidak pernah merender kartu, jadi admin memilih mode
  // Card dan tidak melihat apa pun — padahal sambutan menampilkannya.
  if (options.withCard && options.renderCard) {
    try {
      const buffer = await options.renderCard({
        name,
        text: finalText,
        guildName,
        bannerDataUri: options.bannerDataUri ?? null,
        kicker: options.kicker ?? 'SAMPAI JUMPA',
      });
      result.card = Boolean(buffer);
      result.cardBytes = buffer?.byteLength ?? 0;
      result.cardDataUri = buffer ? `data:image/png;base64,${buffer.toString('base64')}` : undefined;
      if (!buffer) {
        result.note = mergeNote(result.note, 'Kartu PNG tidak bisa dirender — embed teks dipakai.');
      }
    } catch (error) {
      logger.warn('Gagal merender kartu pada pratinjau perpisahan', errorMessage(error));
      result.card = false;
      result.cardBytes = 0;
      result.note = mergeNote(result.note, `Kartu gagal dirender: ${errorMessage(error)}`);
    }
  }

  // Sama seperti sambutan: bentuk pesan dari `composePayload()`, bukan disusun
  // ulang di sini. Perpisahan punya warna, footer, dan aturan mention sendiri —
  // semuanya harus terlihat di pratinjau sebelum admin menyimpan.
  const previewMode = normalizeDisplayMode(settings.displayMode);
  result.mode = previewMode;
  const shaped = await shapePreview({
    mode: previewMode,
    text: finalText,
    member: options.member ?? previewMember(name, guildName),
    kind: 'goodbye',
    settings,
    bannerDataUri: options.bannerDataUri ?? null,
    name,
  });
  result.contentText = shaped.contentText;
  result.embedMock = shaped.embedMock;
  result.containerMock = shaped.containerMock;

  return result;
}

/**
 * Nilai token untuk pratinjau dashboard.
 *
 * Tidak ada member sungguhan di sini, jadi token member-specific diisi contoh
 * yang jelas terlihat sebagai contoh: mention palsu akan tampil sebagai
 * `@Sky` di kartu, dan jumlah member memakai angka contoh. Lebih baik
 * menampilkan contoh daripada membiarkan `{user.mention}` tampil mentah.
 */
function previewValues(name: string, guildName: string): Parameters<typeof fillText>[1] {
  return {
    user: name,
    server: guildName,
    mention: `@${name}`,
    tag: `${name.replace(/\s+/g, '').toLowerCase()}#0000`,
    memberCount: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  AI Agent                                                           */
/* ------------------------------------------------------------------ */

/**
 * Aturan gaya agent — dipakai `agent.ts` saat benar-benar membalas, dan
 * dipakai pratinjau di sini. Bedanya hanya pada tambahan konteks per pesan.
 */
export function agentRoleInstruction(role: 'chat' | 'gallery'): string {
  return role === 'gallery'
    ? [
        'Kamu sedang menanggapi kiriman di channel galeri komunitas.',
        '- Komentari isi gambarnya secara spesifik: suasana, warna, objek, ekspresi.',
        '- Maksimal 2 kalimat, hangat dan apresiatif — bukan penilaian teknis foto.',
        '- Jangan pernah menyebut orang lain tanpa diminta; cukup komentari karyanya.',
      ].join('\n')
    : [
        'Kamu sedang ikut ngobrol di channel komunitas, bukan menjawab tiket bantuan.',
        '- Balas seperti anggota komunitas: singkat, santai, maksimal 3 kalimat.',
        '- Sambung pembicaraan sebelumnya kalau masih nyambung; jangan mengulang sapaan.',
      ].join('\n');
}

/**
 * Prompt sapaan saat channel sepi ("pemecah sepi").
 *
 * Dipisah supaya dashboard bisa menunjukkan **kalimat apa yang akan dicoba**
 * dan pengujian memakai teks yang sama dengan timer sungguhan.
 */
export function buildQuietPrompt(
  guildName: string,
  options: {
    angle?: string;
    recent?: readonly string[];
    /** "14:05 WITA" — supaya sapaan menyesuaikan jam setempat. */
    clock?: string;
  } = {},
): string {
  const lines = [
    `Kamu anggota komunitas di server "${guildName}".`,
    'Channel sedang sepi — tidak ada yang mengobrol cukup lama.',
  ];
  // Jam setempat: sapaan "pagi" jam 9 WIT akan terdengar aneh kalau model
  // mengira masih subuh karena memakai WIB.
  if (options.clock) lines.push(`Sekarang pukul ${options.clock}.`);
  lines.push(
    'Buat satu kalimat pembuka ringan untuk mengajak ngobrol (bukan pengumuman, bukan promosi).',
    'Jangan menyebut dirimu bot atau AI. Maksimal 100 karakter.',
  );
  // Sudut acak supaya sapaan tidak selalu berpola sama.
  if (options.angle) lines.push(`Ide sudut obrolan kali ini: ${options.angle}`);
  // Larangan mengulang kalimat bot sebelumnya di channel yang sama.
  const antiRepeat = buildAntiRepeatBlock(options.recent ?? []);
  if (antiRepeat) lines.push(antiRepeat.trim());
  lines.push('Balas HANYA dengan kalimatnya.');
  return lines.join('\n');
}

export interface AgentReplyPreviewOptions {
  settings: AgentSettings;
  guildName: string;
  /** Nama member tiruan yang mengirim pesan. */
  userName: string;
  /** Isi pesan member. */
  message: string;
  /** Pilih peran channel secara eksplisit, atau biarkan ditentukan dari channelId. */
  role?: 'chat' | 'gallery';
  /** Riwayat obrolan (opsional) supaya hasilnya terasa nyambung. */
  history?: MemoryTurn[];
  botName?: string;
  persona?: string | null;
}

/** Balasan agent seperti yang akan muncul di channel — tanpa mengirim apa pun. */
export async function previewAgentReply(options: AgentReplyPreviewOptions): Promise<PreviewResult & { role: 'chat' | 'gallery' }> {
  const role = options.role ?? channelRole(options.settings, options.settings.channelId ?? '') ?? 'chat';
  const history = (options.history ?? []).slice(-MEMORY_TURNS);

  const systemPrompt = [
    `Kamu ${options.botName ?? 'Zypher AI'}, anggota komunitas di server "${options.guildName}".`,
    options.persona?.trim() ? `Kepribadian: ${options.persona.trim()}` : '',
    agentRoleInstruction(role),
    '- Jangan memakai pembuka khas bot, jangan menyebut dirimu AI.',
    '- Jangan membahas data pribadi siapa pun; kalau ditanya hal sensitif, alihkan dengan ramah.',
    `- Kamu sedang menanggapi pesan dari ${options.userName}.`,
  ]
    .filter(Boolean)
    .join('\n');

  const historyMessages: ChatMessage[] = history.map((turn) =>
    turn.role === 'bot'
      ? { role: 'assistant', content: turn.text }
      : { role: 'user', content: `${turn.userName}: ${turn.text}` },
  );

  try {
    const result = await chat({
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: `${options.userName}: ${options.message}` },
      ],
      // Jawaban agent bisa sampai 1200 karakter — jatah token penuh, bukan
      // angka kecil, supaya model reasoning tidak kehabisan sebelum menulis.
      maxTokens: config.ai.maxTokens,
      temperature: 0.8,
    });
    const text = cleanReply(result.message.content, 1200);
    if (!text) {
      return { role, text: '(kosong)', source: 'error', note: EMPTY_REPLY_HINT };
    }
    return { role, text, source: 'ai', note: null };
  } catch (error) {
    return { role, text: '', source: 'error', note: errorMessage(error) };
  }
}

/** Selisih menit yang enak dibaca: "2 jam 5 menit", "baru saja". */
function humanMinutes(totalMinutes: number): string {
  if (totalMinutes < 1) return 'baru saja';
  if (totalMinutes < 60) return `${Math.round(totalMinutes)} menit`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
}

/**
 * Jelaskan kenapa timer belum akan menyapa — supaya admin tidak menduga fitur
 * rusak padahal memang belum waktunya.
 */
function explainQuietSkip(
  settings: AgentSettings,
  state: AgentState,
  now: number,
  timeZone?: string | null,
): string | null {
  if (settings.quietHours && isQuietHour(now, timeZone)) {
    return (
      `Sekarang jam tenang malam (23:00–06:00 ${timeZoneLabel(timeZone)}) — bot tidak menyapa channel sendiri. ` +
      'Balasan ke mention tetap jalan. Matikan "Jam tenang malam" kalau tidak ingin ditahan.'
    );
  }

  const lastTrace = state.traces[state.traces.length - 1];
  const lastActivity = Math.max(lastTrace?.at ?? 0, state.lastReplyAt);

  if (lastActivity === 0) {
    return (
      'Belum ada obrolan tercatat di channel ini sejak bot hidup, dan bot tidak menyapa ' +
      'ruangan yang belum pernah ramai. Pakai "Paksa tulis" untuk melihat kalimatnya.'
    );
  }

  if (settings.cooldownSeconds > 0 && now - state.lastReplyAt < settings.cooldownSeconds * 1000) {
    const sisa = Math.ceil((settings.cooldownSeconds * 1000 - (now - state.lastReplyAt)) / 1000);
    return `Bot baru saja membalas — jeda minimum ${settings.cooldownSeconds} detik belum lewat (sisa ${sisa} detik).`;
  }

  const idleMinutes = (now - lastActivity) / 60_000;
  if (idleMinutes < settings.quietMinutes) {
    const sisa = Math.ceil(settings.quietMinutes - idleMinutes);
    return (
      `Channel baru sunyi ${humanMinutes(idleMinutes)}, sedangkan ambangnya ${settings.quietMinutes} menit. ` +
      `Sekitar ${sisa} menit lagi bot akan menyapa.`
    );
  }

  return null;
}

/**
 * Uji "pemecah sepi": apakah bot akan menyapa channel ini sekarang, dan
 * kalimat apa yang akan dikirim.
 *
 * Memakai `shouldBreakSilence()` + `QUIET_SYSTEM_PROMPT` yang sama persis
 * dengan timer di `handleQuietChannel()`, jadi yang tampil di dashboard benar
 * kalimat yang akan dikirim — bukan prompt karangan terpisah.
 *
 * `state` adalah state in-memory channel dari bot yang sedang jalan. Bila tidak
 * diberikan (dashboard berdiri sendiri tanpa bot), keputusan waktu tidak bisa
 * dinilai; kalimatnya tetap dibuat sebagai contoh.
 */
export async function previewQuietBreak(options: {
  settings: AgentSettings;
  guildName: string;
  /** State channel dari bot yang berjalan. Tanpa ini, jam tidak bisa dinilai. */
  state?: AgentState;
  /** Acuan waktu; default sekarang. Dipakai test supaya hasilnya pasti. */
  now?: number;
  /**
   * Zona waktu server (WIB/WITA/WIT). Dipakai untuk menilai jam tenang malam.
   * Tanpa ini, jam tenang dihitung dengan WIB — bisa meleset 1–2 jam.
   */
  timeZone?: string | null;
  /** Paksa menulis kalimatnya walau timer belum waktunya. */
  force?: boolean;
}): Promise<PreviewResult & { wouldFire: boolean; reason: string }> {
  const { settings, guildName, state, force = false, timeZone } = options;
  const now = options.now ?? Date.now();

  if (!settings.channelId) {
    return {
      text: '',
      source: 'error',
      note: null,
      wouldFire: false,
      reason: 'Channel ngobrol belum dipilih — bot tidak pernah menyapa sendiri.',
    };
  }
  if (settings.quietMinutes <= 0) {
    return {
      text: '',
      source: 'error',
      note: null,
      wouldFire: false,
      reason: 'Ambang sepi masih 0 menit — fitur ini dimatikan.',
    };
  }

  // Tanpa `force`, hormati keputusan timer yang sebenarnya.
  let wouldFire = true;
  let reason = `Kalau channel ngobrol sunyi selama ${settings.quietMinutes} menit, bot akan mengirim kalimat ini.`;

  if (!force && state) {
    wouldFire = shouldBreakSilence(settings, state, now, timeZone);
    if (!wouldFire) {
      const why = explainQuietSkip(settings, state, now, timeZone);
      return {
        text: '',
        source: 'template',
        note: null,
        wouldFire: false,
        reason: why ?? `Timer belum waktunya menyapa (ambang ${settings.quietMinutes} menit).`,
      };
    }
    reason = `Channel sudah sunyi cukup lama (ambang ${settings.quietMinutes} menit) — timer akan menyapa sekarang.`;
  } else if (force) {
    reason = 'Dipaksa: kalimat ditulis walau timer belum waktunya.';
  } else {
    reason = `Tanpa data channel dari bot yang berjalan, waktu sapaan tidak bisa dinilai. Contoh kalimat untuk ambang ${settings.quietMinutes} menit:`;
  }

  // Sudut acak + larangan mengulang kalimat bot sebelumnya di channel ini.
  // `state.turns` menyimpan beberapa giliran terakhir di memori bot.
  const recentReplies = (state?.turns ?? [])
    .filter((turn) => turn.role === 'bot')
    .map((turn) => turn.text);

  const result = await askModel(
    QUIET_SYSTEM_PROMPT,
    buildQuietPrompt(guildName, {
      angle: pickQuietAngle(),
      recent: recentReplies,
      clock: clockInZone(now, timeZone),
    }),
    0.9,
    config.ai.brevityTokens,
    'pemecah sepi',
  );

  if (!result.text) {
    return {
      text: '',
      source: 'error',
      note: result.error,
      wouldFire,
      reason: 'Waktunya bisa tiba, tapi model gagal menulis kalimat.',
    };
  }

  return {
    text: truncate(result.text, QUIET_MAX_CHARS),
    source: 'ai',
    note: null,
    wouldFire,
    reason,
  };
}

function mergeNote(current: string | null, extra: string): string {
  // Dipisah baris, bukan spasi: beberapa catatan sekaligus (AI gagal + kartu
  // tidak dirender) jadi satu paragraf panjang yang sulit dibaca di HP.
  return current ? `${current}\n${extra}` : extra;
}
