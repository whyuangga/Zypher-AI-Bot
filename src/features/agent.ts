/**
 * Penghubung AI Agent dengan Discord.
 *
 * Bagian keputusan ada di `agent-core.ts`; di sini hanya hal yang butuh objek
 * Discord: membaca mention/sticker/gambar dan mengirim balasan.
 */
import {
  type AnyThreadChannel,
  type Message,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { getAgentSettings, getGuildSettings, hasAgentReaction, type AgentSettings } from '../db/repo.js';
import { chat, type ChatMessage, type ChatTool } from '../lib/llm.js';
import { errorMessage, logger } from '../lib/logger.js';
import { chunkMessage, truncate } from '../lib/text.js';
import { getMemories, memoryTools, runMemoryTool } from './memory.js';
import { buildSystemPrompt } from './prompt.js';
import { buildKnowledgeBlock, searchKnowledge } from './rag.js';
import { collectImages, isImageAttachment, visionUserContent } from './vision.js';
import {
  QUIET_MAX_CHARS,
  QUIET_SYSTEM_PROMPT,
  channelRole,
  emptyState,
  pushTurn,
  recordReply,
  recordTrace,
  shouldBreakSilence,
  shouldReply,
  type AgentState,
} from './agent-core.js';
import { agentRoleInstruction, buildQuietPrompt } from './preview.js';

const MAX_TOOL_ROUNDS = 2;
/** Balasan nimbrung harus pendek — ini obrolan, bukan jawaban tiket. */
const MAX_REPLY_CHARS = 1200;
const REPLY_CHUNK = 900;

type GuildChannel = TextChannel | AnyThreadChannel;

interface ChannelMemory {
  state: AgentState;
  lastSeenAt: number;
}

/** State in-memory per channel. Hilang saat restart — memang tidak perlu awet. */
const channels = new Map<string, ChannelMemory>();

function memoryFor(channelId: string): ChannelMemory {
  let entry = channels.get(channelId);
  if (!entry) {
    entry = { state: emptyState(), lastSeenAt: 0 };
    channels.set(channelId, entry);
  }
  return entry;
}

/** Sebutan untuk member: nickname di server, fallback username. */
function speakerName(message: Message): string {
  return message.member?.displayName || message.author.displayName || message.author.username;
}

const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;

/**
 * Apakah pesan berisi sesuatu yang "visual" — gambar, video, atau embed
 * (tautan galeri/tenor). Dipakai channel galeri untuk memutuskan apakah
 * pesan ini layak dikomentari.
 */
export function hasVisualContent(message: Message): boolean {
  const visualAttachment = [...message.attachments.values()].some(
    (attachment) =>
      isImageAttachment(attachment.name, attachment.contentType) ||
      Boolean(attachment.contentType?.startsWith('video/')) ||
      VIDEO_EXT.test(attachment.name ?? ''),
  );
  if (visualAttachment) return true;
  // Embed dari tautan (mis. Instagram/Tenor) juga dianggap kiriman galeri.
  return message.embeds.length > 0;
}

/**
 * Ringkas isi pesan jadi satu "pertanyaan" untuk model.
 *
 * `null` = tidak ada yang perlu ditanggapi (mis. hanya embed kosong).
 */
export function describeIncoming(message: Message): string | null {
  const parts: string[] = [];
  const text = message.content.trim();
  if (text) parts.push(text);

  const sticker = message.stickers.first();
  if (sticker) parts.push(`(mengirim sticker: ${sticker.name})`);

  const video = [...message.attachments.values()].find(
    (attachment) => attachment.contentType?.startsWith('video/') || VIDEO_EXT.test(attachment.name ?? ''),
  );
  if (video) parts.push('(mengirim video tanpa teks)');
  if (message.embeds.length > 0 && !text) parts.push('(mengirim embed/link tanpa teks)');
  if (message.attachments.size > 0 && !text && !video) parts.push('(mengirim lampiran tanpa teks)');

  const joined = parts.join(' ').trim();
  return joined ? truncate(joined, config.features.maxInputChars) : null;
}

/** Apakah bot disebut — mention atau reply ke pesan bot. */
export function isSummoned(message: Message): boolean {
  const selfId = message.client.user?.id;
  if (!selfId) return false;
  if (message.mentions.users.has(selfId)) return true;
  return message.mentions.repliedUser?.id === selfId;
}

/** Susun dan panggil model untuk membalas satu pesan di channel agent. */
async function composeReply(
  message: Message,
  settings: AgentSettings,
  role: 'chat' | 'gallery',
): Promise<string | null> {
  const guildId = message.guildId!;
  const guild = message.guild!;
  const name = speakerName(message);

  const question = describeIncoming(message);
  // Gambar hanya dibaca kalau admin menyalakan opsi gambar AI Agent — hemat
  // biaya. Vision sendiri selalu aktif, tidak ada toggle global lagi.
  const collected = settings.reactImages ? await collectImages(message) : { dataUris: [], skipped: [] };
  const images = collected.dataUris;
  if (!question && images.length === 0) return null;

  const guildSettings = await getGuildSettings(guildId);
  const memories = await getMemories({ guildId, userId: message.author.id });

  let knowledgeBlock = '';
  try {
    const sources = await searchKnowledge(guildId, question ?? 'gambar yang dikirim member');
    knowledgeBlock = buildKnowledgeBlock(sources);
  } catch (error) {
    logger.warn('Pencarian dokumen untuk agent gagal', errorMessage(error));
  }

  const systemPrompt = [
    buildSystemPrompt({
      botName: message.client.user?.username ?? 'Zypher AI',
      guildName: guild.name,
      userName: name,
      persona: guildSettings?.persona ?? null,
      memories,
      keywords: [],
      knowledgeBlock,
      language: 'id',
    }),
    '',
    '## Mode nimbrung di channel publik',
    agentRoleInstruction(role),
    '- Jangan memakai pembuka khas bot, jangan menyebut dirimu AI.',
    '- Boleh menanggapi sticker, emoji, atau gambar dengan reaksi ringan.',
    '- Jangan membahas data pribadi siapa pun; kalau ditanya hal sensitif, alihkan dengan ramah.',
    `- Kamu sedang menanggapi pesan dari ${name}.`,
  ].join('\n');

  const userMessage: ChatMessage =
    images.length > 0
      ? { role: 'user', content: visionUserContent(question ?? 'Lihat gambar ini lalu tanggapi singkat.', images) }
      : { role: 'user', content: question! };

  const tools: ChatTool[] | undefined =
    images.length === 0 && (guildSettings?.autoMemory ?? config.features.autoMemory) ? memoryTools : undefined;
  const model = images.length > 0 ? config.vision.model : (guildSettings?.model ?? undefined);

  // Riwayat obrolan diambil dari MEMORI (bukan database) supaya balasan
  // nyambung dengan percakapan sebelumnya. Hilang saat bot restart.
  const history: ChatMessage[] = memoryFor(message.channelId).state.turns.map((turn) =>
    turn.role === 'bot'
      ? { role: 'assistant', content: turn.text }
      : { role: 'user', content: `${turn.userName}: ${turn.text}` },
  );

  const payload: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history, userMessage];
  let result = await chat({ messages: payload, tools, model, maxTokens: config.ai.brevityTokens });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const toolCalls = result.message.tool_calls;
    if (!toolCalls?.length) break;

    const toolMessages: ChatMessage[] = [];
    for (const call of toolCalls) {
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await runMemoryTool(call.function.name, call.function.arguments, {
          guildId,
          userId: message.author.id,
          source: 'auto',
        }),
      });
    }

    payload.push(
      { role: 'assistant', content: result.message.content ?? null, tool_calls: toolCalls } as ChatMessage,
      ...toolMessages,
    );
    result = await chat({ messages: payload, tools, model, maxTokens: config.ai.brevityTokens });
  }

  const text = (result.message.content ?? '').trim();
  return text ? truncate(text, MAX_REPLY_CHARS) : null;
}

async function replyInChannel(message: Message, text: string, summoned: boolean): Promise<void> {
  const chunks = chunkMessage(text, REPLY_CHUNK).slice(0, 2);
  for (const [index, chunk] of chunks.entries()) {
    try {
      if (index === 0) {
        // Mention hanya dipicu saat memang dipanggil — nimbrung tidak boleh nge-tag siapa pun.
        await message.reply({ content: chunk, allowedMentions: { repliedUser: summoned } });
      } else if (message.channel.isSendable()) {
        await message.channel.send({ content: chunk, allowedMentions: { parse: [] } });
      }
    } catch (error) {
      logger.warn('Gagal mengirim balasan agent', errorMessage(error));
      return;
    }
  }
}

/**
 * Titik masuk untuk setiap pesan di server.
 *
 * Dua peran channel:
 *   - **chat**   → nimbrung seperti anggota komunitas (aturan ramai/cooldown).
 *   - **gallery** → hanya menanggapi kiriman gambar/video; teks biasa diabaikan
 *                  supaya bot tidak mengomentari obrolan di channel galeri.
 *
 * Mengembalikan tanpa efek apa pun kalau channel bukan milik agent.
 */
export async function handleAgentMessage(message: Message): Promise<void> {
  if (!message.inGuild() || !message.channel.isTextBased() || message.channel.isDMBased()) return;

  const settings = await getAgentSettings(message.guildId);
  const role = channelRole(settings, message.channelId);
  if (!role) return;

  const now = Date.now();
  const entry = memoryFor(message.channelId);
  entry.lastSeenAt = now;

  const summoned = isSummoned(message);
  // Aktivitas dicatat walau bot tidak membalas — dipakai aturan "ramai".
  if (!message.author.bot) entry.state = recordTrace(entry.state, message.author.id, now);

  // ---- galeri: hanya gambar/video yang ditanggapi ----
  const hasVisual = hasVisualContent(message);
  if (role === 'gallery') {
    // Mention di galeri tetap dijawab, tapi tanpa gambar bot tidak berkomentar.
    if (!hasVisual && !summoned) return;
    if (hasVisual && !settings.reactImages) return;
  }

  const decision = shouldReply({
    settings,
    state: entry.state,
    channelId: message.channelId,
    fromBot: message.author.bot,
    summoned,
    now,
  });
  if (!decision.reply) return;

  // Di channel ngobrol, sticker & emoji saja dijaga agar tidak dobel.
  const onlyEmoji =
    role === 'chat' &&
    (message.stickers.size > 0 ||
      (message.content.length > 0 &&
        message.attachments.size === 0 &&
        message.embeds.length === 0 &&
        /^\p{Extended_Pictographic}+$/u.test(message.content.trim())));
  if (onlyEmoji && settings.reactEmoji && !summoned) {
    if (await hasAgentReaction(message.id)) return;
    await respond(message, settings, role, entry, now, false);
    return;
  }

  await respond(message, settings, role, entry, now, summoned);
}

/** Susun balasan, kirim, lalu catat ke state (riwayat + jatah per jam). */
async function respond(
  message: Message,
  settings: AgentSettings,
  role: 'chat' | 'gallery',
  entry: ChannelMemory,
  now: number,
  summoned: boolean,
): Promise<void> {
  // Pesan member masuk ke riwayat SEBELUM model dipanggil, supaya balasan
  // yang dihasilkan sudah mempertimbangkan pesan itu sebagai konteks.
  const text = describeIncoming(message) ?? '';
  if (text && !message.author.bot) {
    entry.state = pushTurn(entry.state, {
      userId: message.author.id,
      userName: speakerName(message),
      role: 'user',
      text,
      at: now,
    });
  }

  const reply = await composeReply(message, settings, role);
  if (!reply) return;

  await replyInChannel(message, reply, summoned);
  entry.state = recordReply(entry.state, now);
  entry.state = pushTurn(entry.state, {
    userId: message.client.user?.id ?? 'bot',
    userName: message.client.user?.username ?? 'bot',
    role: 'bot',
    text: reply,
    at: now,
  });
}

/**
 * Sapaan saat channel sepi — dipanggil timer di `bot.ts`.
 * Mengembalikan true kalau bot benar-benar menyapa.
 */
export async function handleQuietChannel(
  client: { channels: { fetch(id: string): Promise<unknown> } },
  guildId: string,
): Promise<boolean> {
  const settings = await getAgentSettings(guildId);
  if (!settings.channelId || settings.quietMinutes <= 0) return false;

  const entry = memoryFor(settings.channelId);
  const now = Date.now();
  if (!shouldBreakSilence(settings, entry.state, now)) return false;

  const channel = (await client.channels.fetch(settings.channelId).catch(() => null)) as GuildChannel | null;
  // Hanya channel teks di server yang boleh disapa — DM tidak punya "channel sepi".
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return false;

  try {
    const result = await chat({
      messages: [
        { role: 'system', content: QUIET_SYSTEM_PROMPT },
        { role: 'user', content: buildQuietPrompt(channel.guild.name) },
      ],
      maxTokens: config.ai.brevityTokens,
      temperature: 0.9,
    });

    const text = (result.message.content ?? '').trim().replace(/^["'“”]|["'“”]$/g, '');
    if (!text) return false;

    await channel.send({ content: truncate(text, QUIET_MAX_CHARS), allowedMentions: { parse: [] } });
    entry.state = recordReply(entry.state, now);
    entry.lastSeenAt = now;
    logger.info(`Agent menyapa channel sepi (${text.slice(0, 60)}…).`);
    return true;
  } catch (error) {
    logger.warn('Gagal menyapa channel sepi', errorMessage(error));
    return false;
  }
}

/** Buang state channel lama supaya Map tidak tumbuh tanpa batas. */
export function pruneAgentState(): void {
  if (channels.size <= 50) return;
  const cutoff = Date.now() - 86_400_000;
  for (const [channelId, entry] of channels) {
    if (entry.lastSeenAt < cutoff) channels.delete(channelId);
  }
}

/** Untuk test & debug. */
export function channelState(channelId: string): AgentState {
  return memoryFor(channelId).state;
}
