import { ChannelType, MessageFlags, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { config } from '../config.js';
import {
  appendMessage,
  getGuildSettings,
  getHistory,
  getRoomByChannel,
  touchRoom,
} from '../db/repo.js';
import { chat, type ChatMessage, type ChatTool } from '../lib/llm.js';
import { logger, errorMessage } from '../lib/logger.js';
import { checkRateLimit } from '../lib/ratelimit.js';
import { chunkMessage, truncate } from '../lib/text.js';
import { getMemories, memoryTools, runMemoryTool } from './memory.js';
import { buildSystemPrompt } from './prompt.js';
import { matchKeywords } from './keywords.js';

const MAX_TOOL_ROUNDS = 2;

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
}

/**
 * Susun prompt + panggil model, termasuk eksekusi tool memory.
 */
async function generateAnswer(context: AnswerContext): Promise<string> {
  const settings = getGuildSettings(context.guildId);
  const memories = getMemories({ guildId: context.guildId, userId: context.userId });
  const keywords = matchKeywords(context.guildId, context.question);

  const systemPrompt = buildSystemPrompt({
    botName: context.botName,
    guildName: context.guildName,
    userName: context.userName,
    persona: settings?.persona ?? null,
    memories,
    keywords,
  });

  const tools: ChatTool[] | undefined = context.allowTools && config.features.autoMemory ? memoryTools : undefined;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.history.map((entry) => ({ role: entry.role, content: entry.content }) as ChatMessage),
    { role: 'user', content: context.question },
  ];

  let result = await chat({
    messages,
    tools,
    model: settings?.model ?? context.model ?? undefined,
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const toolCalls = result.message.tool_calls;
    if (!toolCalls?.length) break;

    const toolMessages: ChatMessage[] = toolCalls.map((call) => ({
      role: 'tool',
      tool_call_id: call.id,
      content: runMemoryTool(call.function.name, call.function.arguments, {
        guildId: context.guildId,
        userId: context.userId,
        source: 'auto',
      }),
    }));

    messages.push(
      {
        role: 'assistant',
        content: result.message.content ?? null,
        tool_calls: toolCalls,
      } as ChatMessage,
      ...toolMessages,
    );

    result = await chat({ messages, tools, model: settings?.model ?? context.model ?? undefined });
  }

  const answer = result.message.content?.trim();
  return answer && answer.length > 0 ? answer : 'Hmm, aku belum bisa menjawab itu. Boleh dijelaskan ulang?';
}

function startTypingLoop(channel: { sendTyping: () => Promise<void> }): () => void {
  void channel.sendTyping().catch(() => undefined);
  const timer = setInterval(() => {
    void channel.sendTyping().catch(() => undefined);
  }, 8_000);
  return () => clearInterval(timer);
}

/** Handler untuk setiap pesan di channel room AI. */
export async function handleRoomMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.inGuild()) return;
  if (message.channel.type !== ChannelType.GuildText) return;

  const room = getRoomByChannel(message.channelId);
  if (!room) return;

  // Hanya pesan pemilik room yang dibalas. Staff boleh membaca, tidak memicu AI.
  if (message.author.id !== room.userId) return;

  const raw = message.content.replace(/<@!?\d+>/g, ' ').trim();

  if (!raw) {
    if (message.attachments.size > 0) {
      await message
        .reply({
          content: 'Aku belum bisa membaca gambar/file ya — coba tulis pertanyaannya dalam teks 🙏',
          allowedMentions: { repliedUser: false },
        })
        .catch(() => undefined);
    }
    return;
  }

  const question = truncate(raw, config.features.maxInputChars);

  const rate = checkRateLimit(`chat:${message.guildId}:${message.author.id}`, config.features.rateLimitPerMinute);
  if (!rate.allowed) {
    const seconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    await message
      .reply({
        content: `⏳ Pelan-pelan ya, kamu sudah mencapai batas ${config.features.rateLimitPerMinute} pesan/menit. Coba lagi dalam ${seconds} detik.`,
        allowedMentions: { repliedUser: false },
      })
      .catch(() => undefined);
    return;
  }

  const stopTyping = startTypingLoop(message.channel);

  try {
    // Riwayat diambil SEBELUM pesan ini disimpan, supaya tidak dobel dengan `question`.
    const history = config.ai.historyLimit > 0 ? getHistory(message.channelId, config.ai.historyLimit) : [];

    const answer = await generateAnswer({
      guildId: message.guildId,
      guildName: message.guild.name,
      botName: message.client.user?.username ?? 'Zypher AI',
      userId: message.author.id,
      userName: message.member?.displayName ?? message.author.username,
      question,
      history: history.map((entry) => ({ role: entry.role, content: truncate(entry.content, 2000) })),
      allowTools: true,
    });

    // Simpan ke riwayat hanya setelah jawaban berhasil, agar percakapan gagal tidak mengotori konteks.
    appendMessage(message.channelId, 'user', question);
    appendMessage(message.channelId, 'assistant', answer);
    touchRoom(message.channelId);

    const chunks = chunkMessage(answer);
    const [first, ...rest] = chunks;

    if (first) {
      await message.reply({ content: first, allowedMentions: { repliedUser: false, parse: [] } });
      for (const chunk of rest) {
        await message.channel.send({ content: chunk, allowedMentions: { parse: [] } });
      }
    }
  } catch (error) {
    logger.error('Gagal menjawab pesan room AI', errorMessage(error));
    await message
      .reply({
        content: `⚠️ Maaf, ada gangguan: ${errorMessage(error).slice(0, 200)}\nCoba lagi sebentar lagi ya.`,
        allowedMentions: { repliedUser: false },
      })
      .catch(() => undefined);
  } finally {
    stopTyping();
  }
}

/** `/tanya` — tanya cepat tanpa membuat room, jawaban hanya terlihat oleh penanya. */
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

  try {
    const answer = await generateAnswer({
      guildId: interaction.guildId,
      guildName: interaction.guild.name,
      botName: interaction.client.user?.username ?? 'Zypher AI',
      userId: interaction.user.id,
      userName: interaction.member && 'displayName' in interaction.member ? interaction.member.displayName : interaction.user.username,
      question: truncate(question, config.features.maxInputChars),
      history: [],
      allowTools: true,
    });

    const chunks = chunkMessage(answer, 1900).slice(0, 4);
    await interaction.editReply({ content: chunks[0] ?? 'Tidak ada jawaban.', allowedMentions: { parse: [] } });
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    logger.error('Gagal menjawab /tanya', errorMessage(error));
    await interaction.editReply({ content: `⚠️ ${errorMessage(error).slice(0, 300)}` });
  }
}
