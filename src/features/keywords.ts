import { listKeywords, type Keyword } from '../db/repo.js';
import { normalize } from '../lib/text.js';

/**
 * Cari keyword yang relevan dengan pesan user.
 *
 * Aturan skor:
 *  1. Trigger muncul utuh di pesan        -> skor tinggi (kata lebih banyak = lebih spesifik)
 *  2. >= 60% kata pada trigger muncul     -> skor menengah (toleran terhadap variasi kalimat)
 *
 * Tujuannya: user boleh bertanya dengan kalimat bebas, bukan harus persis
 * seperti trigger yang disimpan admin.
 */
export function matchKeywords(guildId: string, message: string, limit = 3): Keyword[] {
  const haystack = normalize(message);
  if (!haystack) return [];

  const padded = ` ${haystack} `;
  const scored: Array<{ keyword: Keyword; score: number }> = [];

  for (const keyword of listKeywords(guildId, 200)) {
    const trigger = normalize(keyword.trigger);
    if (!trigger) continue;

    let score = 0;

    if (padded.includes(` ${trigger} `)) {
      score = 10 + trigger.split(' ').length * 2;
    } else if (haystack.includes(trigger)) {
      score = 8;
    } else {
      const tokens = trigger.split(' ').filter((token) => token.length > 2);
      if (tokens.length === 0) continue;
      const hits = tokens.filter((token) => haystack.includes(token)).length;
      const ratio = hits / tokens.length;
      if (ratio >= 0.6) score = ratio * 5;
    }

    if (score > 0) scored.push({ keyword, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.keyword);
}
