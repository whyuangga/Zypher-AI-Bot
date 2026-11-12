/**
 * Penjalan aksi komponen `/pesan` (versi ringkas flow Discohook).
 *
 * Aturan yang dipegang, dan alasannya:
 *
 *   1. **Satu balasan per interaksi.** Discord hanya menerima satu jawaban
 *      untuk satu interaksi. Aksi role yang berhasil TIDAK lagi membalas
 *      dengan kalimat tetap; balasan ditentukan admin (aksi `reply`), atau
 *      memakai kalimat baku kalau admin tidak mengisi. Aksi pesan dikirim ke
 *      channel, bukan sebagai balasan.
 *   2. **Role dijalankan dulu, kegagalan menghentikan sisanya.** Kalau role
 *      gagal (posisi bot di bawah role target, dsb), member harus melihat
 *      alasannya — bukan "berhasil" yang bohong. Ini padanan `Stop` di
 *      Discohook yang dijalankan otomatis.
 *   3. **Tanpa aksi = perilaku lama.** Tombol role/menu role yang belum punya
 *      aksi tetap ditangani handler lama, jadi pesan yang sudah terkirim tidak
 *      berubah perilakunya setelah fitur ini ada.
 *
 * Modul ini tidak memuat aturan role sendiri: semua pemeriksaan memakai
 * `roleBlocker` milik role-buttons.ts, satu aturan untuk semua jalur.
 */
import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type Interaction,
} from 'discord.js';
import { findActions, getCustomPost } from '../db/repo.js';
import { sendOrUpdatePost } from './custom-post-send.js';
import { errorMessage, logger } from '../lib/logger.js';
import {
  defaultRoleReply,
  fillActionText,
  planActions,
  type PostAction,
  type RoleActionOp,
  type TemplateContext,
} from './post-actions.js';
import { BLOCKER_TEXT, roleBlocker, type RoleBlocker } from './role-buttons.js';

/**
 * Interaksi komponen yang dibutuhkan modul ini.
 *
 * Ditulis struktural, bukan memakai tipe union discord.js: tombol dan lima
 * jenis select menu punya bentuk yang sama untuk keperluan ini, sedangkan
 * union-nya membuat setiap akses properti butuh penyempitan tipe.
 */
export interface KomponenInteraction {
  customId: string;
  guildId: string | null;
  guild: ButtonInteraction['guild'];
  user: ButtonInteraction['user'];
  member: ButtonInteraction['member'];
  replied: boolean;
  deferred: boolean;
  values?: readonly string[];
  reply: (options: Record<string, unknown>) => Promise<unknown>;
  followUp: (options: Record<string, unknown>) => Promise<unknown>;
  deferReply?: (options?: Record<string, unknown>) => Promise<unknown>;
  editReply?: (options?: Record<string, unknown>) => Promise<unknown>;
}

/** Apakah interaksi ini punya customId dan bisa dijawab? */
export function asKomponenInteraction(interaction: Interaction): KomponenInteraction | null {
  const calon = interaction as unknown as KomponenInteraction;
  if (!calon || typeof calon.customId !== 'string') return null;
  if (typeof calon.reply !== 'function' || typeof calon.followUp !== 'function') return null;
  if (typeof calon.user?.id !== 'string') return null;
  return calon;
}

function highestPosition(member: GuildMember): number {
  return member.roles?.highest?.position ?? 0;
}

function teksBlocker(blocker: RoleBlocker): string {
  return `❌ ${BLOCKER_TEXT[blocker]}`;
}

/** Identitas pengklik untuk template. */
function konteksUntuk(interaction: KomponenInteraction, member: GuildMember | null): TemplateContext {
  const nama = member?.displayName ?? interaction.user.globalName ?? interaction.user.username;
  return {
    member: nama,
    mention: `<@${interaction.user.id}>`,
    memberId: interaction.user.id,
    server: interaction.guild?.name ?? 'server ini',
  };
}

/**
 * Jalankan satu aksi role.
 *
 * Mengembalikan hasilnya untuk template (`{role}` dan `{effect}`) sekaligus
 * pesan kegagalan yang bisa langsung ditampilkan.
 */
async function jalankanRole(options: {
  interaction: KomponenInteraction;
  member: GuildMember;
  roleId: string;
  op: RoleActionOp;
}): Promise<{ ok: boolean; text: string; roleName?: string; effect?: 'ditambahkan' | 'dilepas' }> {
  const { interaction, member, roleId, op } = options;
  const guild = interaction.guild;
  if (!guild) return { ok: false, text: '❌ Aksi role hanya bekerja di dalam server.' };

  const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch((): null => null));
  if (!role) {
    return { ok: false, text: '❌ Role untuk aksi ini sudah dihapus dari server. Beri tahu admin.' };
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch((): null => null));
  if (!me) return { ok: false, text: '❌ Bot tidak bisa membaca keanggotaannya sendiri di server ini.' };

  const sudahPunya = member.roles?.cache?.has?.(role.id) ?? false;
  const blocker = roleBlocker({
    role: {
      id: role.id,
      name: role.name,
      position: role.position,
      managed: role.managed,
      isEveryone: role.id === guild.id,
    },
    botHighestPosition: me.roles.highest.position,
    hasManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
  });
  if (blocker) return { ok: false, text: teksBlocker(blocker) };

  /*
   * Member tidak boleh mengubah role yang posisinya setara/lebih tinggi dari
   * dirinya — aturan hierarki Discord. Admin (Manage Roles) dikecualikan
   * karena memang boleh mengelola role di bawah posisinya.
   */
  if (role.position >= highestPosition(member) && !member.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, text: teksBlocker('member-posisi') };
  }

  if (op === 'give' && sudahPunya) {
    return { ok: true, roleName: role.name, text: 'ℹ️ Kamu sudah punya role itu — tidak ada yang berubah.' };
  }
  if (op === 'remove' && !sudahPunya) {
    return { ok: true, roleName: role.name, text: 'ℹ️ Kamu belum punya role itu — tidak ada yang berubah.' };
  }

  const aksi: 'give' | 'remove' = op === 'give' ? 'give' : op === 'remove' ? 'remove' : sudahPunya ? 'remove' : 'give';

  try {
    if (aksi === 'give') {
      await member.roles.add(role.id, 'Aksi komponen /pesan dari dashboard');
    } else {
      await member.roles.remove(role.id, 'Aksi komponen /pesan dari dashboard');
    }
  } catch (error) {
    logger.warn(`Gagal ${aksi === 'give' ? 'memberi' : 'melepas'} role ${role.id}: ${errorMessage(error)}`);
    return {
      ok: false,
      text: `❌ Discord menolak perubahan role. Kemungkinan posisi role bot sekarang di bawah **${role.name}** — admin perlu menggeser role bot ke atas.`,
    };
  }

  logger.info(
    `Aksi role: ${member.user?.tag ?? interaction.user.tag} ${aksi === 'give' ? 'mendapat' : 'kehilangan'} ${role.name}`,
  );
  return {
    ok: true,
    roleName: role.name,
    effect: aksi === 'give' ? 'ditambahkan' : 'dilepas',
    text:
      aksi === 'give'
        ? `✅ Role **${role.name}** sudah ditambahkan.`
        : `✅ Role **${role.name}** sudah dilepas.`,
  };
}

/**
 * Kirim jawaban interaksi.
 *
 * `sudahBalas` menentukan jalur: balasan pertama memakai `reply`, sesudahnya
 * `followUp` — Discord menolak `reply` kedua.
 */
async function jawab(
  interaction: KomponenInteraction,
  options: { text: string; hidden?: boolean; sudahBalas?: boolean },
): Promise<void> {
  const payload = {
    content: options.text,
    ...(options.hidden === false ? {} : { flags: MessageFlags.Ephemeral }),
  };
  try {
    if (options.sudahBalas || interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    // Interaksi kedaluwarsa: kegagalan menjawab tidak boleh membuat aksi
    // dianggap gagal, karena role mungkin sudah berubah.
  }
}

/**
 * Jalankan aksi milik satu komponen.
 *
 * Mengembalikan `true` kalau ada aksi yang dijalankan. `false` berarti
 * komponen ini belum punya aksi — pemanggil memakai jalur lama (tombol role).
 */
export async function runComponentActions(options: {
  client: Client;
  interaction: Interaction;
  /** Target berbentuk `button:<id>`, `option:<id>`, atau `select:<jenis>`. */
  target: string;
  /**
   * ID pesan pemilik komponen, kalau customId-nya membawa ID itu.
   *
   * Untuk select menu, tanpa ini target `select:<jenis>` bisa cocok dengan
   * aksi milik pesan lain yang kebetulan punya menu berjenis sama.
   */
  postId?: number | null;
}): Promise<boolean> {
  const interaction = asKomponenInteraction(options.interaction);
  if (!interaction || !interaction.guildId || !interaction.guild) return false;

  const found = await findActions(interaction.guildId, options.target, options.postId ?? null).catch(
    (): null => null,
  );
  if (!found || found.actions.length === 0) return false;

  const member =
    interaction.member && 'roles' in interaction.member
      ? (interaction.member as GuildMember)
      : await interaction.guild.members.fetch(interaction.user.id).catch((): null => null);
  if (!member) {
    await jawab(interaction, {
      text: '❌ Keanggotaanmu di server ini tidak terbaca. Coba lagi sebentar lagi.',
    });
    return true;
  }

  const konteks = konteksUntuk(interaction, member);
  const plan = planActions(found.actions, { selfPostId: found.postId });
  let sudahBalas = false;

  for (const step of plan.steps) {
    if (step.kind === 'role') {
      const hasil = await jalankanRole({ interaction, member, roleId: step.roleId, op: step.op });
      if (!hasil.ok) {
        /*
         * Kegagalan menghentikan sisa aksi. Discohook menyebutnya `Stop`;
         * di sini otomatis, karena melanjutkan berarti mengirim balasan
         * "berhasil" untuk perubahan yang tidak terjadi.
         */
        await jawab(interaction, { text: hasil.text, sudahBalas });
        return true;
      }
      konteks.role = hasil.roleName ?? '';
      konteks.effect = hasil.effect ?? 'diperbarui';
      continue;
    }

    if (step.kind === 'reply') {
      const isi = fillActionText(step.text, konteks).trim();
      await jawab(interaction, {
        // Teks kosong sesudah penggantian template tidak boleh mengirim pesan
        // kosong (Discord menolaknya) — pakai kalimat baku.
        text: isi || defaultRoleReply(konteks),
        hidden: step.hidden,
        sudahBalas,
      });
      sudahBalas = true;
      continue;
    }

    // step.kind === 'message'
    const tujuan = await getCustomPost(interaction.guildId, step.postId).catch((): null => null);
    if (!tujuan) {
      logger.warn(`Aksi kirim pesan: pesan ${step.postId} tidak ada di server ${interaction.guildId}`);
      continue;
    }
    if (!tujuan.channelId) {
      logger.warn(`Aksi kirim pesan: pesan ${step.postId} belum punya channel tujuan`);
      continue;
    }

    try {
      /*
       * Dikirim lewat jalur yang SAMA dengan tombol "Kirim ke Discord":
       * batas komponen, berkas, dan pemetaan tombol/menu role otomatis
       * berlaku, jadi tidak ada perilaku kedua yang bisa menyimpang.
       */
      await sendOrUpdatePost({
        client: options.client,
        channelId: tujuan.channelId,
        messageId: null,
        blocks: tujuan.blocks,
        accent: tujuan.accent ?? undefined,
      });
    } catch (error) {
      logger.error(`Aksi kirim pesan ${step.postId} gagal`, errorMessage(error));
      await jawab(interaction, {
        text: '❌ Pesan lanjutan gagal dikirim. Beri tahu admin.',
        sudahBalas,
      });
      return true;
    }

    if (step.followUp) {
      const isi = fillActionText(step.followUp, konteks).trim();
      if (isi) {
        await jawab(interaction, { text: isi, hidden: true, sudahBalas });
        sudahBalas = true;
      }
    }
  }

  /*
   * Tidak ada aksi `reply`: member tetap harus tahu hasilnya. Aksi role yang
   * berubah tanpa penjelasan terasa seperti tombol rusak — jadi kalimat baku
   * dipakai, persis seperti perilaku tombol role sebelum fitur aksi ada.
   */
  if (!sudahBalas) {
    await jawab(interaction, {
      text: konteks.role ? defaultRoleReply(konteks) : '✅ Selesai.',
      sudahBalas,
    });
  }

  for (const alasan of plan.skipped) logger.debug(`Aksi dilewati: ${alasan}`);
  return true;
}

/** Apakah daftar aksi ini akan mengubah role (dipakai dasbor untuk peringatan). */
export function actionsTouchRoles(actions: PostAction[] | undefined): boolean {
  return (actions ?? []).some((action) => action.kind === 'role');
}
