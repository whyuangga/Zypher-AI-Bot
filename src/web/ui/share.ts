import type { PostBlock } from '../../features/custom-post.js';
import type { EmbedExtra } from '../../features/post-embed.js';

/**
 * Halaman pratinjau publik untuk tautan berbagi (`/bagi/<token>`).
 *
 * Kenapa halaman terpisah, bukan memakai halaman dashboard: halaman ini
 * dibuka TANPA login, jadi tidak boleh memuat shell dashboard, menu, atau
 * tautan balik ke panel. Yang tampil hanya blok pesan yang dibagikan —
 * hasilnya bisa dikirim ke siapa pun lewat chat tanpa memberi mereka akses
 * ke server Discord-nya.
 *
 * Blok di sini digambar dengan pendekatan yang sama seperti pratinjau di
 * halaman /pesan: kartu (container) berisi teks, pemisah, galeri gambar,
 * dan tombol link. Blok yang butuh data server (tombol role, select, aksi)
 * tampil sebagai labelnya saja — memang tidak bisa dijalankan dari sini.
 */

function esc(teks: string): string {
  return teks
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Markdown Discord -> HTML, hanya yang aman dan lazim dipakai pesan:
 * tebal, miring, garis bawah, coret, kode, dan baris kecil (-#).
 *
 * Escaping dilakukan SEBELUM penanda diubah jadi tag, sehingga teks isi
 * tidak bisa menyelipkan HTML sendiri.
 */
function markdown(teks: string): string {
  let hasil = esc(teks);
  hasil = hasil.replace(/^-# (.*)$/gm, '<span class="kecil">$1</span>');
  hasil = hasil.replace(/```([\s\S]*?)```/g, (_m, isi: string) => `<pre>${isi}</pre>`);
  hasil = hasil.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  hasil = hasil.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  hasil = hasil.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  hasil = hasil.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  hasil = hasil.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  hasil = hasil.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  hasil = hasil.replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler">$1</span>');
  return hasil.replace(/\n/g, '<br>');
}

/** Blok bermasalah (URL aneh, dsb) tidak boleh jadi tag. */
function urlAman(url: string | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function tombol(blok: PostBlock): string {
  const label = `Tombol: ${esc(blok.value || '(tanpa label)')}`;
  const url = urlAman(blok.url);
  if (!url) return `<span class="tombol mati">${label}</span>`;
  return `<a class="tombol" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
}

function gambar(blok: PostBlock): string {
  const url = urlAman(blok.data ?? blok.value);
  if (!url) return '<span class="mati">(gambar tidak bisa ditampilkan)</span>';
  return `<img class="gambar" src="${esc(url)}" alt="Gambar pesan">`;
}

function blokHtml(blok: PostBlock): string {
  switch (blok.kind) {
    case 'text':
    case 'section':
      return `<div class="teks">${markdown(blok.value)}</div>`;
    case 'divider':
      return blok.divider === false ? '<div class="jarak"></div>' : '<hr>';
    case 'image':
      return gambar(blok);
    case 'button':
      return tombol(blok);
    case 'row':
      return '<div class="jarak-row"></div>';
    case 'select':
      return `<span class="tombol mati">Menu pilihan: ${esc(blok.placeholder || blok.value || 'tanpa judul')}</span>`;
    case 'file':
      return `<span class="tombol mati">Lampiran: ${esc(blok.name || blok.value || 'berkas')}</span>`;
    case 'container':
    case 'close':
      return '';
    default:
      return '';
  }
}

/**
 * Susun kartu-kartu seperti di Discord: blok dibuka dengan `container`
 * (membawa warna aksen), ditutup `close`, dan blok di luar container tampil
 * langsung di badan pesan.
 */
function render(blocks: PostBlock[]): string {
  const bagian: string[] = [];
  let dalamKartu = false;
  let aksen = 'none';
  let isiKartu: string[] = [];

  const tutupKartu = (): void => {
    if (!dalamKartu) return;
    bagian.push(`<div class="kartu" data-aksen="${esc(aksen)}">${isiKartu.join('')}</div>`);
    isiKartu = [];
    dalamKartu = false;
    aksen = 'none';
  };

  for (const blok of blocks) {
    if (blok.kind === 'container') {
      tutupKartu();
      dalamKartu = true;
      const warna = String(blok.accent ?? '').trim();
      aksen = /^#[0-9a-fA-F]{6}$/.test(warna) ? warna.toLowerCase() : 'none';
      if (blok.value) isiKartu.push(`<div class="teks">${markdown(blok.value)}</div>`);
      continue;
    }
    if (blok.kind === 'close') {
      tutupKartu();
      continue;
    }
    if (dalamKartu) isiKartu.push(blokHtml(blok));
    else bagian.push(`<div class="luar">${blokHtml(blok)}</div>`);
  }
  tutupKartu();
  return bagian.join('');
}

/**
 * Kartu embed klasik untuk halaman berbagi.
 *
 * Tanpa ini, pesan berbentuk embed dibagikan sebagai halaman KOSONG: bloknya
 * memang tidak ada, karena isi embed datang dari pengaturan pesan. Yang
 * ditampilkan hanya bagian yang tersimpan (penulis, judul, bidang, footer) —
 * cukup untuk menunjukkan isi pesan tanpa perlu bot.
 */
function renderEmbed(name: string, embed: EmbedExtra[], blocks: PostBlock[]): string {
  const utama = embed[0] ?? null;
  const judul = name.trim();
  const isiBlok = blocks
    .filter((blok) => blok.kind === 'text' || blok.kind === 'section')
    .map((blok) => String(blok.value ?? '').trim())
    .filter(Boolean)
    .join('<br>');
  const gambar = blocks.find((blok) => blok.kind === 'image')?.value;

  const kartu: string[] = [];
  if (utama?.author?.name) {
    kartu.push(`<div class="embed-penulis">${esc(String(utama.author.name))}</div>`);
  }
  if (judul) kartu.push(`<div class="embed-judul">${esc(judul)}</div>`);
  if (isiBlok) kartu.push(`<div class="embed-isi">${markdown(isiBlok.replace(/<br>/g, '\n'))}</div>`);
  if (utama?.fields?.length) {
    const bidang = utama.fields
      .map(
        (satu) =>
          `<div class="embed-bidang"><b>${esc(String(satu.name))}</b><br>${esc(String(satu.value))}</div>`,
      )
      .join('');
    kartu.push(`<div class="embed-bidang-wrap">${bidang}</div>`);
  }
  const gambarAman = urlAman(gambar);
  if (gambarAman) kartu.push(`<img class="gambar" src="${esc(gambarAman)}" alt="">`);
  if (utama?.footer?.text) {
    kartu.push(
      `<div class="embed-footer">${esc(String(utama.footer.text))}${
        utama.timestamp ? ' · ' + esc(String(utama.timestamp)) : ''
      }</div>`,
    );
  } else if (utama?.timestamp) {
    kartu.push(`<div class="embed-footer">${esc(String(utama.timestamp))}</div>`);
  }

  const warna = /^#[0-9a-fA-F]{6}$/.test(String(utama?.color ?? '')) ? String(utama?.color).toLowerCase() : 'none';
  const tambahan = embed
    .slice(1)
    .map((satu) => {
      const bagian: string[] = [];
      if (satu.author?.name) bagian.push(`<div class="embed-penulis">${esc(String(satu.author.name))}</div>`);
      if (satu.fields?.length) {
        bagian.push(
          `<div class="embed-bidang-wrap">${satu.fields
            .map((f) => `<div class="embed-bidang"><b>${esc(String(f.name))}</b><br>${esc(String(f.value))}</div>`)
            .join('')}</div>`,
        );
      }
      if (!bagian.length) return '';
      const warnaLain = /^#[0-9a-fA-F]{6}$/.test(String(satu.color ?? '')) ? String(satu.color).toLowerCase() : 'none';
      return `<div class="kartu" data-aksen="${esc(warnaLain)}">${bagian.join('')}</div>`;
    })
    .join('');

  if (kartu.length === 0 && !tambahan) {
    return '<div class="kartu kosong"><p>Pesan ini tidak punya isi yang bisa ditampilkan.</p></div>';
  }
  return (
    (kartu.length ? `<div class="kartu" data-aksen="${esc(warna)}">${kartu.join('')}</div>` : '') + tambahan
  );
}

export function sharePage(input: {
  name: string;
  blocks: PostBlock[];
  /** Bentuk pesan; embed dibaca dari bagian admin, bukan dari blok. */
  layout?: 'container' | 'embed';
  embed?: EmbedExtra[];
  notFound: boolean;
}): string {
  const judul = input.name.trim() || 'Pesan dibagikan';
  const isi = input.notFound
    ? '<div class="kartu kosong"><p>Tautan ini tidak berlaku lagi. Admin bisa mencabut tautan berbagi kapan saja — minta tautan baru kalau masih dibutuhkan.</p></div>'
    : input.layout === 'embed'
      ? renderEmbed(input.name, input.embed ?? [], input.blocks)
      : render(input.blocks);

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(judul)} — pratinjau pesan</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 48px; background: #1e1f22; color: #dbdee1;
    font: 15px/1.5 "gg sans", "Segoe UI", Roboto, sans-serif; }
  main { max-width: 680px; margin: 0 auto; }
  .kepala { display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
    padding-bottom: 12px; border-bottom: 1px solid #3f4147; }
  .kepala h1 { font-size: 16px; font-weight: 600; margin: 0; color: #f2f3f5; }
  .kepala span { font-size: 12px; color: #949ba4; }
  .kartu { background: #2b2d31; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px;
    border-left: 4px solid #4e5058; overflow-wrap: anywhere; }
  .kartu[data-aksen="#5865f2"] { border-left-color: #5865f2; }
  .kartu[data-aksen="#23a55a"] { border-left-color: #23a55a; }
  .kartu[data-aksen="#f23f43"] { border-left-color: #f23f43; }
  .kartu[data-aksen="#f0b232"] { border-left-color: #f0b232; }
  .kartu.kosong { border-left-color: #f0b232; }
  .luar { margin: 6px 0; overflow-wrap: anywhere; }
  .teks { white-space: normal; }
  .kecil { font-size: 12px; color: #b5bac1; }
  hr { border: 0; border-top: 1px solid #3f4147; margin: 10px 0; }
  .jarak { height: 10px; }
  .jarak-row { height: 4px; }
  code { background: #1e1f22; padding: 1px 4px; border-radius: 4px; font-size: 13px; }
  pre { background: #1e1f22; padding: 10px; border-radius: 6px; overflow-x: auto;
    font-size: 13px; border: 1px solid #3f4147; }
  .spoiler { background: #1e1f22; border-radius: 4px; color: transparent; }
  .spoiler:hover { color: inherit; }
  .gambar { display: block; max-width: 100%; border-radius: 6px; margin: 6px 0; }
  .tombol { display: inline-block; margin: 4px 6px 4px 0; padding: 6px 14px; border-radius: 4px;
    background: #4e5058; color: #fff; text-decoration: none; font-size: 14px; }
  .tombol.mati { background: #383a40; color: #b5bac1; cursor: default; }
  .mati { color: #949ba4; font-size: 13px; }
  /* Embed klasik: bagian-bagiannya mengikuti tampilan Discord. */
  .embed-penulis { font-size: 13px; font-weight: 600; color: #f2f3f5; margin-bottom: 4px; }
  .embed-judul { font-size: 15px; font-weight: 600; color: #f2f3f5; margin-bottom: 6px; }
  .embed-isi { font-size: 14px; color: #dbdee1; }
  .embed-bidang-wrap { margin-top: 8px; }
  .embed-bidang { font-size: 13px; color: #b5bac1; margin-bottom: 6px; }
  .embed-bidang b { color: #f2f3f5; }
  .embed-footer { font-size: 12px; color: #949ba4; margin-top: 8px; }
  footer { max-width: 680px; margin: 20px auto 0; font-size: 12px; color: #949ba4; }
</style>
</head>
<body>
<main>
  <div class="kepala">
    <h1>${esc(judul)}</h1>
    <span>pratinjau pesan yang dibagikan</span>
  </div>
  ${isi}
</main>
<footer>Halaman ini hanya pratinjau. Tidak ada tombol yang mengubah role dan tidak ada data server yang ditampilkan.</footer>
</body>
</html>`;
}
