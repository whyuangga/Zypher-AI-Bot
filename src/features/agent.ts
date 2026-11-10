/**
 * Penghubung AI Agent dengan Discord.
 *
 * Bagian keputusan ada di `agent-core.ts`; di sini hanya hal yang butuh objek
 * Discord: membaca mention/sticker/gambar dan mengirim balasan.
 */
import {
  ChannelType,
  type AnyThreadChannel,
  type Message,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { getAgentSettings, getGuildSettings, hasAgentReaction, markAgentReaction, pruneAgentReactions, type AgentSettings } from '../db/repo.js';
import { chat, type ChatMessage, type ChatTool } from '../lib/llm.js';
import { errorMessage, logger } from '../lib/logger.js';
import { chunkMessage, truncate } from '../lib/text.js';
import { getMemories, memoryTools, runMemoryTool } from './memory.js';
import { buildSystemPrompt } from './prompt.js';
import { buildKnowledgeBlock, searchKnowledge } from './rag.js';
import { collectImages, visionUserContent } from './vision.js';
import { recordReply, recordTrace, shouldBreakSilence, shouldReply, type AgentState } from './agent-core.js';

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
    entry = { state: { lastReplyAt: 0, repliesLastHour: [], traces: [] }, lastSeenAt: 0 };
    channels.set(channelId, entry);
  }
  return entry;
}

/** Sebutan untuk member: nickname di server, fallback username. */
function speakerName(message: Message): string {
  return message.member?.displayName || message.author.displayName || message.author.username;
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

  if (message.embeds.length > 0 && !text) parts.push('(mengirim embed/link tanpa teks)');
  if (message.attachments.size > 0 && !text) parts.push('(mengirim lampiran tanpa teks)');

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
async function composeReply(message: Message, settings: AgentSettings): Promise<string | null> {
  const guildId = message.guildId!;
  const guild = message.guild!;
  const name = speakerName(message);

  const question = describeIncoming(message);
  // Gambar hanya dibaca kalau admin mengizinkan — hemat biaya dan lebih aman.
  // `collectImages` sudah menghormati toggle Vision per server.
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
    'Kamu sedang ikut ngobrol di channel komunitas, bukan menjawab tiket bantuan.',
    '- Balas seperti anggota komunitas: singkat, santai, maksimal 3 kalimat.',
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

  const payload: ChatMessage[] = [{ role: 'system', content: systemPrompt }, userMessage];
  let result = await chat({ messages: payload, tools, model, maxTokens: 220 });

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
    result = await chat({ messages: payload, tools, model, maxTokens: 220 });
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
 * Mengembalikan tanpa efek apa pun kalau channel bukan channel agent.
 */
export async function handleAgentMessage(message: Message): Promise<void> {
  if (!message.inGuild() || !message.channel.isTextBased() || message.channel.isDMBased()) return;

  const settings = await getAgentSettings(message.guildId);
  if (!settings.channelId || settings.channelId !== message.channelId) return;

  const now = Date.now();
  const entry = memoryFor(message.channelId);
  entry.lastSeenAt = now;

  const summoned = isSummoned(message);
  // Aktivitas dicatat walau bot tidak membalas — dipakai aturan "ramai".
  if (!message.author.bot) entry.state = recordTrace(entry.state, message.author.id, now);

  const decision = shouldReply({
    settings,
    state: entry.state,
    channelId: message.channelId,
    fromBot: message.author.bot,
    summoned,
    now,
  });
  if (!decision.reply) return;

  // Sticker & emoji saja: tetap perlu jawaban, dan dijaga agar tidak dobel.
  const onlyEmoji =
    message.stickers.size > 0 ||
    (message.content.length > 0 &&
      message.attachments.size === 0 &&
      message.embeds.length === 0 &&
      /^\p{Extended_Pictographic}+$/u.test(message.content.trim()));
  if (onlyEmoji && settings.reactEmoji && !summoned) {
    if (await hasAgentReaction(message.id)) return;
    const reply = await composeReply(message, settings);
    if (!reply) return;
    await replyInChannel(message, reply, false);
    await markAgentReaction(message.id);
    entry.state = recordReply(entry.state, now);
    await pruneAgentReactions(7 * 86_400_000).catch(() => undefined);
    return;
  }

  const reply = await composeReply(message, settings);
  if (!reply) return;

  await replyInChannel(message, reply, summoned);
  entry.state = recordReply(entry.state, now);
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
        {
          role: 'system',
          content:
            'Kamu anggota komunitas yang santai. Tulis satu kalimat pembuka singkat (maks 100 karakter) ' +
            'untuk memecah keheningan. Jangan menyebut dirimu bot atau AI.',
        },
        {
          role: 'user',
          content:
            'Channel sedang sepi — tidak ada yang mengobrol cukup lama. ' +
            'Buat satu kalimat pembuka ringan untuk mengajak ngobrol (bukan pengumuman, bukan promosi).',
        },
      ],
      maxTokens: 80,
      temperature: 0.9,
    });

    const text = (result.message.content ?? '').trim().replace(/^["'“”]|["'“”]$/g, '');
    if (!text) return false;

    await channel.send({ content: truncate(text, 200), allowedMentions: { parse: [] } });
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
