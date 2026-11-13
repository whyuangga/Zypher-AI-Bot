/**
 * Penantian (`wait`), percabangan (`condition`), dan variabel sesi —
 * versi ringkas flow Discohook.
 *
 * Kenapa modul ini MURNI (tanpa discord.js, tanpa database):
 *
 * Flow yang berhenti di tengah ("tunggu 5 menit, lalu kirim pengingat") tidak
 * bisa hidup di dalam satu interaksi: Discord membatasi umur interaksi, dan bot
 * bisa restart kapan saja. Karena itu penantian harus disimpan sebagai keadaan
 * di database, lalu dilanjutkan timer. Aturan "kapan lanjut", "sudah waktunya
 * atau belum", dan "cabang mana yang diambil" adalah logika murni — diuji tanpa
 * server, dan dipakai sama oleh penjalan interaksi maupun timer.
 *
 * Yang TIDAK dijanjikan (dan disebut terus terang di dokumentasi):
 *
 *   - Penantian tidak presisi detik. Timer memeriksa tiap beberapa detik, jadi
 *     aksi bisa berjalan beberapa detik setelah waktunya.
 *   - Variabel sesi hanya hidup selama satu flow berjalan. Tidak ada variabel
 *     global per server — itu fitur lain (`Set variable` di Discohook), dan
 *     mencampurnya akan membuat flow yang sulit ditebak admin lain.
 */

/** Batas yang dijaga sanitizer, dasbor, dan penjalan. */
export const FLOW_LIMITS = {
  /** Penantian terpanjang: 7 hari. Lebih dari ini hampir pasti salah isi. */
  waitSeconds: 604_800,
  /** Penantian terpendek: 1 detik. 0 berarti "tanpa penantian". */
  minWaitSeconds: 1,
  /** Panjang nama variabel. */
  variableName: 32,
  /** Panjang nilai variabel. */
  variableValue: 500,
  /** Jumlah variabel per flow — jaring pengaman, bukan batas teknis. */
  variables: 20,
} as const;

/** Nilai yang bisa dibandingkan di percabangan. */
export type FlowValue = string;

/** Variabel flow: nama → nilai. Semuanya teks, sama seperti Discohook. */
export type FlowVariables = Record<string, FlowValue>;

/**
 * Pembanding yang didukung.
 *
 * Discohook punya lebih banyak (tanggal, angka), tetapi untuk bot satu server
 * teks sudah menutup hampir semua kebutuhan: "punya role Gamer?", "memilih
 * opsi apa?". Pembanding yang tidak ada di sini lebih baik tidak dijanjikan
 * daripada dijanjikan lalu hasilnya mengejutkan.
 */
export const COMPARATORS = ['equals', 'notEquals', 'contains', 'notContains', 'empty', 'notEmpty'] as const;
export type Comparator = (typeof COMPARATORS)[number];

/**
 * Pembanding LOGIKA — bentuknya sama dengan `FlowActionCheckFunctionType` di
 * Discohook: `and`, `or`, `not`, `in`. Bedanya, di sana syarat disusun sebagai
 * pohon fungsi JSON; di sini bentuknya sengaja lebih ramah ditulis tangan:
 *
 *   and  — semua syarat anak BENAR
 *   or   — sedikitnya satu syarat anak benar
 *   not  — semua syarat anak SALAH (NOR, sama seperti Discohook: bukan
 *          negasi satu syarat, melainkan "tidak ada yang benar")
 *   in   — nilai `value` ADA di dalam daftar `list`
 *
 * `not` sengaja tidak diartikan "negasi satu syarat": Discohook memakai NOR,
 * dan dua arti berbeda untuk satu nama adalah cara tercepat membuat admin
 * salah paham. Kalau admin ingin "bukan X", dia menulis `not` berisi satu
 * syarat `X`.
 */
export const LOGIC_OPERATORS = ['and', 'or', 'not', 'in'] as const;
export type LogicOperator = (typeof LOGIC_OPERATORS)[number];

export const LOGIC_LABEL: Record<LogicOperator, string> = {
  and: 'semua benar (dan)',
  or: 'salah satu benar (atau)',
  not: 'semua salah (bukan)',
  in: 'termasuk salah satu dari daftar',
};

/**
 * Satu simpul syarat.
 *
 * Dua bentuk, sengaja dibedakan supaya tidak ada field yang "kadang berarti":
 *   - `leaf`: membandingkan satu nilai (`value`) dengan pembanding datar;
 *   - `logic`: menggabungkan simpul anak (`items`), atau `in` yang memakai
 *     `list` sebagai daftar pembanding.
 */
export type ConditionNode =
  | {
      type: 'leaf';
      /** Nama nilai: `member.name`, `selected`, `var.kode`, … */
      value: string;
      comparator: Comparator;
      expected?: string;
    }
  | {
      type: LogicOperator;
      /** Anak syarat — untuk `and`/`or`/`not`. */
      items?: ConditionNode[];
      /** Daftar pembanding untuk `in`, teks dipisah koma/baris. */
      list?: string[];
      /** Untuk `in`: nama nilai yang dicari. */
      value?: string;
    };

/** Batas kedalaman pohon syarat — cermin dari `ACTION_LIMITS.branchDepth`. */
export const CONDITION_LIMITS = {
  /** Kedalaman sarang simpul logika. */
  depth: 4,
  /** Jumlah simpul dalam satu syarat (semua tingkat). */
  nodes: 40,
  /** Jumlah nilai di daftar `in`. */
  listItems: 50,
} as const;

/** Normalisasi satu nilai pembanding `in`: buang spasi kosong. */
export function normalizeList(values: unknown): string[] {
  const sumber = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(/[\n,]/)
      : [];
  const hasil: string[] = [];
  for (const satu of sumber) {
    const teks = String(satu ?? '').trim();
    if (!teks) continue;
    if (hasil.includes(teks)) continue;
    hasil.push(teks.slice(0, 200));
    if (hasil.length >= CONDITION_LIMITS.listItems) break;
  }
  return hasil;
}

/**
 * Uji satu simpul syarat terhadap nilai yang tersedia.
 *
 * `resolve` dipakai untuk mengambil nilai sebuah nama — dipisah supaya modul
 * ini tetap murni dan bisa diuji tanpa runtime flow. Simpul yang tidak sah
 * menghasilkan `false`, bukan melempar: satu syarat cacat tidak boleh membuat
 * seluruh flow berhenti tanpa penjelasan yang bisa dibaca.
 */
export function evaluateCondition(
  node: ConditionNode | null | undefined,
  resolve: (name: string) => string,
): boolean {
  if (!node) return false;
  if (node.type === 'leaf') {
    return testCondition({
      value: resolve(node.value),
      comparator: node.comparator,
      expected: node.expected,
    });
  }
  if (node.type === 'in') {
    const dicari = resolve(node.value ?? '').trim();
    const daftar = node.list ?? [];
    if (!dicari) return false;
    return daftar.some((satu) => satu === dicari);
  }
  const anak = (node.items ?? []).map((satu) => evaluateCondition(satu, resolve));
  if (node.type === 'and') return anak.length > 0 && anak.every(Boolean);
  if (node.type === 'or') return anak.some(Boolean);
  // `not` = NOR: tidak ada anak yang benar. Tanpa anak, hasilnya `true`
  // (vakum benar) — sama seperti Discohook, dan itu memang yang diharapkan
  // dari "tidak ada syarat yang dilanggar".
  return anak.every((satu) => satu === false);
}

/** Apakah simpul ini memakai daftar pembanding (`in`)? */
export function isLogicNode(node: ConditionNode | null | undefined): boolean {
  return Boolean(node && node.type !== 'leaf');
}

/** Ringkasan satu simpul untuk log & dashboard. */
export function describeCondition(node: ConditionNode | null | undefined): string {
  if (!node) return '(kosong)';
  if (node.type === 'leaf') {
    const banding = COMPARATOR_LABEL[node.comparator];
    return node.expected === undefined || node.expected === ''
      ? `${node.value} ${banding}`
      : `${node.value} ${banding} "${node.expected}"`;
  }
  if (node.type === 'in') {
    const daftar = (node.list ?? []).join(', ');
    return `${node.value ?? '?'} termasuk [${daftar}]`;
  }
  const anak = (node.items ?? []).map(describeCondition);
  if (anak.length === 0) return `(${node.type}: kosong)`;
  const sambung = node.type === 'and' ? ' DAN ' : node.type === 'or' ? ' ATAU ' : ' DAN BUKAN ';
  return `(${anak.join(sambung)})`;
}

export const COMPARATOR_LABEL: Record<Comparator, string> = {
  equals: 'sama dengan',
  notEquals: 'tidak sama dengan',
  contains: 'mengandung',
  notContains: 'tidak mengandung',
  empty: 'kosong',
  notEmpty: 'tidak kosong',
};

export function normalizeComparator(value: unknown): Comparator {
  return COMPARATORS.includes(value as Comparator) ? (value as Comparator) : 'equals';
}

/** Nama variabel yang aman dipakai di template `{var.nama}`. */
export function isVariableName(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(value);
}

/**
 * Ambil nilai sebuah variabel untuk dibandingkan.
 *
 * Nilai bawaan yang selalu tersedia — sengaja memakai nama yang sama dengan
 * Discohook (`member.name`, `role.name`, …) supaya admin tidak perlu menghafal
 * dua set nama. Variabel buatan admin (`var.*`) ikut dibaca.
 *
 * Tidak ada nilai yang "ajaib": variabel yang tidak ada menghasilkan string
 * kosong, sehingga `empty` berlaku apa adanya.
 */
export function resolveFlowValue(name: string, context: FlowVariables): string {
  const kunci = name.trim();
  if (!kunci) return '';
  if (Object.prototype.hasOwnProperty.call(context, kunci)) return context[kunci] ?? '';
  return '';
}

/**
 * Uji satu percabangan.
 *
 * `expected` diabaikan untuk `empty`/`notEmpty` — itu yang membuat dua
 * pembanding tersebut berguna: admin tidak perlu mengetik apa pun.
 */
export function testCondition(options: {
  value: string;
  comparator: Comparator;
  expected?: string;
}): boolean {
  const kiri = options.value ?? '';
  const kanan = options.expected ?? '';
  switch (options.comparator) {
    case 'equals':
      return kiri === kanan;
    case 'notEquals':
      return kiri !== kanan;
    case 'contains':
      return kanan.length > 0 && kiri.includes(kanan);
    case 'notContains':
      return kanan.length === 0 || !kiri.includes(kanan);
    case 'empty':
      return kiri.trim().length === 0;
    case 'notEmpty':
      return kiri.trim().length > 0;
    default:
      return false;
  }
}

/**
 * Jadwal lanjut untuk sebuah penantian.
 *
 * Mengembalikan `null` bila penantiannya tidak sah (mis. 0 detik) — pemanggil
 * memperlakukannya sebagai "tidak ada penantian", bukan "lanjut sekarang",
 * supaya aksi tidak berjalan dua kali.
 */
export function waitUntil(now: number, seconds: unknown): number | null {
  const detik = Number(seconds);
  if (!Number.isFinite(detik)) return null;
  const bulat = Math.trunc(detik);
  if (bulat < FLOW_LIMITS.minWaitSeconds) return null;
  const dibatasi = Math.min(bulat, FLOW_LIMITS.waitSeconds);
  return now + dibatasi * 1000;
}

/**
 * Apakah sesi flow ini sudah waktunya dilanjutkan?
 *
 * `dueAt` boleh berupa angka atau string (Postgres mengembalikan BIGINT sebagai
 * string) — konversi dilakukan di sini supaya pemanggil tidak perlu tahu.
 */
export function isDue(session: { dueAt: number | string | null }, now: number): boolean {
  if (session.dueAt === null || session.dueAt === undefined) return false;
  const angka = Number(session.dueAt);
  if (!Number.isFinite(angka)) return false;
  return angka <= now;
}

/** Teks penantian untuk ditampilkan ke admin, mis. "5 menit". */
export function describeWait(seconds: number): string {
  if (seconds <= 0) return 'tanpa penantian';
  if (seconds < 60) return `${seconds} detik`;
  if (seconds < 3600) {
    const menit = Math.round(seconds / 60);
    return `${menit} menit`;
  }
  if (seconds < 86_400) {
    const jam = Math.round(seconds / 3600);
    return `${jam} jam`;
  }
  const hari = Math.round(seconds / 86_400);
  return `${hari} hari`;
}
