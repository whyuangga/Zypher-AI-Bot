/**
 * Logger kecil tanpa dependensi.
 * Format: 12:34:56 INFO  pesan
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = (process.env.LOG_LEVEL?.trim().toLowerCase() as Level) || 'info';
const threshold = LEVEL_WEIGHT[configuredLevel] ?? LEVEL_WEIGHT.info;

function timestamp(): string {
  return new Date().toLocaleTimeString('id-ID', { hour12: false });
}

function write(level: Level, message: string, meta?: unknown): void {
  if (LEVEL_WEIGHT[level] < threshold) return;
  const prefix = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const line = `\x1b[90m${timestamp()}\x1b[0m ${prefix} ${message}`;
  if (level === 'error') console.error(line, meta ?? '');
  else if (level === 'warn') console.warn(line, meta ?? '');
  else console.log(line, meta ?? '');
}

export const logger = {
  debug: (message: string, meta?: unknown) => write('debug', message, meta),
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta),
};

/** Ubah error apa pun menjadi pesan pendek yang aman ditampilkan. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
