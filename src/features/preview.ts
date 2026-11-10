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
import { chat, type ChatMessage } from '../lib/llm.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { channelRole, MEMORY_TURNS, type MemoryTurn } from './agent-core.js';
import { DEFAULT_GOODBYE_TEMPLATE, DEFAULT_WELCOME_TEMPLATE, fillText } from './greeting-text.js';

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
}

/** Jam lokal server untuk menentukan pagi/siang/malam. */
export function partOfDay(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('id-ID', {
      timeZone: config.features.timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(now),
  );
  if (hour < 4) return 'dinihari';
  if (hour < 11) return 'pagi';
  if (hour < 15) return 'siang';
  if (hour < 18) return 'sore';
  return 'malam';
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
  /** Pemanggil menyediakan renderer supaya modul ini tidak bergantung Chromium. */
  renderCard?: (input: {
    name: string;
    text: string;
    guildName: string;
    bannerDataUri?: string | null;
    kicker?: string;
  }) => Promise<Buffer | null>;
  /** Banner unggahan admin (data URI) untuk ikut dirender di kartu. */
  bannerDataUri?: string | null;
  /** Judul kecil di kartu: "SELAMAT DATANG" atau "SAMPAI JUMPA". */
  kicker?: string;
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
      buildWelcomePrompt(settings, { name, guildName }, partOfDay()),
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
  const finalText = text ?? fillText(template, { user: name, server: guildName });

  const result: PreviewResult = { text: finalText, source, note: text ? null : note };

  if (options.withCard && options.renderCard) {
    try {
      const buffer = await options.renderCard({
        name,
        text: finalText,
        guildName,
        bannerDataUri: options.bannerDataUri ?? null,
        kicker: options.kicker,
      });
      result.card = Boolean(buffer);
      result.cardBytes = buffer?.byteLength ?? 0;
      result.cardDataUri = buffer ? `data:image/png;base64,${buffer.toString('base64')}` : undefined;
      if (!buffer) {
        result.note = mergeNote(result.note, 'Kartu PNG tidak dirender (Chromium tidak tersedia) — embed teks dipakai.');
      }
    } catch (error) {
      logger.warn('Gagal merender kartu pada pratinjau', errorMessage(error));
      result.card = false;
      result.cardBytes = 0;
      result.note = mergeNote(result.note, `Kartu gagal dirender: ${errorMessage(error)}`);
    }
  }

  return result;
}

/** Hasil salam perpisahan seperti yang akan diposting ke channel. */
export async function previewGoodbye(options: {
  settings: GoodbyeSettings;
  name: string;
  guildName: string;
  templateOnly?: boolean;
}): Promise<PreviewResult> {
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

  return {
    text: text ?? fillText(template, { user: name, server: guildName }),
    source: text ? 'ai' : 'template',
    note: text ? null : note,
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
export function buildQuietPrompt(guildName: string): string {
  return [
    `Kamu anggota komunitas di server "${guildName}".`,
    'Channel sedang sepi — tidak ada yang mengobrol cukup lama.',
    'Buat satu kalimat pembuka ringan untuk mengajak ngobrol (bukan pengumuman, bukan promosi).',
    'Jangan menyebut dirimu bot atau AI. Maksimal 100 karakter.',
    'Balas HANYA dengan kalimatnya.',
  ].join('\n');
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

/**
 * Uji "pemecah sepi": apakah bot akan menyapa channel ini sekarang, dan
 * kalimat apa yang akan dikirim. Memakai `shouldBreakSilence` yang sama dengan
 * timer sungguhan, jadi hasil "tidak akan menyapa" juga informatif.
 */
export async function previewQuietBreak(options: {
  settings: AgentSettings;
  guildName: string;
  /** Minta model menulis kalimatnya walau saat ini belum waktunya. */
  force?: boolean;
}): Promise<PreviewResult & { wouldFire: boolean; reason: string }> {
  const { settings, guildName } = options;

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

  const result = await askModel(
    'Kamu anggota komunitas yang santai. Balas hanya satu kalimat pembuka.',
    buildQuietPrompt(guildName),
    0.9,
    config.ai.brevityTokens,
    'pemecah sepi',
  );

  if (!result.text) {
    return {
      text: '',
      source: 'error',
      note: result.error,
      wouldFire: true,
      reason: 'Waktunya bisa tiba, tapi model gagal menulis kalimat.',
    };
  }

  return {
    text: result.text,
    source: 'ai',
    note: null,
    wouldFire: true,
    reason: `Kalau channel ngobrol sunyi selama ${settings.quietMinutes} menit, bot akan mengirim kalimat ini.`,
  };
}

function mergeNote(current: string | null, extra: string): string {
  // Dipisah baris, bukan spasi: beberapa catatan sekaligus (AI gagal + kartu
  // tidak dirender) jadi satu paragraf panjang yang sulit dibaca di HP.
  return current ? `${current}\n${extra}` : extra;
}
