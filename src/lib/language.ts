/**
 * Deteksi bahasa user secara heuristik ringan (tanpa dependency NLP).
 *
 * Cocok untuk Discord: token Indonesia ("aku", "kamu", "ya", "nggak", "gimana"...)
 * dan token Inggris ("what", "how", "you", "please"...). Tidak sempurna, tapi
 * cukup untuk memberi hint ke model agar menjawab dalam bahasa yang sama.
 */
const ID_MARKERS = new Set([
  'aku', 'kamu', 'ya', 'dan', 'yang', 'untuk', 'tidak', 'saya', 'kita', 'nama',
  'bagaimana', 'mana', 'kapan', 'siapa', 'dari', 'dengan', 'atau', 'ini', 'itu',
  'bisa', 'mau', 'nggak', 'dong', 'guys', 'selamat', 'terima', 'masih', 'udah',
  'gimana', 'kemarin', 'pagi', 'siang', 'malam', 'gratis', 'berapa', 'agar',
  'tetapi', 'saat', 'apa', 'telah', 'sudah', 'akan', 'juga', 'karena', 'jika',
  'ketika', 'dulu', 'baru', 'lain', 'sama', 'oke', 'iya', 'bet', 'nih', 'lah',
  'loh', 'deh', 'sih', 'wp', 'wp', 'iya', 'iya',
]);

const EN_MARKERS = new Set([
  'what', 'how', 'why', 'when', 'where', 'who', 'can', 'you', 'i', 'is', 'are',
  'do', 'does', 'to', 'the', 'and', 'my', 'please', 'tell', 'me', 'about',
  'help', 'thanks', 'thank', 'hello', 'hi', 'there', 'this', 'that', 'want',
  'need', 'know', 'get', 'have', 'has', 'was', 'were', 'will', 'would',
  'could', 'should', 'not', 'no', 'yes', 'ok', 'okay', 'good', 'fine', 'great',
  'nice', 'one', 'two', 'first', 'then', 'so', 'if', 'or', 'but', 'because',
  'with', 'from', 'at', 'on', 'in', 'it', 'its', 'your', 'our', 'we', 'they',
  'he', 'she', 'them', 'us', 'him', 'her', 'been', 'being', 'also', 'just',
  'very', 'much', 'many', 'more', 'most', 'only', 'even', 'now', 'here',
  'time', 'day', 'today', 'sorry', 'hey', 'lol', 'btw', 'fyi', 'sure', 'alright',
  'right', 'really', 'actually', 'something', 'anything', 'everything',
]);

export type LanguageCode = 'id' | 'en' | 'unknown';

export function detectLanguage(text: string): LanguageCode {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  let idScore = 0;
  let enScore = 0;

  for (const token of tokens) {
    if (ID_MARKERS.has(token)) idScore += 1;
    if (EN_MARKERS.has(token)) enScore += 1;
  }

  if (idScore > 0 && idScore >= enScore) return 'id';
  if (enScore > idScore) return 'en';
  return 'unknown';
}
