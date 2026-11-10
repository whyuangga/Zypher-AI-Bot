import {
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { config } from '../config.js';
import { appendMessage, getGuildSettings, getHistory } from '../db/repo.js';
import { DiscordStreamer } from '../lib/discord-stream.js';
import { chat, streamChat, type ChatMessage, type ChatTool } from '../lib/llm.js';
import { logger, errorMessage } from '../lib/logger.js';
import { checkRateLimit } from '../lib/ratelimit.js';
import { chunkMessage, truncate } from '../lib/text.js';
import { detectLanguage } from '../lib/language.js';
import { getMemories, memoryTools, runMemoryTool } from './memory.js';
import { matchKeywords } from './keywords.js';
import { buildSystemPrompt } from './prompt.js';
import { buildKnowledgeBlock, searchKnowledge, summarizeSources, type RetrievedChunk } from './rag.js';
import { collectImages, visionUserContent } from './vision.js';
import { isAudioAttachment, synthesizeSpeech, transcribeAudio } from '../lib/audio.js';

const MAX_TOOL_ROUNDS = 2;
const SLASH_PREVIEW_LIMIT = 1900;
const SLASH_EDIT_INTERVAL_MS = 1400;

type DeltaHandler = (delta: string) => void;

interface AnswerContext {
  guildId: string;
  guildName: string;
  botName: string;
  userId: string;
  userName: string;
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  allowTools: boolean;
  model?: string | null;
  /** data URI gambar (sudah lolos batas ukuran) — memicu mode multimodal */
  images?: string[];
}

/**
 * Susun prompt + panggil model (streaming bila `onDelta` diberikan),
 * termasuk eksekusi tool memory di antara putaran.
 */
export async function generateAnswer(
  context: AnswerContext,
  onDelta?: DeltaHandler,
): Promise<{ text: string; sources: RetrievedChunk[] }> {
  const settings = await getGuildSettings(context.guildId);
  const memories = await getMemories({ guildId: context.guildId, userId: context.userId });
  const keywords = await matchKeywords(context.guildId, context.question);

  // RAG: cari potongan dokumen yang relevan. Gagal mencari tidak boleh menggagalkan jawaban.
  let sources: RetrievedChunk[] = [];
  try {
    sources = await searchKnowledge(context.guildId, context.question);
  } catch (error) {
    logger.warn('Pencarian dokumen gagal — jawaban lanjut tanpa rujukan', errorMessage(error));
  }

  const systemPrompt = buildSystemPrompt({
    botName: context.botName,
    guildName: context.guildName,
    userName: context.userName,
    persona: settings?.persona ?? null,
    memories,
    keywords,
    knowledgeBlock: buildKnowledgeBlock(sources),
    language: detectLanguage(context.question),
  });

  // Model vision umumnya belum mendukung function calling, jadi tool dimatikan
  // saat ada gambar dan modelnya dipaksa ke `VISION_MODEL`.
  const hasImages = (context.images?.length ?? 0) > 0;
  const tools: ChatTool[] | undefined =
    !hasImages && context.allowTools && (settings?.autoMemory ?? config.features.autoMemory) ? memoryTools : undefined;
  const model = hasImages ? config.vision.model : (settings?.model ?? context.model ?? undefined);

  const userMessage: ChatMessage = hasImages
    ? { role: 'user', content: visionUserContent(context.question, context.images ?? []) }
    : { role: 'user', content: context.question };

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.history.map((entry) => ({ role: entry.role, content: entry.content }) as ChatMessage),
    userMessage,
  ];

  let streamed = '';
  const emit: DeltaHandler | undefined = onDelta
    ? (delta) => {
        streamed += delta;
        onDelta(delta);
      }
    : undefined;

  const run = (payload: ChatMessage[]) =>
    emit ? streamChat({ messages: payload, tools, model }, { onDelta: emit }) : chat({ messages: payload, tools, model });

  let result = await run(messages);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const toolCalls = result.message.tool_calls;
    if (!toolCalls?.length) break;

    const toolMessages: ChatMessage[] = [];
    for (const call of toolCalls) {
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await runMemoryTool(call.function.name, call.function.arguments, {
          guildId: context.guildId,
          userId: context.userId,
          source: 'auto',
        }),
      });
    }

    messages.push(
      {
        role: 'assistant',
        content: result.message.content ?? null,
        tool_calls: toolCalls,
      } as ChatMessage,
      ...toolMessages,
    );

    result = await run(messages);
  }

  const answer = (result.message.content ?? '').trim() || streamed.trim();
  return {
    text: answer.length > 0 ? answer : 'Hmm, aku belum bisa menjawab itu. Boleh dijelaskan ulang?',
    sources,
  };
}

interface VoiceNote {
  text: string | null;
  error: string | null;
}

const DOWNLOAD_TIMEOUT_MS = 15_000;

/** Unduh voice note / audio dari pesan lalu transkrip jadi teks. */
async function readVoiceNote(message: Message): Promise<VoiceNote> {
  if (!config.voice.enabled || message.attachments.size === 0) return { text: null, error: null };

  const attachment = [...message.attachments.values()].find((item) =>
    isAudioAttachment(item.name, item.contentType),
  );
  if (!attachment) return { text: null, error: null };

  if (attachment.size > config.voice.maxBytes) {
    const maxMb = Math.round(config.voice.maxBytes / (1024 * 1024));
    return { text: null, error: `Voice note lebih dari ${maxMb} MB` };
  }

  try {
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error('file kosong');

    const result = await transcribeAudio({
      bytes,
      filename: attachment.name || 'voice.ogg',
      contentType: attachment.contentType,
    });

    logger.info(`Voice note ditranskrip oleh ${result.provider}/${result.model}`);

    // Voice note Discord biasanya tanpa durasi jelas; batasi panjang teks supaya
    // prompt tidak membengkak.
    return { text: truncate(result.text, 1500), error: null };
  } catch (error) {
    logger.warn('Gagal transkrip voice note', errorMessage(error));
    return { text: null, error: `Gagal transkrip voice note (${errorMessage(error).slice(0, 160)})` };
  }
}

/** Kirim jawaban sebagai file audio; best-effort, tidak pernah melempar error. */
async function replyWithSpeech(message: Message, text: string): Promise<void> {
  if (!config.voice.ttsEnabled || !text.trim()) return;

  try {
    const speech = await synthesizeSpeech(text);
    const fileName = speech.mime === 'audio/wav' ? 'jawaban.wav' : 'jawaban.mp3';
    const file = new AttachmentBuilder(Buffer.from(speech.bytes), {
      name: fileName,
      description: 'Jawaban suara dari Zypher AI',
    });

    await message.reply({
      content: '🔊 Versi suara jawabannya:',
      files: [file],
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    logger.warn('Gagal membuat balasan suara (TTS)', errorMessage(error));
  }
}

export async function answerSlashQuestion(interaction: ChatInputCommandInteraction, question: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Perintah ini hanya bisa dipakai di dalam server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const rate = checkRateLimit(`ask:${interaction.guildId}:${interaction.user.id}`, config.features.rateLimitPerMinute);
  if (!rate.allowed) {
    const seconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    await interaction.reply({ content: `⏳ Terlalu cepat. Coba lagi dalam ${seconds} detik.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Stream ke pesan ephemeral: edit berkala supaya tidak kena rate limit Discord.
  let preview = '';
  let lastSent = '';
  let busy = false;

  const timer = setInterval(() => {
    if (busy || !preview.trim() || preview === lastSent) return;
    busy = true;
    const content = preview.length >= SLASH_PREVIEW_LIMIT ? `${preview}\n…` : preview;
    interaction
      .editReply({ content, allowedMentions: { parse: [] } })
      .then(() => {
        lastSent = content;
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, SLASH_EDIT_INTERVAL_MS);

  try {
    const result = await generateAnswer(
      {
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        botName: interaction.client.user?.username ?? 'Zypher AI',
        userId: interaction.user.id,
        userName:
          interaction.member && 'displayName' in interaction.member
            ? interaction.member.displayName
            : interaction.user.username,
        question: truncate(question, config.features.maxInputChars),
        history: [],
        allowTools: true,
      },
      (delta) => {
        if (preview.length < SLASH_PREVIEW_LIMIT) preview = (preview + delta).slice(0, SLASH_PREVIEW_LIMIT);
      },
    );

    clearInterval(timer);

    const sourceNote = summarizeSources(result.sources);
    const answer = sourceNote ? `${result.text}\n\n-# ${sourceNote}` : result.text;

    const chunks = chunkMessage(answer).slice(0, 4);
    await interaction.editReply({ content: chunks[0] ?? 'Tidak ada jawaban.', allowedMentions: { parse: [] } });
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    clearInterval(timer);
    logger.error('Gagal menjawab /tanya', errorMessage(error));
    await interaction.editReply({ content: `⚠️ ${errorMessage(error).slice(0, 300)}` }).catch(() => undefined);
  }
}
