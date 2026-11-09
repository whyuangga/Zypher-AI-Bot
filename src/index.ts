import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { closeDatabase } from './db/index.js';
import { onChannelDelete } from './events/channelDelete.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { onMessageCreate } from './events/messageCreate.js';
import { errorMessage, logger } from './lib/logger.js';
import { startRateLimitJanitor } from './lib/ratelimit.js';
import { registerCommands } from './lib/register.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — aktifkan di Developer Portal
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, async (ready) => {
  logger.info(`🤖 Login sebagai ${ready.user.tag} (${ready.guilds.cache.size} server)`);

  ready.user.setPresence({
    activities: [{ name: '/panel • room AI privat', type: ActivityType.Listening }],
    status: 'online',
  });

  await registerCommands(ready);
});

client.on(Events.InteractionCreate, (interaction) => {
  void onInteractionCreate(interaction);
});

client.on(Events.MessageCreate, (message) => {
  void onMessageCreate(message);
});

client.on(Events.ChannelDelete, (channel) => {
  void onChannelDelete(channel);
});

client.on(Events.Error, (error) => logger.error('Discord client error', errorMessage(error)));
client.on(Events.Warn, (message) => logger.warn(`Discord warning: ${message}`));

process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', errorMessage(reason)));
process.on('uncaughtException', (error) => logger.error('Uncaught exception', errorMessage(error)));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn(`Menerima ${signal} — mematikan bot…`);
  try {
    client.destroy();
    closeDatabase();
  } catch (error) {
    logger.error('Gagal mematikan bot dengan bersih', errorMessage(error));
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startRateLimitJanitor();

async function main(): Promise<void> {
  logger.info(`Menghubungkan ke Discord… (model AI: ${config.ai.model})`);
  try {
    await client.login(config.discord.token);
  } catch (error) {
    const message = errorMessage(error);
    logger.error('Login Discord gagal', message);
    if (message.toLowerCase().includes('token')) {
      logger.error('Cek DISCORD_TOKEN di .env — ambil ulang dari https://discord.com/developers/applications');
    }
    closeDatabase();
    process.exit(1);
  }
}

void main();
