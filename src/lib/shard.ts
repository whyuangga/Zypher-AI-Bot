import { config } from '../config.js';

/**
 * Multi-shard sederhana: beberapa instance bot berbagi satu database
 * (Postgres), lalu tiap instance hanya menangani sebagian server.
 *
 * Contoh 2 instance:
 *
 *   Instance A → SHARD_INDEX=0 SHARD_COUNT=2
 *   Instance B → SHARD_INDEX=1 SHARD_COUNT=2
 *
 * Pembagian berdasarkan hash FNV-1a dari guild ID (stabil, tidak butuh
 * penyimpanan tambahan). `SHARD_COUNT=1` (default) berarti semua server
 * ditangani instance ini — perilaku lama tidak berubah.
 */

export interface ShardInfo {
  index: number;
  count: number;
  enabled: boolean;
}

export function shardInfo(): ShardInfo {
  const count = Math.max(1, Math.min(256, Math.round(config.database.shardCount)));
  const index = Math.max(0, Math.min(count - 1, Math.round(config.database.shardIndex)));
  return { index, count, enabled: count > 1 };
}

/** FNV-1a 32-bit — cepat, stabil antar instance, tanpa dependensi. */
export function hashGuildId(guildId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < guildId.length; index += 1) {
    hash ^= guildId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Apakah server ini milik shard kita? `SHARD_COUNT=1` selalu `true`. */
export function ownsGuild(guildId: string | null | undefined): boolean {
  const { index, count, enabled } = shardInfo();
  if (!enabled) return true;
  if (!guildId) return false;
  return hashGuildId(guildId) % count === index;
}
