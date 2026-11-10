import { MessageFlags, type Interaction } from 'discord.js';
import { commandMap } from '../commands/index.js';
import { handleButton } from '../features/buttons.js';
import { errorMessage, logger } from '../lib/logger.js';
import { ownsGuild } from '../lib/shard.js';

async function reportFailure(interaction: Interaction, error: unknown): Promise<void> {
  const message = `⚠️ Terjadi kesalahan: ${errorMessage(error).slice(0, 200)}`;

  if (!interaction.isRepliable()) return;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Interaksi sudah kedaluwarsa — tidak ada yang bisa dilakukan.
  }
}

export async function onInteractionCreate(interaction: Interaction): Promise<void> {
  try {
    // Multi-shard: abaikan interaksi dari server yang bukan porsi instance ini.
    if (interaction.guildId && !ownsGuild(interaction.guildId)) return;

    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) {
        logger.warn(`Command tidak dikenal: ${interaction.commandName}`);
        return;
      }
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    logger.error(`Error saat menangani interaksi (${interaction.type})`, errorMessage(error));
    await reportFailure(interaction, error);
  }
}
