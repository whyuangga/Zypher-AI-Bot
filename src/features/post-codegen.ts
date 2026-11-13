/**
 * Generator kode untuk developer: payload komponen → potongan kode bot.
 *
 * Padanan "Code generator" di Discohook. Discohook membangkitkan kode dari
 * `message.data.components` (JSON hasil editor), bukan dari state editornya —
 * dan itu penting: yang dihasilkan jadi PERSIS sama dengan yang dikirim, bukan
 * terjemahan kedua yang bisa menyimpang.
 *
 * Di sini masukannya juga JSON komponen hasil `buildPostPayload`, jadi kode
 * yang dihasilkan memakai bentuk yang benar-benar diterima Discord.
 *
 * Dua pustaka:
 *   - discord.js v14 — gaya builder (`.setContent(...)`), seperti Discohook;
 *   - discord.py v2  — gaya konstruktor (`ui.TextDisplay(...)`).
 *
 * Komponen yang tidak dikenal TIDAK dilewati diam-diam: ia muncul sebagai
 * komentar di kode dan dicatat di `dropped`, supaya developer tahu ada bagian
 * pesan yang tidak ikut tergenerate.
 */

export const CODEGEN_LIBRARIES = ['djs14', 'dpy2'] as const;
export type CodegenLibrary = (typeof CODEGEN_LIBRARIES)[number];

export const CODEGEN_LABEL: Record<CodegenLibrary, string> = {
  djs14: 'discord.js v14',
  dpy2: 'discord.py v2',
};

export interface CodegenResult {
  imports: string[];
  code: string[];
  documentation: string;
  /** Bagian yang tidak bisa diterjemahkan, dalam bahasa manusia. */
  dropped: string[];
}

/** Tipe komponen Discord yang dipakai pesan container (Components V2). */
const T = {
  actionRow: 1,
  button: 2,
  stringSelect: 3,
  textInput: 4,
  userSelect: 5,
  roleSelect: 6,
  mentionableSelect: 7,
  channelSelect: 8,
  textDisplay: 10,
  thumbnail: 11,
  mediaGallery: 12,
  /* Components V2: 13 = Section, 14 = Separator, 15 = File. */
  section: 13,
  separator: 14,
  file: 15,
  container: 17,
} as const;

/** Gaya tombol Discord → nama konstanta. */
const BUTTON_STYLE: Record<number, string> = {
  1: 'Primary',
  2: 'Secondary',
  3: 'Success',
  4: 'Danger',
  5: 'Link',
};

/**
 * Escape string untuk kode sumber.
 *
 * Backslash, tanda kutip, dan baris baru WAJIB di-escape: teks pesan dibuat
 * admin dan sering berisi `"` atau beberapa baris. Tanpa ini, kode hasil
 * generate tidak bisa dijalankan sama sekali.
 */
export function quoteStr(text: string, q: '"' | "'" = '"'): string {
  const escaped = String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(q === '"' ? '"' : "'", 'g'), `\\${q}`)
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return q + escaped + q;
}

function indent(lines: string[], spaces: number): string[] {
  const pad = ' '.repeat(spaces);
  return lines.map((line) => (line ? pad + line : line));
}

/**
 * Komentar `# …` (gaya Python) jadi `// …` (gaya JavaScript).
 *
 * Komentar tidak boleh menempel pada pemanggilan builder — `.addComponents(# …)`
 * bukan JavaScript yang sah. Karena itu komentar selalu dipindah ke barisnya
 * sendiri sebelum ditempel.
 */
function komentarDjs(baris: string[]): string[] {
  return baris.map((satu) => (/^\s*#/.test(satu) ? satu.replace(/^(\s*)#\s?/, '$1// ') : satu));
}

/**
 * Kode untuk pesan BERGAYA EMBED klasik.
 *
 * Generator komponen tidak bisa dipakai: pesan embed TIDAK punya komponen
 * (dan Discord menolak keduanya sekaligus). Tanpa jalur ini, halaman
 * menampilkan "pesan ini belum punya komponen" untuk pesan embed yang jelas
 * berisi — dan admin menyimpulkan generatornya rusak.
 */
export function generateEmbedCodegen(
  embeds: unknown[],
  library: CodegenLibrary,
  opsi: { quoteStyle?: '"' | "'"; threadName?: string | null; flags?: number } = {},
): CodegenResult {
  const q = opsi.quoteStyle === "'" ? "'" : '"';
  const dropped: string[] = [];
  const daftar = (Array.isArray(embeds) ? embeds : []).filter(
    (satu): satu is Record<string, unknown> => Boolean(satu) && typeof satu === 'object' && !Array.isArray(satu),
  );
  if (daftar.length === 0) {
    return {
      imports: [],
      code:
        library === 'dpy2'
          ? ['# Pesan ini belum punya embed yang bisa dikirim.']
          : ['// Pesan ini belum punya embed yang bisa dikirim.'],
      documentation:
        library === 'dpy2'
          ? 'https://discordpy.readthedocs.io/en/stable/api.html#discord.Embed'
          : 'https://discord.js.org/docs/packages/builders/main/EmbedBuilder:Class',
      dropped,
    };
  }

  /*
   * Payload embed ditulis sebagai objek apa adanya, bukan diterjemahkan ke
   * builder satu per satu: bentuknya sudah payload Discord (judul, isi,
   * bidang, gambar), jadi yang paling jujur adalah menampilkan yang benar-benar
   * dikirim. Terjemahan ke builder justru menambah peluang menyimpang.
   */
  const json = JSON.stringify(daftar, null, 2);
  if (library === 'dpy2') {
    const barisJson = json.split('\n').map((satu) => (satu ? `    ${satu}` : satu));
    return {
      imports: ['import discord'],
      code: [
        'embeds = json.loads(',
        "    '''",
        ...barisJson,
        "    '''",
        ')',
        'embeds = [discord.Embed.from_dict(satu) for satu in embeds]',
        '# lalu kirim: await channel.send(embeds=embeds)',
        ...(opsi.threadName
          ? [
              '# nama thread:',
              `# await channel.send(embeds=embeds, thread_name=${quoteStr(opsi.threadName, q)})`,
            ]
          : []),
      ],
      documentation: 'https://discordpy.readthedocs.io/en/stable/api.html#discord.Embed',
      dropped: [...dropped, 'kode memakai json.loads — tambahkan "import json" di berkas bot'],
    };
  }

  return {
    imports: [],
    code: [
      `const embeds = ${json};`,
      '',
      'await channel.send({',
      '  embeds,',
      ...(opsi.flags ? ['  // flag admin (tanpa kartu tautan / tanpa notifikasi)', `  flags: ${opsi.flags},`] : []),
      ...(opsi.threadName ? [`  thread_name: ${quoteStr(opsi.threadName, q)},`] : []),
      '});',
    ],
    documentation: 'https://discord.js.org/docs/packages/builders/main/EmbedBuilder:Class',
    dropped,
  };
}

/**
 * Beri koma pada baris terakhir satu blok — kecuali blok itu komentar.
 *
 * Komentar di dalam array bukan elemen, jadi `# komponen tipe 99 …,` membuat
 * baris itu terbaca seperti elemen yang memuat teks asing (dan di Python justru
 * menggabungkan komentar dengan elemen berikutnya).
 */
function beriKoma(baris: string[]): string[] {
  if (baris.length === 0) return baris;
  const komentar = (satu: string) => /^\s*(#|\/\/)/.test(satu);
  if (komentar(baris[0]!) || komentar(baris[baris.length - 1]!)) return baris;
  baris[baris.length - 1] = `${baris[baris.length - 1]},`;
  return baris;
}

interface Komponen {
  type?: number;
  [kunci: string]: unknown;
}

function tipe(komponen: Komponen): number {
  return Number(komponen.type ?? 0);
}

/** Baris komentar untuk komponen yang tidak dikenal. */
function komentarTakDikenal(komponen: Komponen, dropped: string[]): string[] {
  const nomor = tipe(komponen);
  const alasan = `komponen tipe ${nomor || '?'} belum didukung generator kode`;
  dropped.push(alasan);
  return [`# ${alasan} — lihat JSON pesannya`];
}

/* ------------------------------------------------------------------ */
/*  discord.js v14                                                     */
/* ------------------------------------------------------------------ */

const DJS_BASE = ['ActionRowBuilder', 'ContainerBuilder', 'MessageFlags', 'TextDisplayBuilder'];

/** Satu blok = satu builder utuh, dipakai juga saat menyusun container. */
function djsNode(
  komponen: Komponen,
  q: '"' | "'",
  need: Set<string>,
  dropped: string[],
): string[] {
  const jenis = tipe(komponen);
  switch (jenis) {
    case T.textDisplay:
      return [
        [
          'new TextDisplayBuilder()',
          `    .setContent(${quoteStr(String(komponen.content ?? ''), q)})`,
        ].join('\n'),
      ];

    case T.separator: {
      need.add('SeparatorBuilder');
      const garis = ['new SeparatorBuilder()'];
      if (komponen.spacing === 2) {
        need.add('SeparatorSpacingSize');
        garis.push('    .setSpacing(SeparatorSpacingSize.Large)');
      }
      if (komponen.divider === false) garis.push('    .setDivider(false)');
      return [garis.join('\n')];
    }

    case T.section: {
      need.add('SectionBuilder');
      const garis = ['new SectionBuilder()'];
      for (const isi of (komponen.components as Komponen[] | undefined) ?? []) {
        if (tipe(isi) !== T.textDisplay) continue;
        garis.push(
          `    .addTextDisplayComponents(new TextDisplayBuilder().setContent(${quoteStr(
            String(isi.content ?? ''),
            q,
          )}))`,
        );
      }
      const aksesori = komponen.accessory as Komponen | undefined;
      if (aksesori && tipe(aksesori) === T.button) {
        const tombol = djsControl(aksesori, q, need, dropped);
        garis.push(`    .setButtonAccessory(${tombol[0]}`);
        garis.push(...tombol.slice(1).map((baris) => `    ${baris}`));
        garis[garis.length - 1] = `${garis[garis.length - 1]})`;
      } else if (aksesori && tipe(aksesori) === T.thumbnail) {
        need.add('ThumbnailBuilder');
        garis.push(
          `    .setThumbnailAccessory(new ThumbnailBuilder().setURL(${quoteStr(
            String((aksesori.media as { url?: string } | undefined)?.url ?? ''),
            q,
          )}))`,
        );
      }
      return [garis.join('\n')];
    }

    case T.mediaGallery: {
      need.add('MediaGalleryBuilder');
      need.add('MediaGalleryItemBuilder');
      const garis = ['new MediaGalleryBuilder()'];
      const item = ((komponen.items as Komponen[] | undefined) ?? []).map((satu) => {
        const media = (satu.media as { url?: string } | undefined)?.url ?? '';
        const bagian = [`new MediaGalleryItemBuilder().setURL(${quoteStr(String(media), q)})`];
        if (satu.description) bagian.push(`.setDescription(${quoteStr(String(satu.description), q)})`);
        if (satu.spoiler === true) bagian.push('.setSpoiler(true)');
        return bagian.join('');
      });
      if (item.length) garis.push(`    .addItems(${item.join(', ')})`);
      return [garis.join('\n')];
    }

    case T.file: {
      need.add('FileBuilder');
      const garis = ['new FileBuilder()'];
      garis.push(
        `    .setURL(${quoteStr(String((komponen.file as { url?: string } | undefined)?.url ?? ''), q)})`,
      );
      if (komponen.spoiler === true) garis.push('    .setSpoiler(true)');
      return [garis.join('\n')];
    }

    case T.container: {
      need.add('ContainerBuilder');
      const garis = ['new ContainerBuilder()'];
      if (komponen.accent_color !== undefined && komponen.accent_color !== null) {
        garis.push(`    .setAccentColor(${Number(komponen.accent_color)})`);
      }
      if (komponen.spoiler === true) garis.push('    .setSpoiler(true)');
      for (const isi of (komponen.components as Komponen[] | undefined) ?? []) {
        const dalam = komentarDjs(djsNode(isi, q, need, dropped));
        if (!dalam.length) continue;
        const baris = dalam[0]!.split('\n');
        /*
         * Komponen tak dikenal: jangan dibungkus `.addComponents(...)` —
         * komentar bukan argumen. Cukup barisnya sendiri di dalam kurung.
         */
        if (baris[0]!.trim().startsWith('//')) {
          garis.push(...baris.map((satu) => `    ${satu.trim()}`));
          continue;
        }
        garis.push(`    .addComponents(${baris[0]}`);
        garis.push(...baris.slice(1).map((satu) => `    ${satu}`));
        garis[garis.length - 1] = `${garis[garis.length - 1]})`;
      }
      return [garis.join('\n')];
    }

    case T.actionRow: {
      need.add('ActionRowBuilder');
      const isi = (komponen.components as Komponen[] | undefined) ?? [];
      const garis = ['new ActionRowBuilder().addComponents('];
      for (const satu of isi) {
        // Isi ActionRow SELALU tombol/select: lewat jalur kontrol, bukan node
        // biasa — tanpa itu tombol jadi "komponen tak dikenal".
        const dalam = djsControl(satu, q, need, dropped);
        garis.push(...dalam.map((teks) => `    ${teks}`));
        garis[garis.length - 1] = `${garis[garis.length - 1]},`;
      }
      garis.push(')');
      return [garis.join('\n')];
    }

    default:
      return [komentarTakDikenal(komponen, dropped).join('\n')];
  }
}

/** Tombol & select selalu berada di dalam ActionRow. */
function djsControl(komponen: Komponen, q: '"' | "'", need: Set<string>, dropped: string[]): string[] {
  const jenis = tipe(komponen);

  if (jenis === T.button) {
    need.add('ButtonBuilder');
    need.add('ButtonStyle');
    const garis = ['new ButtonBuilder()'];
    const gaya = BUTTON_STYLE[Number(komponen.style ?? 0)] ?? 'Secondary';
    garis.push(`    .setStyle(ButtonStyle.${gaya})`);
    if (komponen.label !== undefined) garis.push(`    .setLabel(${quoteStr(String(komponen.label), q)})`);
    if (komponen.emoji) {
      const emoji = komponen.emoji as { id?: string; name?: string };
      garis.push(
        emoji.id
          ? `    .setEmoji(${quoteStr(emoji.id, q)})`
          : `    .setEmoji(${quoteStr(String(emoji.name ?? ''), q)})`,
      );
    }
    if (komponen.custom_id) garis.push(`    .setCustomId(${quoteStr(String(komponen.custom_id), q)})`);
    if (komponen.url) garis.push(`    .setURL(${quoteStr(String(komponen.url), q)})`);
    if (komponen.disabled === true) garis.push('    .setDisabled(true)');
    return garis;
  }

  if (
    jenis === T.stringSelect ||
    jenis === T.userSelect ||
    jenis === T.roleSelect ||
    jenis === T.mentionableSelect ||
    jenis === T.channelSelect
  ) {
    const nama =
      jenis === T.userSelect
        ? 'UserSelectMenuBuilder'
        : jenis === T.roleSelect
          ? 'RoleSelectMenuBuilder'
          : jenis === T.mentionableSelect
            ? 'MentionableSelectMenuBuilder'
            : jenis === T.channelSelect
              ? 'ChannelSelectMenuBuilder'
              : 'StringSelectMenuBuilder';
    need.add(nama);

    const garis = [`new ${nama}()`];
    if (komponen.custom_id) garis.push(`    .setCustomId(${quoteStr(String(komponen.custom_id), q)})`);
    if (komponen.placeholder) {
      garis.push(`    .setPlaceholder(${quoteStr(String(komponen.placeholder), q)})`);
    }
    /*
     * Pilihan bawaan (`default_values`) tidak diperiksa ulang di sini: nilainya
     * datang dari payload yang sudah disaring server. Memeriksa lagi di
     * generator hanya menambah tempat yang bisa menyimpang.
     */
    const bawaan = komponen.default_values as string[] | undefined;
    if (bawaan?.length) {
      const kunci = jenis === T.stringSelect ? 'values' : 'ids';
      garis.push(
        `    .setDefaultValues({ ${kunci}: [${bawaan.map((satu) => quoteStr(satu, q)).join(', ')}] })`,
      );
    }
    if (Number(komponen.min_values) > 0) garis.push(`    .setMinValues(${Number(komponen.min_values)})`);
    if (Number(komponen.max_values) > 0) garis.push(`    .setMaxValues(${Number(komponen.max_values)})`);
    if (komponen.disabled === true) garis.push('    .setDisabled(true)');
    for (const opsi of (komponen.options as Komponen[] | undefined) ?? []) {
      need.add('StringSelectMenuOptionBuilder');
      garis.push('    .addOptions(');
      garis.push(`        new StringSelectMenuOptionBuilder()`);
      garis.push(`            .setLabel(${quoteStr(String(opsi.label ?? ''), q)})`);
      garis.push(`            .setValue(${quoteStr(String(opsi.value ?? ''), q)})`);
      if (opsi.description) {
        garis.push(`            .setDescription(${quoteStr(String(opsi.description), q)})`);
      }
      garis[garis.length - 1] = `${garis[garis.length - 1]},`;
      garis.push('    )');
    }
    return garis;
  }

  return komentarTakDikenal(komponen, dropped);
}

function djs(
  komponen: Komponen[],
  q: '"' | "'",
  dropped: string[],
): { imports: string[]; code: string[] } {
  const need = new Set<string>(DJS_BASE);
  const blok: string[] = [];

  for (const satu of komponen) {
    if (tipe(satu) === T.actionRow) {
      // ActionRow di sini berisi tombol/select; `djsNode` menanganinya, tetapi
      // isinya harus lewat jalur kontrol supaya gaya tombol/label ikut.
      need.add('ActionRowBuilder');
      const isi = (satu.components as Komponen[] | undefined) ?? [];
      const garis = ['new ActionRowBuilder().addComponents('];
      for (const kontrol of isi) {
        const dalam = djsControl(kontrol, q, need, dropped);
        garis.push(...dalam.map((teks) => `    ${teks}`));
        garis[garis.length - 1] = `${garis[garis.length - 1]},`;
      }
      garis.push(')');
      blok.push(garis.join('\n'));
      continue;
    }
    const dalam = djsNode(satu, q, need, dropped);
    blok.push(...dalam);
  }

  return { imports: [...need].sort(), code: blok };
}

/* ------------------------------------------------------------------ */
/*  discord.py v2                                                      */
/* ------------------------------------------------------------------ */

function dpyNode(komponen: Komponen, q: '"' | "'", dropped: string[]): string[] {
  const jenis = tipe(komponen);
  switch (jenis) {
    case T.textDisplay:
      return [['ui.TextDisplay(', `    ${quoteStr(String(komponen.content ?? ''), q)},`, ')'].join('\n')];

    case T.separator: {
      const garis = ['ui.Separator('];
      if (komponen.spacing === 2) garis.push('    spacing=discord.SeparatorSpacingSize.large,');
      if (komponen.divider === false) garis.push('    visible=False,');
      garis.push(')');
      return [garis.join('\n')];
    }

    case T.section: {
      const garis = ['ui.Section('];
      for (const isi of (komponen.components as Komponen[] | undefined) ?? []) {
        if (tipe(isi) !== T.textDisplay) continue;
        garis.push(`    ui.TextDisplay(${quoteStr(String(isi.content ?? ''), q)}),`);
      }
      const aksesori = komponen.accessory as Komponen | undefined;
      if (aksesori && tipe(aksesori) === T.button) {
        garis.push('    accessory=discord.ui.Button(');
        if (aksesori.label !== undefined) {
          garis.push(`        label=${quoteStr(String(aksesori.label), q)},`);
        }
        if (aksesori.url) garis.push(`        url=${quoteStr(String(aksesori.url), q)},`);
        garis.push('    ),');
      } else if (aksesori && tipe(aksesori) === T.thumbnail) {
        garis.push(
          `    accessory=ui.Thumbnail(${quoteStr(
            String((aksesori.media as { url?: string } | undefined)?.url ?? ''),
            q,
          )}),`,
        );
      }
      garis.push(')');
      return [garis.join('\n')];
    }

    case T.mediaGallery: {
      const garis = ['ui.MediaGallery('];
      for (const satu of (komponen.items as Komponen[] | undefined) ?? []) {
        const media = (satu.media as { url?: string } | undefined)?.url ?? '';
        garis.push(
          `    discord.MediaGalleryItem(${quoteStr(String(media), q)}${
            satu.spoiler === true ? ', spoiler=True' : ''
          }),`,
        );
      }
      garis.push(')');
      return [garis.join('\n')];
    }

    case T.file:
      return [
        [
          'ui.File(',
          `    ${quoteStr(String((komponen.file as { url?: string } | undefined)?.url ?? ''), q)},`,
          ')',
        ].join('\n'),
      ];

    case T.container: {
      const garis = ['ui.Container('];
      if (komponen.accent_color !== undefined && komponen.accent_color !== null) {
        garis.push(`    accent_color=discord.Color(${Number(komponen.accent_color)}),`);
      }
      for (const isi of (komponen.components as Komponen[] | undefined) ?? []) {
        const dalam = dpyNode(isi, q, dropped);
        if (!dalam.length) continue;
        garis.push(...beriKoma(indent(dalam[0]!.split('\n'), 4)));
      }
      garis.push(')');
      return [garis.join('\n')];
    }

    case T.actionRow: {
      const garis = ['ui.ActionRow('];
      for (const kontrol of (komponen.components as Komponen[] | undefined) ?? []) {
        const dalam = indent(dpyControl(kontrol, q, dropped), 4);
        dalam[dalam.length - 1] = `${dalam[dalam.length - 1]},`;
        garis.push(...dalam);
      }
      garis.push(')');
      return [garis.join('\n')];
    }

    default:
      return [komentarTakDikenal(komponen, dropped).join('\n')];
  }
}

function dpyControl(komponen: Komponen, q: '"' | "'", dropped: string[]): string[] {
  const jenis = tipe(komponen);

  if (jenis === T.button) {
    const garis = ['discord.ui.Button('];
    if (komponen.label !== undefined) garis.push(`    label=${quoteStr(String(komponen.label), q)},`);
    if (komponen.custom_id) garis.push(`    custom_id=${quoteStr(String(komponen.custom_id), q)},`);
    if (komponen.url) garis.push(`    url=${quoteStr(String(komponen.url), q)},`);
    if (komponen.disabled === true) garis.push('    disabled=True,');
    garis.push(')');
    return garis;
  }

  if (
    jenis === T.stringSelect ||
    jenis === T.userSelect ||
    jenis === T.roleSelect ||
    jenis === T.mentionableSelect ||
    jenis === T.channelSelect
  ) {
    const nama =
      jenis === T.userSelect
        ? 'discord.ui.UserSelect'
        : jenis === T.roleSelect
          ? 'discord.ui.RoleSelect'
          : jenis === T.mentionableSelect
            ? 'discord.ui.MentionableSelect'
            : jenis === T.channelSelect
              ? 'discord.ui.ChannelSelect'
              : 'discord.ui.Select';
    const garis = [`${nama}(`];
    if (komponen.custom_id) garis.push(`    custom_id=${quoteStr(String(komponen.custom_id), q)},`);
    if (komponen.placeholder) garis.push(`    placeholder=${quoteStr(String(komponen.placeholder), q)},`);
    if (Number(komponen.min_values) > 0) garis.push(`    min_values=${Number(komponen.min_values)},`);
    if (Number(komponen.max_values) > 0) garis.push(`    max_values=${Number(komponen.max_values)},`);
    if (komponen.disabled === true) garis.push('    disabled=True,');
    const opsi = (komponen.options as Komponen[] | undefined) ?? [];
    if (opsi.length) {
      garis.push('    options=[');
      for (const satu of opsi) {
        garis.push(
          `        discord.SelectOption(label=${quoteStr(String(satu.label ?? ''), q)}, value=${quoteStr(
            String(satu.value ?? ''),
            q,
          )}),`,
        );
      }
      garis.push('    ],');
    }
    garis.push(')');
    return garis;
  }

  return komentarTakDikenal(komponen, dropped);
}

function dpy(
  komponen: Komponen[],
  q: '"' | "'",
  dropped: string[],
): { imports: string[]; code: string[] } {
  const imports = new Set<string>();
  const blok: string[] = [];
  for (const satu of komponen) blok.push(...dpyNode(satu, q, dropped));
  return { imports: [...imports].sort(), code: blok };
}

/**
 * Bangkitkan kode dari daftar komponen (JSON hasil penyusun payload).
 *
 * `komponen` adalah array tingkat atas — Container dan komponen di luar kartu.
 */
export function generateCodegen(
  komponen: unknown[],
  library: CodegenLibrary,
  opsi: { quoteStyle?: '"' | "'" } = {},
): CodegenResult {
  const dropped: string[] = [];
  const q = opsi.quoteStyle === "'" ? "'" : '"';
  const daftar = (Array.isArray(komponen) ? komponen : []) as Komponen[];

  if (library === 'dpy2') {
    const hasil = dpy(daftar, q, dropped);
    if (hasil.code.length === 0) {
      return {
        imports: [],
        code: ['# Pesan ini belum punya komponen — susun blok dulu di tab Susun.'],
        documentation: 'https://discordpy.readthedocs.io/en/stable/api.html',
        dropped,
      };
    }
    return {
      imports: ['import discord', 'from discord import ui'],
      code: [
        'view = ui.Container([',
        // Komentar di dalam array Python: barisnya sendiri, tanpa koma.
        ...hasil.code.map((satu) => beriKoma(indent(satu.split('\n'), 4)).join('\n')),
        '])',
        '# lalu kirim: await channel.send(view=view)',
      ],
      documentation: 'https://discordpy.readthedocs.io/en/stable/api.html',
      dropped,
    };
  }

  const hasil = djs(daftar, q, dropped);
  // Komentar (`#`) jadi `//` di sini, bukan saat menelusuri: `djsNode` juga
  // dipakai untuk isi container, dan di sana komentarnya sudah ditangani.
  hasil.code = komentarDjs(hasil.code);
  if (hasil.code.length === 0) {
    return {
      imports: [],
      code: ['// Pesan ini belum punya komponen — susun blok dulu di tab Susun.'],
      documentation: 'https://discord.js.org/docs/packages/builders/main/TextDisplayBuilder:Class',
      dropped,
    };
  }
  return {
    imports: [
      `import {\n  ${hasil.imports.join(',\n  ')},\n} from 'discord.js';`,
    ],
    code: [
      'await channel.send({',
      '  components: [',
      ...hasil.code.map((satu) => beriKoma(indent(komentarDjs(satu.split('\n')), 4)).join('\n')),
      '  ],',
      '  // Components V2: pesan komponen wajib membawa flag ini',
      '  flags: MessageFlags.IsComponentsV2,',
      '});',
    ],
    documentation: 'https://discord.js.org/docs/packages/builders/main/TextDisplayBuilder:Class',
    dropped,
  };
}
