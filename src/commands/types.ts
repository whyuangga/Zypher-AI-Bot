import {
  ApplicationIntegrationType,
  InteractionContextType,
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

export type CommandData = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

export interface Command {
  data: CommandData;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * Supaya slash command juga bisa dipakai di **DM bot**, command harus
 * didaftarkan sebagai *user install* dan mengizinkan konteks `BotDM`.
 *
 * Tanpa dua izin ini Discord tidak menampilkan command di DM sama sekali —
 * teks `/akhiri` lalu dikirim sebagai pesan biasa dan dijawab AI sebagai
 * pertanyaan (persis keluhan "tidak mengakhiri chat").
 *
 * `PrivateChannel` ikut diizinkan supaya command jalan di DM grup.
 */
export function dmCapable<T extends { setIntegrationTypes(...types: ApplicationIntegrationType[]): T; setContexts(...contexts: InteractionContextType[]): T }>(
  builder: T,
): T {
  return builder
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    );
}
