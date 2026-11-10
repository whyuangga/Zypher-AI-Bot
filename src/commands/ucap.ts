import { AttachmentBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { synthesizeSpeech } from '../lib/audio.js';
import { errorMessage, logger } from '../lib/logger.js';
import { requireGuild } from './helpers.js';
import type { Command } from './types.js';

/**
 * `/ucap` — ubah teks jadi pesan suara.
 * Berguna untuk aksesibilitas dan untuk mengecek kualitas suara TTS.
 */
export const ucapCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ucap')
    .setDescription('Ubah teks jadi pesan suara (text-to-speech)')
    .addStringOption((option) =>
      option.setName('teks').setDescription('Teks yang ingin diucapkan').setRequired(true).setMaxLength(1000),
    ),

  async execute(interaction) {
    if (!(await requireGuild(interaction))) return;

    if (!config.voice.enabled || !config.voice.ttsEnabled) {
      await interaction.reply({
        content: '🔇 Text-to-speech belum aktif. Set `VOICE_ENABLED=true` dan `TTS_ENABLED=true` di `.env`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const text = interaction.options.getString('teks', true).trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const speech = await synthesizeSpeech(text);
      const fileName = speech.mime === 'audio/wav' ? 'ucapan.wav' : 'ucapan.mp3';
      const file = new AttachmentBuilder(Buffer.from(speech.bytes), { name: fileName });

      await interaction.editReply({
        content: `🔊 ${text.length > 180 ? `${text.slice(0, 180)}…` : text}`,
        files: [file],
      });
    } catch (error) {
      logger.error('Gagal membuat TTS /ucap', errorMessage(error));
      await interaction
        .editReply({ content: `⚠️ Gagal membuat suara: ${errorMessage(error).slice(0, 250)}` })
        .catch(() => undefined);
    }
  },
};
