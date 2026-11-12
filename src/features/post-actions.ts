/**
 * Aksi komponen `/pesan` — flow bergaya Discohook Actions.
 *
 * Kenapa modul terpisah dan MURNI (tanpa discord.js, tanpa database):
 *
 *   - Aturan "aksi mana yang sah" dipakai di tiga tempat: dashboard (menyusun),
 *     sanitizer saat menyimpan, dan bot saat menjalankan. Kalau ditulis tiga
 *     kali, cepat atau lambat ketiganya berbeda dan admin melihat tombol yang
 *     sebenarnya tidak melakukan apa pun.
 *   - Aksi adalah teks bebas yang ditulis admin (balasan, template). Semuanya
 *     harus divalidasi di sini supaya tidak ada jalan masuk ke data rusak.
 *
 * Padanan dengan Discohook (`FlowActionType`):
 *
 *   - `AddRole`/`RemoveRole`/`ToggleRole` → `role` dengan `op` give/remove/toggle;
 *   - `SendMessage`/`SendWebhookMessage` → `message` dan `webhook`;
 *   - `SendRawMessage` → `raw`;
 *   - `Wait` → `wait` (batas di sini 7 hari, Discohook 60 detik);
 *   - `Check` → `condition` dengan cabang `then`/`else` bertingkat;
 *   - `SetVariable` → `variable` (static/adaptive/get);
 *   - `CreateThread` → `thread`; `DeleteMessage` → `delete`;
 *   - `Stop` → `stop`; `Dud` → `dud`.
 *
 * Yang TIDAK diambil: `SendModal` (di Discohook sendiri sudah dikomentari) dan
 * `Backup`. Batasnya pun mengikuti Discohook: kedalaman cabang 5 tingkat, 40
 * aksi berhitung per flow (`condition`/`stop` tidak dihitung), dan 15 aksi
 * pengirim pesan per flow.
 *
 * `wait` tetap tidak menahan apa pun di memori: flow yang menunggu disimpan
 * sebagai sesi lalu dilanjutkan timer, termasuk sisa aksi yang berada DI DALAM
 * cabang (lihat `jalankanLangkah` di post-action-runner.ts).
 */
import {
  CONDITION_LIMITS,
  FLOW_LIMITS,
  isVariableName,
  normalizeComparator,
  normalizeList,
  type ConditionNode,
  type LogicOperator,
} from './post-flow.js';
import { COMPARATOR_LABEL } from './post-flow.js';

/* ------------------------------------------------------------------ */
/*  Jenis aksi                                                         */
/* ------------------------------------------------------------------ */

/**
 * `role` — beri/lepas/ganti role.
 * `reply` — balas pengklik (boleh hanya dia yang melihat).
 * `message` — kirim pesan lain dari daftar pesan tersimpan.
 */
export const ACTION_KINDS = [
  'role',
  'reply',
  'message',
  'wait',
  'condition',
  'variable',
  'thread',
  'delete',
  /** Tidak melakukan apa pun. Discohook menyebutnya "Do nothing"; berguna
   *  sebagai penanda "aksi ini sengaja dikosongkan" saat admin menyusun. */
  'dud',
  /** Hentikan flow, opsional dengan pesan. Padanan "Stop" di Discohook. */
  'stop',
  /**
   * Kirim pesan tersimpan lewat WEBHOOK, bukan lewat bot.
   *
   * Padanan `SendWebhookMessage` di Discohook: pesan tampil atas nama server.
   * Bedanya, webhook di sini TIDAK dipilih per aksi seperti di Discohook
   * (yang menyimpan daftar webhook di akunnya). Webhook dibuat/dipakai ulang
   * per channel tujuan — admin tidak perlu menyalin token ke mana pun, dan
   * tidak ada rahasia tambahan yang harus disimpan.
   */
  'webhook',
  /**
   * Kirim teks MENTAH (tanpa pesan tersimpan) ke channel.
   *
   * Padanan `SendRawMessage` Discohook: isinya `content` bebas, bukan blok
   * container. Discohook memakai ini untuk pesan singkat yang tidak perlu
   * disusun di editor komponen — di sini sama, dan teksnya boleh memakai
   * templat yang sudah ada.
   */
  'raw',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Apa yang dilakukan pada role. */
export const ROLE_ACTION_OPS = ['toggle', 'give', 'remove'] as const;
export type RoleActionOp = (typeof ROLE_ACTION_OPS)[number];

export const ROLE_ACTION_LABEL: Record<RoleActionOp, string> = {
  toggle: 'Pasang / lepas (klik bergantian)',
  give: 'Hanya beri',
  remove: 'Hanya lepas',
};

export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  role: 'Role — beri / lepas',
  reply: 'Balas pengklik',
  message: 'Kirim pesan tersimpan',
  wait: 'Tunggu',
  condition: 'Periksa syarat (berhenti bila tidak cocok)',
  variable: 'Simpan variabel',
  thread: 'Buat thread',
  delete: 'Hapus pesan ini',
  dud: 'Tidak melakukan apa pun',
  stop: 'Hentikan flow',
  webhook: 'Kirim pesan lewat webhook (atas nama server)',
  raw: 'Kirim teks biasa (tanpa komponen)',
};

/**
 * Aksi yang MENGHENTIKAN flow kalau gagal.
 *
 * Selain ini, kegagalan hanya dilaporkan lalu flow lanjut. Perbedaannya
 * disengaja: role, syarat, dan hapus pesan mengubah keadaan yang membuat sisa
 * aksi masuk akal atau tidak; gagal di situ berarti melanjutkan akan
 * menyesatkan member.
 */

/** Satu aksi. Semua field opsional kecuali `kind`; sanitizer membuang yang kosong. */
export interface PostAction {
  kind: ActionKind;
  /* --- kind = 'role' --- */
  /** Role yang diubah. */
  roleId?: string;
  op?: RoleActionOp;
  /* --- kind = 'reply' --- */
  /** Isi balasan (maksimal 1800 karakter, batas aman satu pesan Discord). */
  text?: string;
  /** true = hanya pengklik yang melihat (ephemeral). */
  hidden?: boolean;
  /* --- kind = 'message' --- */
  /** ID pesan tersimpan (`custom_posts.id`) yang dikirim. */
  postId?: number;
  /**
   * true = kirim sebagai pesan baru di channel (bukan balasan).
   *
   * Discord hanya mengizinkan SATU balasan per interaksi. Kalau aksi role
   * sudah membalas "role ditambahkan", aksi pesan tidak punya tempat lagi —
   * jadi pilihannya: kirim ke channel (default) atau jangan dikirim sama
   * sekali. Menyembunyikannya diam-diam justru membingungkan.
   */
  toChannel?: boolean;
  /** Balasan tambahan sesudah pesan tersimpan terkirim (opsional). */
  followUp?: string;
  /**
   * Channel tujuan lain (ID). Kosong = channel pesan pemicu.
   *
   * Discohook mengirim pesan ke channel yang dipilih per aksi; di sini
   * channel ditulis sebagai ID karena bot hanya boleh mengirim ke channel
   * yang benar-benar ada — dan ID yang salah dilaporkan, bukan diam-diam
   * jatuh ke channel pemicu.
   */
  channelId?: string;
  /* --- kind = 'wait' --- */
  /** Lama penantian dalam detik (1 .. FLOW_LIMITS.waitSeconds). */
  seconds?: number;
  /* --- kind = 'condition' --- */
  /** Nama nilai yang diperiksa, mis. `member.name`, `selected`, `var.kode`. */
  value?: string;
  /** Pembanding; lihat COMPARATOR_LABEL di post-flow.ts. */
  comparator?: string;
  /** Nilai pembanding (diabaikan untuk `empty`/`notEmpty`). */
  expected?: string;
  /* --- kind = 'variable' --- */
  /** Nama variabel (huruf/angka/underscore, diawali huruf). */
  name?: string;
  /* --- kind = 'thread' --- */
  /** Nama thread (boleh memakai template). */
  threadName?: string;
  /** true = thread privat (hanya yang diundang). */
  private?: boolean;
  /** Lama thread terarsip sendiri: 60, 1440, 4320, atau 10080 menit. */
  autoArchiveMinutes?: number;
  /** Slowmode thread (detik per pesan, 0..21600). */
  slowmodeSeconds?: number;
  /** Hanya untuk thread privat: apakah orang lain boleh mengundang. */
  invitable?: boolean;
  /** Tag forum (snowflake ID tag), maksimal 5 — hanya untuk channel forum. */
  appliedTags?: string[];
  /**
   * Pesan pembuka thread.
   *
   * Di channel teks, pesan ini dikirim lebih dulu lalu thread dimulai dari
   * pesan itu (dipakai forum sebagai isi postingan). Kosong = thread dimulai
   * dari pesan pemicu, sama seperti sebelumnya.
   */
  threadMessage?: string;
  /* --- kind = 'condition' --- */
  /**
   * Pohon syarat bertingkat (`and`/`or`/`not`/`in`).
   *
   * Kalau ada, bentuk lama (`value`/`comparator`/`expected`) DIABAIKAN —
   * memakai keduanya sekaligus membuat hasilnya sulit ditebak. Sanitizer
   * memilih salah satu, dan UI menampilkan yang mana yang dipakai.
   */
  check?: ConditionNode;
  /* --- kind = 'delete' --- */
  /**
   * Apa yang dihapus:
   *   - `pesan` (bawaan): pesan pemilik komponen;
   *   - `sebelumnya`: pesan yang DIKIRIM aksi sebelumnya di flow yang sama.
   *
   * Padanan `DeleteMessage` versi Discohook yang menghapus lewat variabel
   * `messageId` — di sana admin menyusun urutannya sendiri dengan variabel,
   * di sini cukup satu pilihan karena hasil aksi terakhir selalu yang paling
   * masuk akal untuk dihapus.
   */
  what?: 'pesan' | 'sebelumnya';
  /* --- kind = 'raw' --- */
  /** Isi teks mentah (boleh memakai templat). */
  rawText?: string;
  /* --- kind = 'stop' --- */
  /** Pesan yang ditampilkan saat flow berhenti (opsional). */
  stopMessage?: string;
  /* --- kind = 'condition' (cabang) --- */
  /**
   * Aksi yang dijalankan bila syarat COCOK.
   *
   * Kalau `then` maupun `else` tidak diisi, perilakunya seperti sebelumnya:
   * syarat yang tidak cocok menghentikan flow. Itu menjaga aksi yang sudah
   * tersimpan tetap berjalan sama.
   */
  then?: PostAction[];
  /** Aksi yang dijalankan bila syarat TIDAK cocok. */
  else?: PostAction[];
  /* --- kind = 'variable' --- */
  /**
   * Dari mana nilai variabel diambil:
   *   - `static` (bawaan): teks yang ditulis admin, boleh berisi template;
   *   - `adaptive`: hasil aksi sebelumnya (mis. ID channel pesan terkirim);
   *   - `get`: salinan variabel lain yang sudah ada.
   */
  source?: 'static' | 'adaptive' | 'get';
}

/** Batas yang dijaga sanitizer dan dasbor. */
export const ACTION_LIMITS = {
  /** Jumlah aksi per tombol/opsi. */
  perComponent: 6,
  /** Panjang balasan. Discord membatasi 2000; 1800 menyisakan ruang. */
  textLength: 1800,
  /** Panjang balasan sesudah kirim pesan. */
  followUpLength: 300,
  /** Jumlah total aksi per pesan — jaring pengaman, bukan batas Discord. */
  perMessage: 40,
  /**
   * Kedalaman cabang bersyarat.
   *
   * Discohook menyusun cabang sebagai pohon tanpa batas tingkat yang tegas
   * (yang dijaga di sana jumlah aksinya). Di sini 5 tingkat: cukup untuk
   * "kalau A, kalau B, kalau C" yang wajar ditulis manusia, dan masih bisa
   * digambar dashboard tanpa kotak yang tak terbaca di layar ponsel. Lebih
   * dari itu DILAPORKAN, bukan dipotong diam-diam.
   */
  branchDepth: 5,
  /**
   * Jumlah aksi yang DIHITUNG per flow, termasuk yang di dalam cabang.
   *
   * Sama seperti `refineZodDraftFlowMax` di Discohook: `condition` dan `stop`
   * tidak dihitung (keduanya hanya mengatur alur, bukan melakukan sesuatu).
   * Discohook memakai 40 (10 untuk pengguna gratis); di sini semua server
   * dianggap penuh, jadi 40.
   */
  countedPerFlow: 40,
  /**
   * Jumlah aksi yang MENGIRIM pesan per flow (kirim pesan + webhook).
   *
   * Discohook membatasi 15 (`Cannot have more than 15 message actions`).
   * Batasnya bukan teknis: flow yang mengirim puluhan pesan dalam satu klik
   * hampir selalu salah susun, dan rate limit channel akan menghukumnya.
   */
  messagePerFlow: 15,
  /**
   * Jaring pengaman jumlah aksi TOTAL per flow, termasuk yang tidak dihitung.
   *
   * `condition` dan `stop` tidak dihitung terhadap kuota, jadi tanpa batas ini
   * satu cabang bisa berisi ratusan aksi "hentikan" — masing-masing sah, tetapi
   * tidak ada gunanya dan membuat sesi penantian menyimpan payload besar.
   */
  maxTotal: 120,
} as const;

/** Batas variabel per flow saat dijalankan. */
export const VARIABLE_LIMITS = {
  perFlow: 20,
} as const;

/* ------------------------------------------------------------------ */
/*  Sanitasi                                                           */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

/** Role ID Discord selalu snowflake (angka). */
function isRoleId(value: string): boolean {
  return /^\d{5,25}$/.test(value);
}

/** ID channel Discord — snowflake. Sama seperti role, hanya angka. */
function isChannelId(value: string): boolean {
  return /^\d{5,25}$/.test(value);
}

/** Pilihan auto-archive thread yang diizinkan Discord (menit). */
export const AUTO_ARCHIVE_CHOICES = [60, 1440, 4320, 10080] as const;

/**
 * Rapikan SATU simpul syarat.
 *
 * Mengembalikan `null` kalau simpulnya tidak bisa dipakai. Alasannya
 * dikumpulkan ke `dropped` supaya admin tahu bagian mana yang hilang — bukan
 * syarat yang diam-diam jadi "selalu benar".
 */
function sanitizeConditionNode(
  input: unknown,
  dropped: string[],
  kedalaman = 0,
): ConditionNode | null {
  if (!input || typeof input !== 'object') return null;
  const item = input as Record<string, unknown>;
  const tipe = asString(item.type).trim();

  if (tipe === 'in') {
    const nama = asString(item.value).trim();
    if (!/^[a-zA-Z][\w.]{0,63}$/.test(nama)) {
      dropped.push('syarat "termasuk" tanpa nilai yang diperiksa');
      return null;
    }
    const daftar = normalizeList(item.list);
    if (daftar.length === 0) {
      dropped.push('syarat "termasuk" tanpa daftar pembanding');
      return null;
    }
    return { type: 'in', value: nama, list: daftar };
  }

  if (tipe === 'and' || tipe === 'or' || tipe === 'not') {
    if (kedalaman >= CONDITION_LIMITS.depth) {
      dropped.push(`syarat bersarang lebih dari ${CONDITION_LIMITS.depth} tingkat tidak didukung`);
      return null;
    }
    const mentah = Array.isArray(item.items) ? item.items : [];
    const anak: ConditionNode[] = [];
    for (const satu of mentah) {
      const bersih = sanitizeConditionNode(satu, dropped, kedalaman + 1);
      if (bersih) anak.push(bersih);
      if (anak.length >= CONDITION_LIMITS.nodes) break;
    }
    /*
     * `and`/`or` TANPA anak tidak disimpan: hasilnya akan selalu benar/salah
     * dan admin mengira syaratnya bekerja. `not` tanpa anak sengaja
     * DIPERTAHANKAN — artinya "tidak ada yang dilanggar", sama seperti
     * Discohook, dan itu berguna sebagai cabang "selain itu".
     */
    if (anak.length === 0 && tipe !== 'not') {
      dropped.push(`syarat "${tipe}" tanpa syarat di dalamnya`);
      return null;
    }
    return { type: tipe as LogicOperator, items: anak };
  }

  // Bentuk daun: memakai pembanding datar (perilaku lama).
  const nama = asString(item.value).trim();
  if (!/^[a-zA-Z][\w.]{0,63}$/.test(nama)) {
    dropped.push('syarat tanpa nilai yang diperiksa');
    return null;
  }
  const comparator = normalizeComparator(item.comparator);
  const expected = asString(item.expected).slice(0, FLOW_LIMITS.variableValue);
  if (esCompar(comparator) && !expected) {
    dropped.push('syarat membutuhkan nilai pembanding');
    return null;
  }
  return { type: 'leaf', value: nama, comparator, ...(expected ? { expected } : {}) };
}

function esCompar(comparator: string): boolean {
  return (
    comparator === 'equals' ||
    comparator === 'notEquals' ||
    comparator === 'contains' ||
    comparator === 'notContains'
  );
}

/** Ringkasan simpul syarat untuk pesan yang dilihat admin. */
export function ringkasSyarat(node: ConditionNode | null | undefined): string {
  if (!node) return '(kosong)';
  if (node.type === 'leaf') {
    const banding = COMPARATOR_LABEL[node.comparator] ?? node.comparator;
    return node.expected ? `${node.value} ${banding} "${node.expected}"` : `${node.value} ${banding}`;
  }
  if (node.type === 'in') return `${node.value ?? '?'} termasuk [${(node.list ?? []).join(', ')}]`;
  const anak = (node.items ?? []).map(ringkasSyarat);
  if (anak.length === 0) return `(${node.type})`;
  const sambung = node.type === 'and' ? ' DAN ' : node.type === 'or' ? ' ATAU ' : ' DAN TIDAK ';
  return `(${anak.join(sambung)})`;
}

/**
 * Rapikan daftar aksi dari input dashboard/JSON.
 *
 * Tidak pernah melempar. Aksi yang tidak sah DIBUANG dengan alasan yang bisa
 * dibaca admin — sama seperti `sanitizeBlocks`, supaya tidak ada bagian pesan
 * yang hilang diam-diam.
 */
export function sanitizeActions(input: unknown): { actions: PostAction[]; dropped: string[] } {
  const { actions, dropped } = sanitizeActionsDalam(input, 0);
  /*
   * Batas flow diterapkan SESUDAH pohonnya utuh, bukan di tengah penyusunan:
   * jumlah aksi hanya berarti kalau cabang di dalamnya sudah ikut dihitung.
   * Kalau dihitung sambil berjalan, cabang yang dibuang belakangan membuat
   * angkanya berbeda dari yang dilihat admin di dasbor.
   */
  const dibatasi = batasiAksiFlow(actions, dropped);
  return { actions: dibatasi, dropped };
}

/** Cacahan aksi satu flow (satu komponen). */
export interface HitungFlow {
  /** Semua aksi, termasuk `condition` dan `stop`. */
  total: number;
  /** Aksi berhitung — `condition`/`stop` tidak dihitung, sama seperti Discohook. */
  berhitung: number;
  /** Aksi yang mengirim pesan (`message` + `webhook`). */
  pesan: number;
}

/** Aksi ini dihitung terhadap kuota flow? (padanan `refineZodDraftFlowMax`) */
function dihitungFlow(kind: string): boolean {
  return kind !== 'condition' && kind !== 'stop';
}

/** Apakah aksi ini mengirim pesan (kuota 15 ala Discohook)? */
function kirimPesanAksi(kind: string): boolean {
  return kind === 'message' || kind === 'webhook';
}

/**
 * Hitung aksi satu flow, termasuk yang berada di dalam cabang.
 *
 * Dipakai sanitizer DAN dasbor, supaya angka "12/40" di layar admin adalah
 * angka yang sama dengan yang ditegakkan saat menyimpan.
 */
export function hitungAksiFlow(actions: PostAction[]): HitungFlow {
  let total = 0;
  let berhitung = 0;
  let pesan = 0;
  const jalan = (daftar: PostAction[]): void => {
    for (const aksi of daftar) {
      total += 1;
      if (dihitungFlow(aksi.kind)) berhitung += 1;
      if (kirimPesanAksi(aksi.kind)) pesan += 1;
      if (aksi.kind === 'condition') {
        jalan(aksi.then ?? []);
        jalan(aksi.else ?? []);
      }
    }
  };
  jalan(actions);
  return { total, berhitung, pesan };
}

/**
 * Buang aksi yang melewati kuota flow Discohook.
 *
 * Dua kuota: 40 aksi berhitung dan 15 aksi pengirim pesan. `condition` tidak
 * pernah dibuang karena ia hanya mengatur alur — membuangnya akan membuang
 * cabang beserta aksinya, dan alasan "syarat dihapus" tidak menjelaskan apa
 * pun ke admin.
 *
 * Alasan dilaporkan SEKALI per kuota: daftar 60 alasan "melebihi batas" tidak
 * lebih membantu daripada satu kalimat.
 */
export function batasiAksiFlow(actions: PostAction[], dropped: string[] = []): PostAction[] {
  const hitung: HitungFlow = { total: 0, berhitung: 0, pesan: 0 };
  let laporHitung = false;
  let laporPesan = false;
  let laporTotal = false;
  const jalan = (daftar: PostAction[]): PostAction[] => {
    const hasil: PostAction[] = [];
    for (const aksi of daftar) {
      if (aksi.kind === 'condition') {
        if (hitung.total >= ACTION_LIMITS.maxTotal) {
          if (!laporTotal) {
            dropped.push(`aksi melebihi batas ${ACTION_LIMITS.maxTotal} total per flow`);
            laporTotal = true;
          }
          continue;
        }
        hitung.total += 1;
        const thenBaru = aksi.then ? jalan(aksi.then) : undefined;
        const elseBaru = aksi.else ? jalan(aksi.else) : undefined;
        /*
         * Cabang yang HABIS karena kuota membuang aksi syaratnya sekalian.
         * Kalau tidak, syarat itu tersimpan tanpa cabang — dan syarat tanpa
         * cabang berarti "tidak cocok = hentikan flow", padahal admin menulis
         * cabang. Perubahan arti diam-diam seperti itu justru yang dihindari
         * di seluruh modul ini, jadi lebih baik dilaporkan.
         */
        const habis =
          (aksi.then?.length && !thenBaru?.length ? 'cocok' : '') ||
          (aksi.else?.length && !elseBaru?.length ? 'tidak cocok' : '');
        if (habis) {
          dropped.push(`syarat dibuang: seluruh isi cabang "${habis}" melewati kuota flow`);
          continue;
        }
        hasil.push({
          ...aksi,
          ...(thenBaru?.length ? { then: thenBaru } : {}),
          ...(elseBaru?.length ? { else: elseBaru } : {}),
        });
        continue;
      }
      if (hitung.total >= ACTION_LIMITS.maxTotal) {
        if (!laporTotal) {
          dropped.push(`aksi melebihi batas ${ACTION_LIMITS.maxTotal} total per flow`);
          laporTotal = true;
        }
        continue;
      }
      if (dihitungFlow(aksi.kind) && hitung.berhitung >= ACTION_LIMITS.countedPerFlow) {
        if (!laporHitung) {
          dropped.push(`aksi melebihi batas ${ACTION_LIMITS.countedPerFlow} aksi dihitung per flow`);
          laporHitung = true;
        }
        continue;
      }
      if (kirimPesanAksi(aksi.kind) && hitung.pesan >= ACTION_LIMITS.messagePerFlow) {
        if (!laporPesan) {
          dropped.push(`aksi kirim pesan melebihi batas ${ACTION_LIMITS.messagePerFlow} per flow`);
          laporPesan = true;
        }
        continue;
      }
      hitung.total += 1;
      if (dihitungFlow(aksi.kind)) hitung.berhitung += 1;
      if (kirimPesanAksi(aksi.kind)) hitung.pesan += 1;
      hasil.push(aksi);
    }
    return hasil;
  };
  return jalan(actions);
}

/**
 * Inti sanitizer, dengan tingkat kedalaman cabang.
 *
 * Dipisah supaya cabang bersyarat bisa memakai aturan yang PERSIS sama untuk
 * aksi di dalamnya. Kalau cabang punya sanitizer sendiri, cepat atau lambat
 * aturannya berbeda dan aksi di dalam cabang bisa lolos padahal aksi di
 * tingkat atas ditolak.
 */
function sanitizeActionsDalam(
  input: unknown,
  kedalaman: number,
): { actions: PostAction[]; dropped: string[] } {
  const dropped: string[] = [];
  const actions: PostAction[] = [];
  const source = Array.isArray(input) ? input : [];

  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const kind = asString(item.kind);
    if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
      dropped.push(`aksi tidak dikenal: ${kind.slice(0, 20) || '(kosong)'}`);
      continue;
    }

    if (kind === 'role') {
      const roleId = asString(item.roleId).trim();
      if (!isRoleId(roleId)) {
        dropped.push('aksi role tanpa role yang sah');
        continue;
      }
      const op = (ROLE_ACTION_OPS as readonly string[]).includes(asString(item.op))
        ? (asString(item.op) as RoleActionOp)
        : 'toggle';
      actions.push({ kind: 'role', roleId, op });
      continue;
    }

    if (kind === 'reply') {
      const text = asString(item.text).trim().slice(0, ACTION_LIMITS.textLength);
      if (!text) {
        dropped.push('aksi balasan tanpa teks');
        continue;
      }
      actions.push({ kind: 'reply', text, hidden: item.hidden === undefined ? true : asBoolean(item.hidden) });
      continue;
    }

    if (kind === 'wait') {
      const detik = Math.trunc(Number(item.seconds));
      if (!Number.isFinite(detik) || detik < 1) {
        dropped.push('aksi tunggu tanpa durasi yang sah (minimal 1 detik)');
        continue;
      }
      actions.push({ kind: 'wait', seconds: Math.min(detik, FLOW_LIMITS.waitSeconds) });
      continue;
    }

    if (kind === 'variable') {
      const name = asString(item.name).trim();
      if (!isVariableName(name)) {
        dropped.push('aksi variabel dengan nama tidak sah (huruf/angka/garis bawah, diawali huruf)');
        continue;
      }
      const nilai = asString(item.value).slice(0, FLOW_LIMITS.variableValue);
      const source = ['static', 'adaptive', 'get'].includes(asString(item.source))
        ? (asString(item.source) as 'static' | 'adaptive' | 'get')
        : 'static';
      // `adaptive` tanpa nilai tidak masuk akal: hasil aksi sebelumnya belum
      // tentu ada, dan variabel kosong yang "berhasil" lebih menyesatkan.
      if (source === 'adaptive' && !nilai) {
        dropped.push('variabel "hasil aksi sebelumnya" harus menyebut nilai yang diambil');
        continue;
      }
      actions.push({ kind: 'variable', name, value: nilai, source });
      continue;
    }

    if (kind === 'condition') {
      /*
       * Dua bentuk syarat:
       *   - `check` (pohon `and`/`or`/`not`/`in`) — bentuk Discohook;
       *   - `value`/`comparator`/`expected` (datar) — bentuk lama.
       * Kalau `check` ada, bentuk datar diabaikan: memakai keduanya sekaligus
       * membuat hasil yang sulit ditebak admin.
       */
      let pohon: ConditionNode | null = null;
      if (item.check !== undefined) {
        const sebelum = dropped.length;
        pohon = sanitizeConditionNode(item.check, dropped);
        if (!pohon) {
          // Alasan SPESIFIK dari penyaring simpul sudah dicatat; menambah
          // alasan umum hanya membuat admin membaca dua pesan untuk satu
          // kesalahan yang sama.
          if (dropped.length === sebelum) dropped.push('aksi syarat dengan pohon kondisi tidak sah');
          continue;
        }
      }
      const nama = pohon ? '' : asString(item.value).trim();
      if (!pohon && !/^[a-zA-Z][\w.]{0,63}$/.test(nama)) {
        dropped.push('aksi syarat tanpa nilai yang diperiksa');
        continue;
      }
      const comparator = normalizeComparator(item.comparator);
      const expected = asString(item.expected).slice(0, FLOW_LIMITS.variableValue);
      // `empty`/`notEmpty` tidak butuh pembanding; menyimpan `expected` kosong
      // lebih jujur daripada memaksa admin mengetik sesuatu yang diabaikan.
      if (!pohon && esCompar(comparator) && !expected) {
        dropped.push('aksi syarat membutuhkan nilai pembanding');
        continue;
      }
      /*
       * Cabang bersyarat: `then` dijalankan bila cocok, `else` bila tidak.
       * Kalau keduanya kosong, perilakunya tetap seperti versi sebelumnya —
       * syarat yang tidak cocok menghentikan flow — sehingga aksi yang sudah
       * tersimpan tidak berubah arti.
       */
      let cabang: Pick<PostAction, 'then' | 'else'> = {};
      if (kedalaman >= ACTION_LIMITS.branchDepth) {
        if (Array.isArray(item.then) && item.then.length > 0) {
          dropped.push(`cabang bersyarat lebih dari ${ACTION_LIMITS.branchDepth} tingkat tidak didukung`);
        }
      } else {
        const dalamThen = sanitizeActionsDalam(item.then, kedalaman + 1);
        const dalamElse = sanitizeActionsDalam(item.else, kedalaman + 1);
        for (const alasan of dalamThen.dropped) dropped.push(`cabang "cocok": ${alasan}`);
        for (const alasan of dalamElse.dropped) dropped.push(`cabang "tidak cocok": ${alasan}`);
        cabang = {
          ...(dalamThen.actions.length > 0 ? { then: dalamThen.actions } : {}),
          ...(dalamElse.actions.length > 0 ? { else: dalamElse.actions } : {}),
        };
      }

      actions.push({
        kind: 'condition',
        ...(pohon ? { check: pohon } : { value: nama }),
        comparator,
        ...(expected && !pohon ? { expected } : {}),
        ...cabang,
      });
      continue;
    }

    if (kind === 'dud') {
      actions.push({ kind: 'dud' });
      continue;
    }

    if (kind === 'stop') {
      const stopMessage = asString(item.stopMessage).trim().slice(0, ACTION_LIMITS.textLength);
      actions.push({ kind: 'stop', ...(stopMessage ? { stopMessage } : {}) });
      continue;
    }

    if (kind === 'thread') {
      const threadName = asString(item.threadName).trim().slice(0, 100);
      if (!threadName) {
        dropped.push('aksi thread tanpa nama thread');
        continue;
      }
      /*
       * Pilihan arsip & slowmode divalidasi terhadap daftar Discord. Nilai di
       * luar daftar DIBUANG (dengan alasan), bukan dibulatkan diam-diam ke
       * nilai terdekat — admin harus tahu thread-nya memakai setelan lain.
       */
      let autoArchiveMinutes: number | undefined;
      if (item.autoArchiveMinutes !== undefined) {
        const angka = Math.trunc(Number(item.autoArchiveMinutes));
        if ((AUTO_ARCHIVE_CHOICES as readonly number[]).includes(angka)) {
          autoArchiveMinutes = angka;
        } else {
          dropped.push('lama arsip thread harus 1 jam, 1 hari, 3 hari, atau 1 minggu');
        }
      }
      let slowmodeSeconds: number | undefined;
      if (item.slowmodeSeconds !== undefined) {
        const angka = Math.trunc(Number(item.slowmodeSeconds));
        if (Number.isFinite(angka) && angka >= 0 && angka <= 21_600) {
          slowmodeSeconds = angka;
        } else {
          dropped.push('slowmode thread harus 0–21600 detik');
        }
      }
      const appliedTags: string[] = [];
      if (Array.isArray(item.appliedTags)) {
        for (const satu of item.appliedTags) {
          const tag = asString(satu).trim();
          if (!isChannelId(tag)) continue;
          if (appliedTags.includes(tag)) continue;
          appliedTags.push(tag);
          if (appliedTags.length >= 5) break;
        }
        if (appliedTags.length === 0 && item.appliedTags.length > 0) {
          dropped.push('tag forum harus berupa ID tag (angka)');
        }
      }
      const threadMessage = asString(item.threadMessage).trim().slice(0, ACTION_LIMITS.textLength);
      actions.push({
        kind: 'thread',
        threadName,
        private: asBoolean(item.private),
        ...(autoArchiveMinutes !== undefined ? { autoArchiveMinutes } : {}),
        ...(slowmodeSeconds !== undefined ? { slowmodeSeconds } : {}),
        invitable: item.invitable === undefined ? true : asBoolean(item.invitable),
        ...(appliedTags.length ? { appliedTags } : {}),
        ...(threadMessage ? { threadMessage } : {}),
      });
      continue;
    }

    if (kind === 'delete') {
      /*
       * Dua sasaran hapus. `sebelumnya` hanya berguna kalau flow memang
       * mengirim sesuatu lebih dulu — tetapi itu tidak bisa diperiksa di sini
       * (urutan aksi bisa berisi cabang), jadi diperiksa saat dijalankan dan
       * dilaporkan ke pengklik kalau tidak ada yang bisa dihapus.
       */
      actions.push({ kind: 'delete', what: item.what === 'sebelumnya' ? 'sebelumnya' : 'pesan' });
      continue;
    }

    if (kind === 'raw') {
      const rawText = asString(item.rawText).trim().slice(0, ACTION_LIMITS.textLength);
      if (!rawText) {
        dropped.push('aksi kirim teks tanpa isi');
        continue;
      }
      const channelTeks = asString(item.channelId).trim();
      const channelSah = isChannelId(channelTeks);
      if (channelTeks && !channelSah) dropped.push('channel tujuan aksi teks bukan ID channel');
      actions.push({
        kind: 'raw',
        rawText,
        ...(channelSah ? { channelId: channelTeks } : {}),
      });
      continue;
    }

    /*
     * `message` dan `webhook` sama-sama mengirim pesan tersimpan; bedanya
     * hanya jalur kirimnya (bot vs webhook). Aturan tujuan & channel dipakai
     * bersama supaya keduanya tidak menyimpang aturan.
     */
    if (kind === 'message' || kind === 'webhook') {
      const postId = Number(item.postId);
      if (!Number.isSafeInteger(postId) || postId <= 0) {
        dropped.push(kind === 'webhook' ? 'aksi webhook tanpa pesan tujuan' : 'aksi kirim pesan tanpa pesan tujuan');
        continue;
      }
      let channelId: string | undefined;
      if (item.channelId !== undefined && asString(item.channelId).trim() !== '') {
        const cid = asString(item.channelId).trim();
        if (isChannelId(cid)) channelId = cid;
        else dropped.push('channel tujuan harus berupa ID channel (angka)');
      }
      const followUp = asString(item.followUp).trim().slice(0, ACTION_LIMITS.followUpLength);
      actions.push({
        kind,
        postId,
        toChannel: item.toChannel === undefined ? true : asBoolean(item.toChannel),
        ...(channelId ? { channelId } : {}),
        ...(followUp ? { followUp } : {}),
      });
      continue;
    }
  }

  /*
   * Batas per komponen HANYA di tingkat atas.
   *
   * Tingkat atas = satu tombol/opsi/menu, jadi batasnya 6 — angka yang dipakai
   * dashboard sejak awal. Isi cabang TIDAK dibatasi 6: cabang bukan komponen,
   * dan Discohook pun tidak membatasi panjang cabang selain lewat kuota flow.
   * Kalau isi cabang dipotong 6 di sini, kuota flow (40 aksi berhitung) tidak
   * pernah tercapai dan admin melihat alasan "maksimal 6" yang membingungkan.
   * Batas menyeluruhnya ada di `batasiAksiFlow` (`maxTotal`).
   */
  if (kedalaman > 0) return { actions, dropped };
  const dibatasi = actions.slice(0, ACTION_LIMITS.perComponent);
  if (actions.length > dibatasi.length) {
    dropped.push(`aksi melebihi batas ${ACTION_LIMITS.perComponent} per komponen`);
  }
  return { actions: dibatasi, dropped };
}

/* ------------------------------------------------------------------ */
/*  Penyusun rencana (murni)                                           */
/* ------------------------------------------------------------------ */

/**
 * Langkah yang akan dijalankan bot, dalam urutan aslinya.
 *
 * Dipisah dari penjalan (yang menyentuh Discord) supaya urutan dan efeknya
 * bisa diuji tanpa server — mis. "aksi role memberi role SEBELUM balasan
 * terkirim", yang menentukan apakah member melihat konfirmasi yang benar.
 */
export type ActionStep =
  | { kind: 'role'; roleId: string; op: RoleActionOp }
  | { kind: 'reply'; text: string; hidden: boolean }
  | {
      kind: 'message';
      postId: number;
      toChannel: boolean;
      followUp?: string;
      /** Channel tujuan selain channel pemicu (kosong = ikut pemicu). */
      channelId?: string;
      /** true = kirim lewat webhook, bukan lewat bot. */
      viaWebhook?: boolean;
    }
  | { kind: 'wait'; seconds: number }
  | {
      kind: 'condition';
      /** Bentuk datar (lama). Kosong bila `check` dipakai. */
      value?: string;
      comparator: string;
      expected?: string;
      /** Pohon syarat bertingkat (baru). */
      check?: ConditionNode;
      /** Cabang yang dijalankan bila cocok / tidak cocok (kosong = hentikan). */
      then?: ActionStep[];
      otherwise?: ActionStep[];
    }
  | { kind: 'dud' }
  | { kind: 'stop'; message?: string }
  | { kind: 'variable'; name: string; value: string; source: 'static' | 'adaptive' | 'get' }
  | {
      kind: 'thread';
      threadName: string;
      private: boolean;
      autoArchiveMinutes?: number;
      slowmodeSeconds?: number;
      invitable?: boolean;
      appliedTags?: string[];
      threadMessage?: string;
    }
  | {
      kind: 'delete';
      /**
       * `pesan` = pesan pemilik komponen, `sebelumnya` = pesan hasil aksi
       * kirim terakhir di flow ini. Runner memutuskan siapa yang dihapus.
       */
      what: 'pesan' | 'sebelumnya';
    }
  /** Kirim teks mentah (padanan `SendRawMessage`). */
  | { kind: 'raw'; text: string; channelId?: string };

export interface ActionPlan {
  /** Langkah yang dijalankan, urut. */
  steps: ActionStep[];
  /** Langkah yang dilewati sebelum dijalankan (mis. pesan tujuan = pesan ini). */
  skipped: string[];
  /**
   * Balasan pertama yang akan dipakai.
   *
   * Discord hanya mengizinkan SATU balasan per interaksi, jadi balasan
   * pertama menjadi jawaban interaksi; sisanya dilaporkan sebagai dilewati
   * supaya admin tidak mengira semuanya terkirim.
   */
  firstReply: { text: string; hidden: boolean } | null;
}

/**
 * Susun rencana dari aksi yang SUDAH bersih.
 *
 * `selfPostId` dipakai untuk mencegah pesan mengirim dirinya sendiri (loop
 * tak berujung yang akan menghabiskan rate limit channel).
 */
export function planActions(actions: PostAction[], options: { selfPostId?: number | null } = {}): ActionPlan {
  const steps: ActionStep[] = [];
  const skipped: string[] = [];
  let firstReply: { text: string; hidden: boolean } | null = null;

  for (const action of actions) {
    if (action.kind === 'role') {
      steps.push({ kind: 'role', roleId: action.roleId!, op: action.op ?? 'toggle' });
      continue;
    }
    if (action.kind === 'reply') {
      if (firstReply) {
        skipped.push('balasan kedua dilewati — Discord hanya menerima satu balasan per interaksi');
        continue;
      }
      firstReply = { text: action.text!, hidden: action.hidden !== false };
      steps.push({ kind: 'reply', text: action.text!, hidden: action.hidden !== false });
      continue;
    }
    if (action.kind === 'message' || action.kind === 'webhook') {
      if (options.selfPostId != null && action.postId === options.selfPostId) {
        skipped.push('aksi mengirim pesan ini sendiri dilewati (akan berulang tanpa henti)');
        continue;
      }
      steps.push({
        kind: 'message',
        postId: action.postId!,
        toChannel: action.toChannel !== false,
        ...(action.channelId ? { channelId: action.channelId } : {}),
        ...(action.kind === 'webhook' ? { viaWebhook: true } : {}),
        ...(action.followUp ? { followUp: action.followUp } : {}),
      });
      continue;
    }

    if (action.kind === 'wait') {
      steps.push({ kind: 'wait', seconds: action.seconds! });
      continue;
    }

    if (action.kind === 'condition') {
      /*
       * Cabang disusun REKURSIF lewat fungsi yang sama. Kalau penyusunan cabang
       * punya jalurnya sendiri, aksi di dalam cabang akan kehilangan aturan
       * (mis. "pesan sendiri tidak boleh dikirim") tanpa ada yang sadar.
       */
      const dalamThen = action.then && action.then.length > 0 ? planActions(action.then, options).steps : undefined;
      const dalamElse = action.else && action.else.length > 0 ? planActions(action.else, options).steps : undefined;
      /*
       * Bentuk datar hanya dipakai kalau tidak ada pohon syaratnya. `value`
       * bisa berisi string kosong untuk syarat berbentuk pohon, jadi jangan
       * memaksanya ada.
       */
      steps.push({
        kind: 'condition',
        ...(action.check ? { check: action.check } : { value: action.value ?? '' }),
        comparator: action.comparator ?? 'equals',
        ...(action.expected ? { expected: action.expected } : {}),
        ...(dalamThen ? { then: dalamThen } : {}),
        ...(dalamElse ? { otherwise: dalamElse } : {}),
      });
      continue;
    }

    if (action.kind === 'variable') {
      steps.push({
        kind: 'variable',
        name: action.name!,
        value: action.value ?? '',
        source: action.source ?? 'static',
      });
      continue;
    }

    if (action.kind === 'dud') {
      steps.push({ kind: 'dud' });
      continue;
    }

    if (action.kind === 'stop') {
      steps.push({ kind: 'stop', ...(action.stopMessage ? { message: action.stopMessage } : {}) });
      continue;
    }

    if (action.kind === 'thread') {
      steps.push({
        kind: 'thread',
        threadName: action.threadName!,
        private: action.private === true,
        ...(action.autoArchiveMinutes !== undefined ? { autoArchiveMinutes: action.autoArchiveMinutes } : {}),
        ...(action.slowmodeSeconds !== undefined ? { slowmodeSeconds: action.slowmodeSeconds } : {}),
        ...(action.invitable !== undefined ? { invitable: action.invitable } : {}),
        ...(action.appliedTags?.length ? { appliedTags: action.appliedTags } : {}),
        ...(action.threadMessage ? { threadMessage: action.threadMessage } : {}),
      });
      continue;
    }

    if (action.kind === 'delete') {
      steps.push({ kind: 'delete', what: action.what === 'sebelumnya' ? 'sebelumnya' : 'pesan' });
      continue;
    }

    if (action.kind === 'raw') {
      steps.push({
        kind: 'raw',
        text: action.rawText!,
        ...(action.channelId ? { channelId: action.channelId } : {}),
      });
    }
  }

  /*
   * Aksi sesudah `delete` tidak akan pernah terlihat (pesannya sudah hilang),
   * dan aksi sesudah `wait` harus dijalankan timer — bukan di dalam interaksi.
   * Keduanya dilaporkan supaya admin tidak mengira semuanya jalan berurutan.
   */
  const posisiHapus = steps.findIndex((step) => step.kind === 'delete');
  if (posisiHapus !== -1 && posisiHapus < steps.length - 1) {
    skipped.push('aksi sesudah "hapus pesan" tidak akan terlihat — pesannya sudah hilang');
  }

  return { steps, skipped, firstReply };
}

/* ------------------------------------------------------------------ */
/*  Template                                                           */
/* ------------------------------------------------------------------ */

/** Nilai yang bisa dipakai di dalam teks balasan/template. */
export interface TemplateContext {
  /** Nama tampilan member, mis. "Wahyu". */
  member: string;
  /** `<@id>` member. */
  mention: string;
  /** ID member — berguna untuk menyebut di tempat lain. */
  memberId?: string;
  /** Nama server. */
  server: string;
  /** Hasil aksi role, mis. "**Gamer**" — hanya diisi bila ada aksi role. */
  role?: string;
  /** `ditambahkan` / `dilepas` / `diperbarui` — hasil aksi role. */
  effect?: string;
  /** Pilihan yang dipilih di menu (satu nilai; kosong untuk tombol). */
  selected?: string;
  /**
   * Variabel flow, dengan awalan `var.` (mis. `{ 'var.kode': 'abc' }`).
   *
   * Dipisah dari field lain supaya nama variabel buatan admin tidak bisa
   * menimpa token bawaan seperti `{member.name}`.
   */
  variables?: Record<string, string>;
}

/**
 * Isi template dengan nilai konteks.
 *
 * Daftar token sengaja kecil dan mengikuti nama Discohook (`{member.name}`,
 * `{server.name}`) supaya admin yang sudah biasa dengan Discohook tidak perlu
 * menghafal nama baru. Token yang tidak dikenal DIBIARKAN apa adanya: lebih
 * jujur daripada menghapusnya diam-diam, dan admin bisa melihat salah tulis.
 */
export function fillActionText(template: string, context: TemplateContext): string {
  const tokens: Array<[string, string]> = [
    ['{member.mention}', context.mention],
    ['{member.name}', context.member],
    ['{member.id}', context.memberId ?? ''],
    ['{server.name}', context.server],
    ['{role.name}', context.role ?? ''],
    ['{role}', context.role ?? ''],
    ['{effect}', context.effect ?? ''],
    ['{selected}', context.selected ?? ''],
  ];
  let result = template;
  for (const [token, value] of tokens) {
    result = result.split(token).join(value);
  }

  /*
   * Variabel flow diganti BELAKANGAN dan satu per satu, bukan lewat daftar
   * token tetap: namanya ditentukan admin, jadi hanya variabel yang benar-benar
   * ada yang punya nilai. Variabel yang tidak ada dibiarkan apa adanya —
   * supaya salah ketik terlihat, bukan menghilang menjadi teks kosong.
   */
  for (const [kunci, nilai] of Object.entries(context.variables ?? {})) {
    if (!kunci.startsWith('var.')) continue;
    result = result.split(`{${kunci}}`).join(nilai);
  }
  return result;
}

/**
 * Teks balasan bawaan saat admin tidak mengisi apa pun.
 *
 * Admin tetap bisa mengosongkannya, tetapi pesan baku ini lebih berguna
 * daripada tombol yang diam: member tahu role-nya benar-benar berubah.
 */
export function defaultRoleReply(context: TemplateContext): string {
  if (!context.role || !context.effect) return '✅ Selesai.';
  return `✅ Role **${context.role}** ${context.effect}.`;
}
