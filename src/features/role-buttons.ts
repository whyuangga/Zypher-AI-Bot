/**
 * Tombol ambil role — Tahap 3 halaman /pesan.
 *
 * Kenapa modul terpisah: aturan "role ini boleh dibagi atau tidak" dipakai DUA
 * tempat — dashboard (untuk menampilkan peringatan sebelum admin menyimpan)
 * dan bot (untuk menolak klik yang tidak sah). Kalau aturannya ditulis dua
 * kali, cepat atau lambat keduanya berbeda dan admin melihat tombol yang
 * sebenarnya tidak berfungsi.
 *
 * Modul ini murni: tidak menyentuh Discord client maupun database. Yang
 * dibutuhkan hanyalah daftar role dalam bentuk sederhana.
 */

import { PermissionFlagsBits, type Client } from 'discord.js';
import { normalizeButtonStyle, normalizeEmoji } from './custom-post.js';

/** Bentuk role yang dibutuhkan pemeriksaan — bukan objek discord.js penuh. */
export interface RoleLike {
  id: string;
  name: string;
  /** Posisi role di hierarki server. Semakin besar semakin tinggi. */
  position: number;
  /** Role bawaan @everyone tidak boleh dibagi. */
  isEveryone?: boolean;
  /** Role yang dikelola integrasi/bot lain. */
  managed?: boolean;
}

export type RoleBlocker =
  /** Bot tidak punya izin Manage Roles. */
  | 'bot-izin'
  /** Posisi role bot tidak di atas role target. */
  | 'bot-posisi'
  /** Role target di atas member yang mengklik. */
  | 'member-posisi'
  /** Role @everyone atau role terkelola integrasi. */
  | 'role-terlarang'
  /** Member sudah punya role ini. */
  | 'sudah-punya'
  /** Member belum punya role ini (untuk tombol lepas). */
  | 'belum-punya';

/**
 * Alasan dalam bahasa manusia untuk ditampilkan ke admin/member.
 *
 * Dipisah dari kode di atas supaya pesan bisa diperbaiki tanpa menyentuh
 * logika, dan supaya tidak ada dua versi kalimat yang berbeda.
 */
export const BLOCKER_TEXT: Record<RoleBlocker, string> = {
  'bot-izin':
    'Bot tidak punya izin **Manage Roles**. Beri izin itu ke bot, lalu klik lagi.',
  'bot-posisi':
    'Role bot posisinya di bawah role ini. Geser role bot ke ATAS role tersebut di Server Settings → Roles.',
  'member-posisi':
    'Role kamu saat ini lebih rendah dari role ini — hanya admin yang bisa memberi role ini.',
  'role-terlarang': 'Role ini tidak bisa dibagikan lewat tombol.',
  'sudah-punya': 'Kamu sudah punya role ini.',
  'belum-punya': 'Kamu belum punya role ini, jadi tidak ada yang bisa dilepas.',
};

/**
 * Kenapa role ini TIDAK boleh dibagi, atau `null` kalau boleh.
 *
 * Urutan pemeriksaan penting: izin bot dulu (kesalahan paling umum dan
 * paling mudah diperbaiki admin), baru posisi.
 */
export function roleBlocker(options: {
  role: RoleLike;
  /** Posisi tertinggi role milik bot. */
  botHighestPosition: number;
  hasManageRoles: boolean;
}): RoleBlocker | null {
  if (options.role.isEveryone) return 'role-terlarang';
  if (options.role.managed) return 'role-terlarang';
  if (!options.hasManageRoles) return 'bot-izin';
  if (options.role.position >= options.botHighestPosition) return 'bot-posisi';
  return null;
}

/**
 * Apakah member boleh memberi/melepas role ini?
 *
 * Dua syarat, keduanya dari aturan Discord:
 *   1. bot harus berada di atas role target (kalau tidak, Discord menolak)
 *   2. member yang mengklik juga harus di atas role target — kalau tidak,
 *      member biasa bisa memberi dirinya role admin
 */
export function memberCanToggle(options: {
  role: RoleLike;
  /** Posisi tertinggi role milik bot. */
  botHighestPosition: number;
  /** Posisi tertinggi role milik member yang mengklik. */
  memberHighestPosition: number;
  hasManageRoles: boolean;
}): RoleBlocker | null {
  const blocker = roleBlocker(options);
  if (blocker) return blocker;
  // Member yang punya Manage Roles boleh memberi role di bawahnya sendiri.
  if (options.role.position >= options.memberHighestPosition) return 'member-posisi';
  return null;
}

/**
 * Custom ID tombol role.
 *
 * Discord membatasi customId 100 karakter, dan tombol role hanya butuh ID
 * miliknya sendiri karena role disimpan di database (bukan di dalam ID).
 *
 * Format `post-role:<id>` dipilih supaya router tombol bisa memakai
 * `startsWith` — ID-nya dinamis, jadi `switch` per customId tidak bisa dipakai
 * seperti tombol bawaan bot.
 */
export const ROLE_BUTTON_PREFIX = 'post-role:';

export function roleButtonId(buttonId: number): string {
  return `${ROLE_BUTTON_PREFIX}${buttonId}`;
}

/**
 * Custom ID select menu role.
 *
 * Kenapa terpisah dari tombol: keduanya butuh jalur penanganan yang berbeda
 * (interaksi tombol vs interaksi dropdown), jadi prefix-nya juga harus bisa
 * dibedakan sebelum handler dipilih.
 */
export const ROLE_MENU_PREFIX = 'post-menu:';

export function roleMenuId(menuId: number): string {
  return `${ROLE_MENU_PREFIX}${menuId}`;
}

export function parseRoleMenuId(customId: string): number | null {
  if (!customId.startsWith(ROLE_MENU_PREFIX)) return null;
  const rest = customId.slice(ROLE_MENU_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const id = Number(rest);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Ambil ID tombol dari customId. `null` kalau bukan tombol role. */
export function parseRoleButtonId(customId: string): number | null {
  if (!customId.startsWith(ROLE_BUTTON_PREFIX)) return null;
  const rest = customId.slice(ROLE_BUTTON_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const id = Number(rest);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Tombol role: beri role, atau lepas kalau member sudah punya. */
export type RoleButtonMode = 'toggle' | 'give';

export interface RoleButtonInput {
  label: string;
  roleId: string;
  mode: RoleButtonMode;
  /** Emoji tombol (unicode atau <:nama:id>). */
  emoji?: string;
  /** Gaya tombol: primary/secondary/success/danger. */
  style?: string;
}

/**
 * Rapikan daftar tombol role dari input dashboard.
 *
 * Sama seperti `sanitizeBlocks`: tidak melempar, dan mengembalikan alasan
 * penolakan supaya admin tahu. Bedanya di sini role yang sama dua kali hanya
 * dihitung sekali — dua tombol untuk role yang sama membingungkan member.
 */
export function sanitizeRoleButtons(input: unknown): {
  buttons: RoleButtonInput[];
  dropped: string[];
} {
  const dropped: string[] = [];
  const buttons: RoleButtonInput[] = [];
  const seen = new Set<string>();
  const source = Array.isArray(input) ? input : [];

  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 80) : '';
    const roleId = typeof item.roleId === 'string' ? item.roleId.trim() : '';
    const mode = item.mode === 'give' ? 'give' : 'toggle';
    // Emoji & gaya memakai validator yang sama dengan blok tombol — satu
    // aturan untuk dua tempat, supaya tidak ada tombol yang lolos di satu
    // jalur tapi ditolak di jalur lain.
    const emoji = normalizeEmoji(item.emoji);
    const style = normalizeButtonStyle(item.style);

    if (!label) {
      dropped.push('tombol role tanpa label');
      continue;
    }
    // ID role Discord selalu angka (snowflake). Menolak yang bukan angka lebih
    // awal menghemat satu perjalanan ke API.
    if (!/^\d{5,25}$/.test(roleId)) {
      dropped.push(`tombol "${label}" (role belum dipilih)`);
      continue;
    }
    if (seen.has(roleId)) {
      dropped.push(`tombol "${label}" (role yang sama sudah dipakai tombol lain)`);
      continue;
    }
    seen.add(roleId);
    buttons.push({
      label,
      roleId,
      mode,
      style,
      ...(emoji ? { emoji } : {}),
    });
  }

  return { buttons, dropped };
}

/* ------------------------------------------------------------------ */
/*  Select menu role (dropdown)                                        */
/* ------------------------------------------------------------------ */

/** Satu pilihan di dalam dropdown role. */
export interface RoleOptionInput {
  label: string;
  roleId: string;
  /** Emoji pilihan (unicode atau <:nama:id>). */
  emoji?: string;
  /** Keterangan kecil di bawah label. Maksimal 100 karakter. */
  description?: string;
}

/**
 * Satu dropdown role di sebuah pesan.
 *
 * `exclusive` adalah perilaku yang di Discord tidak ada padanannya: kalau
 * aktif, memilih satu role akan MENCABUT role lain yang ada di menu yang sama.
 * Ini yang dipakai server untuk "pilih satu warna" atau "pilih satu platform".
 * Tombol biasa tidak bisa melakukan ini tanpa banyak klik.
 */
export interface RoleMenuInput {
  placeholder: string;
  minValues: number;
  maxValues: number;
  exclusive: boolean;
  options: RoleOptionInput[];
}

/** Batas Discord untuk satu select menu. */
export const MENU_LIMITS = {
  /** Maksimal pilihan per menu. */
  options: 25,
  /** Maksimal karakter placeholder. */
  placeholder: 150,
  label: 100,
  description: 100,
} as const;

/**
 * Rapikan satu dropdown dari input dashboard.
 *
 * `null` = tidak ada menu yang bisa disimpan. Menu dengan satu pilihan tetap
 * diterima: dropdown berisi satu opsi memang terlihat janggal, tapi lebih baik
 * daripada menggagalkan penyimpanan seluruh pesan.
 */
export function sanitizeRoleMenu(input: unknown): RoleMenuInput | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const source = Array.isArray(raw.options) ? raw.options : [];

  const options: RoleOptionInput[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const option = item as Record<string, unknown>;
    const label = typeof option.label === 'string' ? option.label.trim().slice(0, MENU_LIMITS.label) : '';
    const roleId = typeof option.roleId === 'string' ? option.roleId.trim() : '';
    if (!label || !/^\d{5,25}$/.test(roleId) || seen.has(roleId)) continue;
    seen.add(roleId);
    const emoji = normalizeEmoji(option.emoji);
    const description =
      typeof option.description === 'string'
        ? option.description.trim().slice(0, MENU_LIMITS.description)
        : '';
    options.push({
      label,
      roleId,
      ...(emoji ? { emoji } : {}),
      ...(description ? { description } : {}),
    });
    if (options.length >= MENU_LIMITS.options) break;
  }

  if (options.length === 0) return null;

  const min = clampInt(raw.minValues, 1, options.length, 1);
  // max tidak boleh di bawah min — Discord menolak kombinasi itu.
  const max = clampInt(raw.maxValues, min, options.length, min);

  const placeholder =
    typeof raw.placeholder === 'string' && raw.placeholder.trim()
      ? raw.placeholder.trim().slice(0, MENU_LIMITS.placeholder)
      : 'Pilih role';

  return {
    placeholder,
    minValues: min,
    maxValues: max,
    // Default TIDAK eksklusif: mencabut role orang tanpa diminta lebih buruk
    // daripada membiarkannya memilih dua role sekaligus.
    exclusive: raw.exclusive === true,
    options,
  };
}

/**
 * Ambil bilangan bulat dari input dashboard.
 *
 * String diterima karena form HTML mengirim `<input type="number">` sebagai
 * string; menolaknya akan membuat admin mengira batas pilihannya tersimpan
 * padahal diam-diam kembali ke 1.
 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const raw = typeof value === 'string' ? value.trim() : value;
  const n =
    typeof raw === 'number'
      ? Math.trunc(raw)
      : typeof raw === 'string' && /^-?\d+$/.test(raw)
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Beri tahu apakah satu pesan sudah memakai tombol role.
 *
 * Dipakai dashboard untuk menaruh tombol role di pesan yang tepat, dan untuk
 * peringatan "pesan ini butuh izin Manage Roles".
 */
export function hasRoleButtons(buttons: RoleButtonInput[]): boolean {
  return buttons.length > 0;
}

/** Apakah pesan ini memakai komponen interaktif apa pun (tombol atau menu)? */
export function hasRoleComponents(input: {
  buttons?: RoleButtonInput[];
  menu?: RoleMenuInput | null;
}): boolean {
  return (input.buttons?.length ?? 0) > 0 || Boolean(input.menu);
}

/* ------------------------------------------------------------------ */
/*  Membaca role dari server (butuh Discord client)                    */
/* ------------------------------------------------------------------ */

/**
 * Daftar role yang bisa dipilih admin di dashboard, lengkap dengan status
 * "boleh dibagi atau tidak".
 *
 * Alasan status dikirim ke dashboard, bukan hanya disembunyikan: admin perlu
 * tahu SEBELUM mengirim pesan bahwa role tertentu akan gagal — bukan setelah
 * member mengklik dan mendapat pesan error.
 */
export interface RoleOption {
  id: string;
  name: string;
  /** Warna role dalam hex, untuk titik warna di dashboard. */
  color: string;
  position: number;
  /** null = bisa dibagi. Selain itu berisi alasan. */
  blockedBy: RoleBlocker | null;
}

export interface RoleListResult {
  options: RoleOption[];
  hasManageRoles: boolean;
  /** Posisi tertinggi role bot — dipakai untuk menjelaskan hierarki. */
  botHighestPosition: number;
}

/**
 * Susun daftar role untuk dropdown.
 *
 * Inputnya sengaja array biasa, bukan objek discord.js, supaya fungsi ini bisa
 * diuji tanpa server. Pemanggil (web/server.ts) yang mengambil role dari cache.
 */
export function buildRoleOptions(input: {
  roles: Array<{ id: string; name: string; position: number; color?: number; managed?: boolean; isEveryone?: boolean }>;
  botHighestPosition: number;
  hasManageRoles: boolean;
}): RoleListResult {
  const options = [...input.roles]
    // @everyone tidak pernah ditampilkan: tidak bisa dipakai tombol.
    .filter((role) => !role.isEveryone)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5',
      position: role.position,
      blockedBy: roleBlocker({
        role,
        botHighestPosition: input.botHighestPosition,
        hasManageRoles: input.hasManageRoles,
      }),
    }));

  return {
    options,
    hasManageRoles: input.hasManageRoles,
    botHighestPosition: input.botHighestPosition,
  };
}

/**
 * Ambil daftar role dari server Discord.
 *
 * Modul ini tetap murni untuk aturannya; fungsi ini satu-satunya bagian yang
 * menyentuh client, dan sengaja dipisah di bawah supaya mudah dilihat.
 */
export async function listGuildRoles(
  client: Client,
  guildId: string,
): Promise<RoleListResult> {
  const guild = await client.guilds.fetch(guildId);
  await guild.roles.fetch();
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const roles = [...guild.roles.cache.values()].map((role) => ({
    id: role.id,
    name: role.name,
    position: role.position,
    color: role.color,
    managed: role.managed,
    isEveryone: role.id === guild.id,
  }));

  return buildRoleOptions({
    roles,
    botHighestPosition: me.roles.highest.position,
    hasManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
  });
}
