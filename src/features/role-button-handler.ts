/**
 * Tombol ambil role: memberi atau melepas role saat member mengklik.
 *
 * Tiga hal yang membuat fitur ini rawan, dan bagaimana masing-masing ditangani:
 *
 *   1. **Izin.** Bot butuh Manage Roles, DAN posisinya harus di atas role yang
 *      dibagikan. Kalau tidak, Discord menolak — tapi pesan errornya tidak
 *      menjelaskan apa pun ke admin. Di sini kedua syarat itu diperiksa lebih
 *      dulu supaya pesannya berguna.
 *
 *   2. **Hierarki member.** Tanpa pemeriksaan posisi member, siapa pun yang
 *      menemukan tombolnya bisa memberi dirinya role moderator. Karena itu
 *      role target harus di bawah role tertinggi member yang mengklik.
 *
 *   3. **Klik ganda.** Orang mengklik dua kali, atau Discord mengirim ulang
 *      interaksi. Memberi role yang sudah dimiliki bukan kesalahan — cukup
 *      dijawab "kamu sudah punya role ini".
 *
 * Semua jawaban memakai `ephemeral`: kegagalan izin sebaiknya tidak
 * dipamerkan ke seluruh channel.
 */
import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type GuildMember,
  type Role,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { findRoleButton, findRoleMenu, type RoleButton } from '../db/repo.js';
import {
  BLOCKER_TEXT,
  memberCanToggle,
  parseRoleButtonId,
  parseRoleMenuId,
  type RoleBlocker,
} from './role-buttons.js';
import { errorMessage, logger } from '../lib/logger.js';

/** Jawaban yang aman ditampilkan ke member. */
function blockerMessage(blocker: RoleBlocker): string {
  return `❌ ${BLOCKER_TEXT[blocker]}`;
}

/**
 * Posisi tertinggi role milik seorang member.
 *
 * `roles.highest` disediakan discord.js dan menghitungnya dari cache; itu yang
 * benar untuk member bot maupun member biasa. Versi pertama fungsi ini membaca
 * `roles.cache` manual dan meledak kalau cache belum terisi (mis. setelah
 * restart) — jadi sekarang memakai API pustaka.
 */
function highestPosition(member: GuildMember | null | undefined): number {
  // `roles` bisa tidak ada pada objek member parsial (mis. hasil fetch yang
  // tidak lengkap, atau interaksi dari gateway yang baru reconnect).
  return member?.roles?.highest?.position ?? 0;
}

export interface ToggleResult {
  /** Teks balasan untuk member. */
  message: string;
  /** true kalau role berubah (diberi/dilepas). */
  changed: boolean;
  /** Perubahan yang terjadi, untuk log. */
  action?: 'give' | 'remove';
}

/**
 * Inti logika, tanpa Discord — bisa diuji langsung.
 *
 * Dipisah dari handler interaksi supaya semua cabang (izin, posisi, sudah
 * punya, belum punya) bisa diuji tanpa server Discord.
 */
export function planToggle(options: {
  button: RoleButton;
  role: { id: string; name: string; position: number; managed?: boolean; isEveryone?: boolean };
  botHighestPosition: number;
  memberHighestPosition: number;
  hasManageRoles: boolean;
  memberHasRole: boolean;
}): { blocker: RoleBlocker | null; action: 'give' | 'remove' | null } {
  const blocker = memberCanToggle({
    role: options.role,
    botHighestPosition: options.botHighestPosition,
    memberHighestPosition: options.memberHighestPosition,
    hasManageRoles: options.hasManageRoles,
  });
  if (blocker) return { blocker, action: null };

  // Mode 'give' hanya memberi; sekali punya, klik berikutnya tidak melakukan apa-apa.
  if (options.button.mode === 'give') {
    if (options.memberHasRole) return { blocker: 'sudah-punya', action: null };
    return { blocker: null, action: 'give' };
  }

  // Mode toggle: klik = beri kalau belum punya, lepas kalau sudah punya.
  return { blocker: null, action: options.memberHasRole ? 'remove' : 'give' };
}

/**
 * Tangani klik tombol role.
 *
 * Mengembalikan `true` kalau customId memang milik tombol role — dipakai
 * router untuk tahu apakah interaksi sudah ditangani.
 */
export async function handleRoleButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const buttonId = parseRoleButtonId(interaction.customId);
  if (buttonId === null) return false;

  // Semua jawaban di sini hanya untuk pengklik.
  const reply = async (content: string): Promise<void> => {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => undefined);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  };

  if (!interaction.guildId || !interaction.guild) {
    await reply('❌ Tombol ini hanya bekerja di dalam server.');
    return true;
  }

  const button = await findRoleButton(interaction.guildId, buttonId);
  if (!button) {
    // Bisa terjadi kalau admin baru saja menyusun ulang tombol: customId lama
    // sudah tidak ada di database. Itu perilaku yang diinginkan.
    await reply('❌ Tombol ini sudah tidak berlaku. Minta admin mengirim ulang pesannya.');
    return true;
  }

  const member =
    interaction.member && 'roles' in interaction.member
      ? (interaction.member as GuildMember)
      : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!member) {
    await reply('❌ Keanggotaanmu di server ini tidak terbaca. Coba lagi sebentar lagi.');
    return true;
  }

  const role = interaction.guild.roles.cache.get(button.roleId) ?? (await interaction.guild.roles.fetch(button.roleId).catch(() => null));
  if (!role) {
    await reply('❌ Role itu sudah dihapus dari server. Beri tahu admin.');
    return true;
  }

  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));
  if (!me) {
    await reply('❌ Bot tidak bisa membaca keanggotaannya sendiri di server ini.');
    return true;
  }

  const plan = planToggle({
    button,
    role: {
      id: role.id,
      name: role.name,
      position: role.position,
      managed: role.managed,
      isEveryone: role.id === interaction.guild.id,
    },
    botHighestPosition: highestPosition(me),
    memberHighestPosition: highestPosition(member),
    hasManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
    // Kalau cache role member belum terisi, anggap belum punya. Akibatnya
    // tombol toggle memberi role (bukan melepas) — arah yang aman.
    memberHasRole: member.roles?.cache?.has?.(role.id) ?? false,
  });

  if (plan.blocker) {
    await reply(blockerMessage(plan.blocker));
    return true;
  }

  try {
    if (plan.action === 'give') {
      await member.roles.add(role.id, 'Tombol ambil role di pesan dashboard');
      await reply(`✅ Role **${role.name}** sudah ditambahkan.`);
    } else {
      await member.roles.remove(role.id, 'Tombol lepas role di pesan dashboard');
      await reply(`✅ Role **${role.name}** sudah dilepas.`);
    }
  } catch (error) {
    const pesan = errorMessage(error);
    // Kesalahan paling sering: posisi role berubah SETELAH pesan dikirim.
    logger.warn(`Gagal ${plan.action === 'give' ? 'memberi' : 'melepas'} role ${role.id}: ${pesan}`);
    await reply(
      `❌ Discord menolak perubahan role. Kemungkinan posisi role bot sekarang di bawah **${role.name}** — admin perlu menggeser role bot ke atas.`,
    );
    return true;
  }

  // Catatan: role SUDAH berubah di titik ini. Kegagalan menulis log tidak
  // boleh membuat interaksi dianggap gagal — dulu `member.user.tag` bisa
  // melempar di sini dan member melihat pesan error padahal role-nya sudah
  // diberikan. Karena itu identitasnya diambil dengan cadangan.
  const siapa = member.user?.tag ?? interaction.user.tag;
  logger.info(
    `Role ${role.name} (${role.id}) ${plan.action === 'give' ? 'diberikan ke' : 'dilepas dari'} ${siapa}`,
  );
  return true;
}

/* ------------------------------------------------------------------ */
/*  Select menu role                                                   */
/* ------------------------------------------------------------------ */

/** Rencana perubahan role dari satu dropdown. Semua isinya role ID. */
export interface MenuPlan {
  give: string[];
  remove: string[];
  /** Role yang tidak bisa disentuh, beserta alasannya. */
  blocked: Array<{ roleId: string; blocker: RoleBlocker }>;
}

/**
 * Hitung perubahan role dari pilihan dropdown — tanpa menyentuh Discord.
 *
 * Cara Discord mengirim nilai sangat penting di sini: `interaction.values`
 * berisi SELURUH pilihan yang aktif setelah perubahan, bukan hanya yang baru
 * dicentang. Jadi "role yang harus dilepas" tidak dikirim Discord sama sekali
 * untuk dropdown biasa, dan untuk mode eksklusif harus disimpulkan sendiri:
 * semua role di menu yang sedang dipegang member tapi TIDAK ada di values.
 *
 * `allow` mengembalikan alasan kalau role tidak boleh diubah (izin bot, posisi
 * hierarki, role terlarang). Dipanggil terpisah untuk memberi dan melepas
 * karena keduanya butuh posisi bot yang sama, tapi hanya pemberian yang perlu
 * dibatasi hierarki member.
 */
export function planMenuSelection(options: {
  /**
   * Hanya butuh `exclusive` + daftar role. Sengaja tidak memakai tipe baris
   * database penuh supaya fungsi ini bisa diuji tanpa database dan tidak
   * ikut berubah saat kolom tabel bertambah.
   */
  menu: { exclusive: boolean; options: Array<{ roleId: string }> };
  /** Role ID dari `interaction.values`. */
  selectedRoleIds: string[];
  /** Role ID yang sedang dipegang member. */
  heldRoleIds: string[];
  /** Alasan role tidak boleh diberi ke member, atau null. */
  allow: (roleIsHeld: boolean, roleId: string) => RoleBlocker | null;
}): MenuPlan {
  const selected = new Set(options.selectedRoleIds);
  const held = new Set(options.heldRoleIds);
  const plan: MenuPlan = { give: [], remove: [], blocked: [] };

  const byRoleId = new Map<string, { roleId: string }>();
  for (const option of options.menu.options) byRoleId.set(option.roleId, option);

  for (const roleId of selected) {
    // Nilai yang tidak ada di menu berarti menu sudah disusun ulang. Diamkan:
    // memberi role dari nilai asing justru lubang keamanan.
    if (!byRoleId.has(roleId)) continue;
    const sudahPunya = held.has(roleId);
    const blocker = options.allow(sudahPunya, roleId);
    if (blocker) {
      plan.blocked.push({ roleId, blocker });
      continue;
    }
    if (!sudahPunya) plan.give.push(roleId);
  }

  if (options.menu.exclusive) {
    // Mode eksklusif: role lain DI MENU YANG SAMA dicabut. Role di luar menu
    // tidak pernah disentuh — kalau tidak, satu dropdown warna bisa menghapus
    // role staf seseorang.
    for (const option of options.menu.options) {
      if (selected.has(option.roleId)) continue;
      if (!held.has(option.roleId)) continue;
      const blocker = options.allow(true, option.roleId);
      if (blocker) {
        // Tidak perlu dilaporkan: tujuannya melepas, dan kalau gagal role-nya
        // hanya tetap terpasang. Melaporkannya akan membingungkan karena
        // member tidak meminta role itu dilepas.
        continue;
      }
      plan.remove.push(option.roleId);
    }
  }

  return plan;
}

/** Nama role untuk pesan balasan; fallback ke ID kalau sudah terhapus. */
function roleNameFor(cache: Map<string, string>, roleId: string): string {
  return cache.get(roleId) ?? `<@&${roleId}>`;
}

/**
 * Tangani pilihan dropdown role.
 *
 * Mengembalikan `true` kalau customId memang milik dropdown role.
 */
export async function handleRoleMenu(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (!interaction.isStringSelectMenu()) return false;
  const menuId = parseRoleMenuId(interaction.customId);
  if (menuId === null) return false;

  const reply = async (content: string): Promise<void> => {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => undefined);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  };

  if (!interaction.guildId || !interaction.guild) {
    await reply('❌ Menu ini hanya bekerja di dalam server.');
    return true;
  }

  const menu = await findRoleMenu(interaction.guildId, menuId);
  if (!menu) {
    await reply('❌ Menu ini sudah tidak berlaku. Minta admin mengirim ulang pesannya.');
    return true;
  }

  const member =
    interaction.member && 'roles' in interaction.member
      ? (interaction.member as GuildMember)
      : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await reply('❌ Keanggotaanmu di server ini tidak terbaca. Coba lagi sebentar lagi.');
    return true;
  }

  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));
  if (!me) {
    await reply('❌ Bot tidak bisa membaca keanggotaannya sendiri di server ini.');
    return true;
  }

  const hasManageRoles = me.permissions.has(PermissionFlagsBits.ManageRoles);
  const botHighest = highestPosition(me);
  const memberHighest = highestPosition(member);

  // Nama role diambil sekali untuk semua opsi menu, supaya pesan balasan tidak
  // perlu fetch per role.
  const names = new Map<string, string>();

  const allow = (roleIsHeld: boolean, roleId: string): RoleBlocker | null => {
    const role: Role | undefined = interaction.guild!.roles.cache.get(roleId);
    if (!role) return 'role-terlarang';
    names.set(roleId, role.name);
    const blocker = memberCanToggle({
      role: {
        id: role.id,
        name: role.name,
        position: role.position,
        managed: role.managed,
        isEveryone: role.id === interaction.guild!.id,
      },
      botHighestPosition: botHighest,
      memberHighestPosition: memberHighest,
      hasManageRoles,
    });
    // Untuk melepas role, hierarki member tidak relevan: kalau role-nya sudah
    // dipegang, member memang boleh melepasnya sendiri.
    if (blocker === 'member-posisi' && roleIsHeld) return null;
    return blocker;
  };

  const heldRoleIds = [...(member.roles?.cache?.keys?.() ?? [])];
  const plan = planMenuSelection({
    menu,
    selectedRoleIds: interaction.values,
    heldRoleIds,
    allow,
  });

  if (plan.blocked.length > 0) {
    // Satu pesan ringkas: menyebut semua role yang gagal akan panjang dan
    // yang pertama biasanya sudah cukup untuk menjelaskan sebabnya.
    const first = plan.blocked[0];
    await reply(blockerMessage(first.blocker));
    return true;
  }

  if (plan.give.length === 0 && plan.remove.length === 0) {
    await reply('✅ Pilihanmu sudah sesuai — tidak ada role yang berubah.');
    return true;
  }

  const alasan = `Menu role di pesan dashboard (${menu.placeholder})`;
  try {
    if (plan.give.length > 0) await member.roles.add(plan.give, alasan);
    // Dilepas SETELAH memberi: kalau memberi gagal, role lama belum sempat
    // hilang dan member tidak terjebak tanpa role sama sekali.
    if (plan.remove.length > 0) await member.roles.remove(plan.remove, alasan);
  } catch (error) {
    logger.warn(`Gagal mengubah role lewat menu ${menuId}: ${errorMessage(error)}`);
    await reply(
      '❌ Discord menolak perubahan role. Kemungkinan posisi role bot sekarang di bawah role yang dipilih — admin perlu menggeser role bot ke atas.',
    );
    return true;
  }

  const bagian: string[] = [];
  if (plan.give.length > 0) {
    bagian.push(`ditambahkan: ${plan.give.map((id) => `**${roleNameFor(names, id)}**`).join(', ')}`);
  }
  if (plan.remove.length > 0) {
    bagian.push(`dilepas: ${plan.remove.map((id) => `**${roleNameFor(names, id)}**`).join(', ')}`);
  }
  await reply(`✅ Role ${bagian.join(' • ')}.`);

  const siapa = member.user?.tag ?? interaction.user.tag;
  logger.info(`Menu ${menuId}: ${siapa} → +${plan.give.length} / -${plan.remove.length} role`);
  return true;
}
