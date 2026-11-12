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
 */

/* ------------------------------------------------------------------ */
/*  Jenis aksi                                                         */
/* ------------------------------------------------------------------ */

/**
 * `role` — beri/lepas/ganti role.
 * `reply` — balas pengklik (boleh hanya dia yang melihat).
 * `message` — kirim pesan lain dari daftar pesan tersimpan.
 */
export const ACTION_KINDS = ['role', 'reply', 'message'] as const;
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
};

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
  | { kind: 'message'; postId: number; toChannel: boolean; followUp?: string };

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
    }
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
    ['{role}', context.role ?? ''],
    ['{effect}', context.effect ?? ''],
  ];
  let result = template;
  for (const [token, value] of tokens) {
    result = result.split(token).join(value);
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
