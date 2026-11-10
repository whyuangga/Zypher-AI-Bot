/**
 * Parsing "link masuk" dashboard: `/masuk/<token>` atau `/login/<token>`.
 *
 * Dipisah ke modul sendiri supaya gampang diuji (`npm run smoke`) tanpa
 * menyalakan server HTTP.
 *
 * Catatan keamanan: token di URL bisa terlihat di riwayat browser / log proxy.
 * Karena itu server langsung mengalihkan ke `/` dengan `location.replace()`,
 * yang **menggantikan** entri riwayat sehingga URL bertoken tidak tersimpan di
 * tombol Back, dan semua HTML dikirim dengan `Referrer-Policy: no-referrer`.
 */
export type LoginLinkParse =
  | { matched: false }
  | { matched: true; token: string | null };

export function parseLoginLink(pathname: string): LoginLinkParse {
  const match = /^\/(?:masuk|login)(?:\/(.*))?$/.exec(pathname);
  if (!match) return { matched: false };

  const raw = match[1];
  if (raw === undefined) return { matched: true, token: null };

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Persen-encoding rusak (mis. "%ZZ") — pakai apa adanya.
    decoded = raw;
  }

  const token = decoded.trim();
  return { matched: true, token: token || null };
}
