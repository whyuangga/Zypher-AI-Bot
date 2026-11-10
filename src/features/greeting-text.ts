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
  user: string;
  server: string;
}

/** Isi `{user}` dan `{server}` pada template. */
export function fillText(template: string, values: TemplateValues): string {
  return template.replace(/\{user\}/g, values.user).replace(/\{server\}/g, values.server);
}
