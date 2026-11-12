/**
 * Aksi komponen `/pesan` — versi ringkas "flow" Discohook.
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
 * Bedanya dengan Discohook, dan alasannya:
 *
 *   - Discohook punya 11 aksi (Check, Stop, Wait, Set variable, Create thread,
 *     Send webhook message, Delete message, dst). Yang diambil di sini hanya
 *     yang benar-benar berguna untuk bot satu-server: role, balasan, dan
 *     mengirim pesan lain yang sudah tersimpan.
 *   - `Wait` dan `Set variable` sengaja belum ada. `Wait` butuh antrean
 *     tahan-restart (bot yang restart di tengah flow akan kehilangan sisa
 *     aksinya), sedangkan `Set variable` baru berguna kalau sudah ada cabang
 *     bersyarat. Menambahkannya setengah matang lebih membingungkan daripada
 *     tidak ada.
 *   - Balasan pada aksi role TIDAK memakai kalimat tetap seperti dulu. Admin
 *     menentukan sendiri teksnya (opsional) — itu yang paling sering diminta
 *     saat memakai Discohook.
 *
 * Sejak penantian tahan-restart tersedia (lihat post-flow.ts), `wait`, `condition`,
 * dan `variable` ikut didukung. Ketiganya tetap TIDAK boleh bergantung pada
 * antrean yang rumit: flow yang menunggu disimpan sebagai sesi, lalu dilanjutkan
 * timer — bukan ditahan di memori.
 */
import { FLOW_LIMITS, isVariableName, normalizeComparator } from './post-flow.js';

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
  /* --- kind = 'delete' --- */
  /** Apa yang dihapus. `pesan` = pesan pemilik komponen (bawaan). */
  what?: 'pesan';
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
   * Discohook membatasi 40 aksi berhitung (10 untuk pengguna gratis) dan
   * menyusun cabang sebagai pohon. Di sini batasnya lebih sederhana: 3 tingkat
   * sarang. Alasannya bukan teknis semata — dashboard harus bisa menampilkan
   * pohonnya, dan cabang 4 tingkat di layar ponsel sudah tidak terbaca.
   */
  branchDepth: 3,
  /** Jumlah aksi dihitung per flow, termasuk yang di dalam cabang. */
  countedPerComponent: 40,
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

/**
 * Rapikan daftar aksi dari input dashboard/JSON.
 *
 * Tidak pernah melempar. Aksi yang tidak sah DIBUANG dengan alasan yang bisa
 * dibaca admin — sama seperti `sanitizeBlocks`, supaya tidak ada bagian pesan
 * yang hilang diam-diam.
 */
export function sanitizeActions(input: unknown): { actions: PostAction[]; dropped: string[] } {
  return sanitizeActionsDalam(input, 0);
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
       * Nilai yang diperiksa HARUS disebut. Tanpa itu, syaratnya diam-diam
       * selalu cocok dan admin mengira percabangannya bekerja.
       */
      const nama = asString(item.value).trim();
      if (!/^[a-zA-Z][\w.]{0,63}$/.test(nama)) {
        dropped.push('aksi syarat tanpa nilai yang diperiksa');
        continue;
      }
      const comparator = normalizeComparator(item.comparator);
      const expected = asString(item.expected).slice(0, FLOW_LIMITS.variableValue);
      // `empty`/`notEmpty` tidak butuh pembanding; menyimpan `expected` kosong
      // lebih jujur daripada memaksa admin mengetik sesuatu yang diabaikan.
      if ((comparator === 'equals' || comparator === 'notEquals' || comparator === 'contains' || comparator === 'notContains')) {
        if (!expected) {
          dropped.push('aksi syarat membutuhkan nilai pembanding');
          continue;
        }
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
        value: nama,
        comparator,
        ...(expected ? { expected } : {}),
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
      actions.push({ kind: 'thread', threadName, private: asBoolean(item.private) });
      continue;
    }

    if (kind === 'delete') {
      actions.push({ kind: 'delete', what: 'pesan' });
      continue;
    }

    // kind === 'message'
    const postId = Number(item.postId);
    if (!Number.isSafeInteger(postId) || postId <= 0) {
      dropped.push('aksi kirim pesan tanpa pesan tujuan');
      continue;
    }
    const followUp = asString(item.followUp).trim().slice(0, ACTION_LIMITS.followUpLength);
    actions.push({
      kind: 'message',
      postId,
      toChannel: item.toChannel === undefined ? true : asBoolean(item.toChannel),
      ...(followUp ? { followUp } : {}),
    });
  }

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
  | { kind: 'message'; postId: number; toChannel: boolean; followUp?: string }
  | { kind: 'wait'; seconds: number }
  | {
      kind: 'condition';
      value: string;
      comparator: string;
      expected?: string;
      /** Cabang yang dijalankan bila cocok / tidak cocok (kosong = hentikan). */
      then?: ActionStep[];
      otherwise?: ActionStep[];
    }
  | { kind: 'dud' }
  | { kind: 'stop'; message?: string }
  | { kind: 'variable'; name: string; value: string; source: 'static' | 'adaptive' | 'get' }
  | { kind: 'thread'; threadName: string; private: boolean }
  | { kind: 'delete' };

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
    if (action.kind === 'message') {
      if (options.selfPostId != null && action.postId === options.selfPostId) {
        skipped.push('aksi mengirim pesan ini sendiri dilewati (akan berulang tanpa henti)');
        continue;
      }
      steps.push({
        kind: 'message',
        postId: action.postId!,
        toChannel: action.toChannel !== false,
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
      steps.push({
        kind: 'condition',
        value: action.value!,
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
      });
      continue;
    }

    if (action.kind === 'delete') {
      steps.push({ kind: 'delete' });
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
