import type { Message, TextChannel } from 'discord.js';
import { chunkMessage, truncate } from './text.js';

/** Batas aman isi pesan (Discord: 2000 karakter). */
const PREVIEW_LIMIT = 1900;
const EDIT_INTERVAL_MS = 1400;
const THINKING = '💭 *Sedang berpikir…*';

/**
 * Menampilkan jawaban AI secara bertahap di Discord.
 *
 * Discord membatasi frekuensi edit pesan, jadi teks di-flush berkala (bukan tiap token),
 * dan hanya satu pesan yang dipakai untuk preview supaya tidak spam channel.
 */
export class DiscordStreamer {
  private preview = '';
  private sentContent = '';
  private target: Message | null = null;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private closed = false;

  constructor(private readonly source: Message) {}

  /** Kirim placeholder, lalu mulai flush berkala. */
  async start(): Promise<void> {
    this.target = await this.source.reply({
      content: THINKING,
      allowedMentions: { repliedUser: false, parse: [] },
    });

    this.timer = setInterval(() => {
      void this.flush();
    }, EDIT_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Tambahkan potongan teks baru dari model. */
  push(delta: string): void {
    if (this.closed || !this.target) return;
    if (this.preview.length >= PREVIEW_LIMIT) return;
    this.preview = (this.preview + delta).slice(0, PREVIEW_LIMIT);
  }

  private renderPreview(): string {
    const text = this.preview.trim();
    if (!text) return THINKING;
    return this.preview.length >= PREVIEW_LIMIT ? `${text}\n…` : text;
  }

  private async flush(): Promise<void> {
    if (this.closed || this.flushing || !this.target) return;

    const content = this.renderPreview();
    if (content === this.sentContent) return;

    this.flushing = true;
    try {
      await this.target.edit({ content, allowedMentions: { parse: [] } });
      this.sentContent = content;
    } catch {
      // Rate limit / pesan dihapus: abaikan, edit final akan mencoba lagi.
    } finally {
      this.flushing = false;
    }
  }

  /** Selesaikan: tampilkan jawaban lengkap, sisa yang kepanjangan dikirim sebagai pesan lanjutan. */
  async finish(answer: string): Promise<void> {
    this.stopTimer();
    const chunks = chunkMessage(answer);
    const first = chunks[0] ?? THINKING;

    if (!this.target) {
      await this.sendFallback(answer);
      this.closed = true;
      return;
    }

    if (first !== this.sentContent) {
      try {
        await this.target.edit({ content: first, allowedMentions: { parse: [] } });
        this.sentContent = first;
      } catch {
        // Kalau edit final gagal, kirim sebagai pesan baru agar jawaban tidak hilang.
        await this.sendFallback(answer);
        this.closed = true;
        return;
      }
    }

    for (const chunk of chunks.slice(1)) {
      await (this.source.channel as TextChannel)
        .send({ content: chunk, allowedMentions: { parse: [] } })
        .catch(() => undefined);
    }

    this.closed = true;
  }

  /** Tandai gagal: pertahankan teks yang sudah tampil, tambahkan catatan error. */
  async fail(note: string): Promise<void> {
    this.stopTimer();
    this.closed = true;

    const partial = this.preview.trim();
    const content = partial
      ? `${truncate(partial, 1700)}\n\n⚠️ ${note}`
      : `⚠️ ${note}`;

    if (this.target) {
      await this.target.edit({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
      return;
    }

    await this.source.reply({ content, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => undefined);
  }

  private async sendFallback(answer: string): Promise<void> {
    const chunks = chunkMessage(answer);
    if (chunks.length === 0) return;
    await this.source
      .reply({ content: chunks[0] ?? '', allowedMentions: { repliedUser: false, parse: [] } })
      .catch(() => undefined);
    for (const chunk of chunks.slice(1)) {
      await (this.source.channel as TextChannel).send({ content: chunk, allowedMentions: { parse: [] } }).catch(() => undefined);
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
