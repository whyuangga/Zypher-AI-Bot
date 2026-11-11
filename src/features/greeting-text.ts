/**
 * Teks cadangan (template) untuk sambutan & salam perpisahan.
 *
 * Dipisah dari `welcome.ts` supaya dashboard bisa memakainya **tanpa**
 * mengimpor discord.js: pratinjau di web harus menghasilkan teks yang persis
 * sama dengan yang dikirim bot, dan satu-satunya cara menjamin itu adalah
 * memakai fungsi yang sama.
 */

export const DEFAULT_WELCOME_TEMPLATE = 'Halo {user}, selamat datang di **{server}**! Senang kamu bergabung.';

export const DEFAULT_GOODBYE_TEMPLATE = '{user} sudah keluar dari **{server}**. Semoga urusannya lancar!';

export interface TemplateValues {
  /** Nama tampilan member — dipakai `{user}`. */
  user: string;
  server: string;
  /**
   * `<@id>` untuk `{user.mention}`. Tanpa nilai, `{user.mention}` jatuh ke nama
   * biasa supaya template tidak pernah memuat teks `<@undefined>`.
   */
  mention?: string;
  /** `nama#1234` untuk `{user.tag}`. */
  tag?: string;
  /** `{memberCount}` / `{membercount}`. */
  memberCount?: number;
}

/**
 * Token yang didukung.
 *
 * Awalnya hanya `{user}` dan `{server}`. Dua bot pembanding (ai-discord-chat
 * dan TitanBot) sama-sama memakai kumpulan token yang lebih kaya, jadi nama
 * yang paling sering dipakai di sana ikut didukung di sini.
 *
 * `{user}` sengaja tetap berarti **nama tampilan**, bukan mention: perilaku
 * lama dipertahankan supaya template yang sudah disimpan admin tidak berubah
 * arti diam-diam.
 */
export function fillText(template: string, values: TemplateValues): string {
  const name = values.user;
  const mention = values.mention ?? name;
  const tokens: Array<[string | RegExp, string]> = [
    ['{user.mention}', mention],
    ['{user.name}', name],
    ['{user}', name],
    ['{user.tag}', values.tag ?? name],
    ['{server.name}', values.server],
    ['{server}', values.server],
    ['{memberCount}', String(values.memberCount ?? '')],
    ['{membercount}', String(values.memberCount ?? '')],
  ];

  // Satu lintasan: token yang lebih spesifik didahulukan, dan hasil penggantian
  // tidak pernah diperiksa ulang (menghindari penggantian berantai).
  let result = template;
  for (const [token, value] of tokens) {
    result = result.split(String(token)).join(value);
  }
  return result;
}

/** Daftar token untuk ditampilkan di dashboard. */
export const TEMPLATE_TOKENS: Array<{ token: string; arti: string }> = [
  { token: '{user}', arti: 'nama panggilan member' },
  { token: '{user.mention}', arti: 'tag member (hanya jalan di teks biasa, bukan embed)' },
  { token: '{user.tag}', arti: 'username lengkap' },
  { token: '{server}', arti: 'nama server' },
  { token: '{memberCount}', arti: 'jumlah member saat ini' },
];
