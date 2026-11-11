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
import { MessageFlags, PermissionFlagsBits, type ButtonInteraction, type GuildMember } from 'discord.js';
import { findRoleButton, type RoleButton } from '../db/repo.js';
import { BLOCKER_TEXT, memberCanToggle, parseRoleButtonId, type RoleBlocker } from './role-buttons.js';
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
