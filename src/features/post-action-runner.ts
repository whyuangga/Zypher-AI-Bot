/**
 * Penjalan aksi komponen `/pesan` — versi ringkas flow Discohook.
 *
 * Aturan yang dipegang, dan alasannya:
 *
 *   1. **Satu balasan per interaksi.** Discord hanya menerima satu jawaban
 *      untuk satu interaksi. Aksi role yang berhasil TIDAK lagi membalas
 *      dengan kalimat tetap; balasan ditentukan admin (aksi `reply`), atau
 *      memakai kalimat baku kalau admin tidak mengisi.
 *   2. **Role dijalankan dulu, kegagalan menghentikan sisanya.** Kalau role
 *      gagal (posisi bot di bawah role target, dsb), member harus melihat
 *      alasannya — bukan "berhasil" yang bohong. Ini padanan `Stop` di
 *      Discohook yang dijalankan otomatis.
 *   3. **Tanpa aksi = perilaku lama.** Tombol role/menu role yang belum punya
 *      aksi tetap ditangani handler lama, jadi pesan yang sudah terkirim tidak
 *      berubah perilakunya setelah fitur ini ada.
 *   4. **Penantian disimpan, bukan ditahan di memori.** `wait` menghentikan
 *      interaksi lalu menyimpan sisa langkah ke database; timer yang
 *      melanjutkannya. Bot yang restart di tengah flow tidak kehilangan
 *      pengingat yang sudah dijanjikan.
 *
 * Modul ini tidak memuat aturan role sendiri: semua pemeriksaan memakai
 * `roleBlocker` milik role-buttons.ts, satu aturan untuk semua jalur.
 */
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type GuildTextThreadManager,
  type Interaction,
} from 'discord.js';
import {
  createFlowSession,
  deleteFlowSession,
  findActions,
  getCustomPost,
  listDueFlowSessions,
  type FlowSession,
} from '../db/repo.js';
import { sendOrUpdatePost } from './custom-post-send.js';
import { errorMessage, logger } from '../lib/logger.js';
import {
  defaultRoleReply,
  fillActionText,
  planActions,
  type ActionStep,
  type PostAction,
  type RoleActionOp,
  type TemplateContext,
} from './post-actions.js';
import {
  describeWait,
  isDue,
  testCondition,
  waitUntil,
  type FlowVariables,
} from './post-flow.js';
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
  channelId?: string | null;
  message?: { id: string; delete: () => Promise<unknown> } | null;
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

/**
 * Nilai untuk template & percabangan.
 *
 * Nama kuncinya sengaja sama dengan Discohook (`member.name`, `role.name`, …)
 * supaya admin yang sudah terbiasa di sana tidak perlu menghafal nama baru.
 */
export function nilaiFlow(context: {
  member: string;
  mention: string;
  memberId?: string;
  server: string;
  role?: string;
  effect?: string;
  selected?: string;
  variables?: FlowVariables;
}): FlowVariables {
  const nilai: FlowVariables = {
    'member.name': context.member,
    'member.mention': context.mention,
    'member.id': context.memberId ?? '',
    'server.name': context.server,
    'role.name': context.role ?? '',
    'role': context.role ?? '',
    'effect': context.effect ?? '',
    'selected': context.selected ?? '',
  };
  for (const [kunci, isi] of Object.entries(context.variables ?? {})) {
    nilai[`var.${kunci}`] = isi;
  }
  return nilai;
}

/**
 * Jalankan satu aksi role.
 *
 * Mengembalikan hasilnya untuk template (`{role}` dan `{effect}`) sekaligus
 * pesan kegagalan yang bisa langsung ditampilkan.
 */
async function jalankanRole(options: {
  guild: NonNullable<KomponenInteraction['guild']>;
  member: GuildMember;
  roleId: string;
  op: RoleActionOp;
  userTag: string;
}): Promise<{ ok: boolean; text: string; roleName?: string; effect?: 'ditambahkan' | 'dilepas' }> {
  const { guild, member, roleId, op } = options;
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
    `Aksi role: ${options.userTag} ${aksi === 'give' ? 'mendapat' : 'kehilangan'} ${role.name}`,
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
 * Lingkungan tempat satu flow berjalan.
 *
 * Dibuat dua kali dengan bentuk yang sama: dari interaksi (klik tombol/opsi)
 * dan dari sesi tersimpan (timer melanjutkan penantian). Itu sebabnya langkah
 * dijalankan oleh satu fungsi — dua salinan akan menyimpang cepat atau lambat.
 */
interface FlowRuntime {
  client: Client;
  guildId: string;
  guild: NonNullable<KomponenInteraction['guild']>;
  member: GuildMember;
  channelId: string | null;
  messageId: string | null;
  postId: number;
  userTag: string;
  konteks: TemplateContext;
  variables: FlowVariables;
  /** Kirim jawaban ke pengklik. `hidden=false` hanya berarti publik. */
  jawab: (teks: string, hidden: boolean) => Promise<void>;
  /** Hapus pesan pemicu (aksi `delete`). */
  hapusPesan: () => Promise<void>;
  /** Untuk peringatan yang tidak boleh menghentikan flow. */
  peringatan: (teks: string) => Promise<void>;
}

type HasilFlow = 'selesai' | 'menunggu' | 'berhenti';

/**
 * Jalankan langkah-langkah flow.
 *
 * `steps` adalah SISA langkah. Saat menemui `wait`, sisa langkah dikembalikan
 * lewat `pending` supaya pemanggil bisa menyimpannya — bukan ditahan di memori.
 */
async function jalankanLangkah(
  runtime: FlowRuntime,
  steps: ActionStep[],
): Promise<{ hasil: HasilFlow; pending?: ActionStep[]; alasan?: string }> {
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;

    if (step.kind === 'role') {
      const hasil = await jalankanRole({
        guild: runtime.guild,
        member: runtime.member,
        roleId: step.roleId,
        op: step.op,
        userTag: runtime.userTag,
      });
      if (!hasil.ok) {
        /*
         * Kegagalan menghentikan sisa aksi. Discohook menyebutnya `Stop`;
         * di sini otomatis, karena melanjutkan berarti mengirim balasan
         * "berhasil" untuk perubahan yang tidak terjadi.
         */
        await runtime.jawab(hasil.text, true);
        return { hasil: 'berhenti', alasan: hasil.text };
      }
      runtime.konteks.role = hasil.roleName ?? '';
      runtime.konteks.effect = hasil.effect ?? 'diperbarui';
      runtime.variables = nilaiFlow({
        member: runtime.konteks.member,
        mention: runtime.konteks.mention,
        memberId: runtime.konteks.memberId,
        server: runtime.konteks.server,
        role: runtime.konteks.role,
        effect: runtime.konteks.effect,
        selected: runtime.variables['selected'] ?? '',
        variables: runtime.variables,
      });
      continue;
    }

    if (step.kind === 'variable') {
      runtime.variables[`var.${step.name}`] = fillActionText(step.value, runtime.konteks);
      continue;
    }

    if (step.kind === 'condition') {
      /*
       * Percabangan di sini sederhana dan disengaja: kalau syarat TIDAK cocok,
       * flow berhenti. Discohook bisa bercabang ke dua jalur berbeda; itu
       * butuh antrean langkah bertingkat yang jauh lebih rumit, dan setengah
       * jadi lebih membingungkan daripada berhenti dengan penjelasan.
       */
      const nilai = runtime.variables[step.value] ?? '';
      const cocok = testCondition({ value: nilai, comparator: step.comparator as never, expected: step.expected });
      if (!cocok) {
        const alasan = `⏹️ Syarat "${step.value}" tidak terpenuhi, jadi aksi berikutnya tidak dijalankan.`;
        await runtime.jawab(alasan, true);
        return { hasil: 'berhenti', alasan };
      }
      continue;
    }

    if (step.kind === 'reply') {
      const isi = fillActionText(step.text, runtime.konteks).trim();
      await runtime.jawab(isi || defaultRoleReply(runtime.konteks), step.hidden);
      continue;
    }

    if (step.kind === 'wait') {
      /*
       * Penantian mengakhiri interaksi sekarang juga. Jawaban sementara
       * dikirim supaya member tahu ada yang akan datang — tombol yang diam
       * beberapa menit terasa seperti rusak.
       */
      await runtime.jawab(`⏳ Diterima. Aksi berikutnya dijalankan dalam ${describeWait(step.seconds)}.`, true);
      return { hasil: 'menunggu', pending: steps.slice(i) };
    }

    if (step.kind === 'thread') {
      const nama = fillActionText(step.threadName, runtime.konteks).trim().slice(0, 100) || 'Thread baru';
      const berhasil = await buatThread(runtime, nama, step.private);
      if (!berhasil) return { hasil: 'berhenti', alasan: 'thread gagal dibuat' };
      continue;
    }

    if (step.kind === 'delete') {
      await runtime.hapusPesan();
      continue;
    }

    // step.kind === 'message'
    const tujuan = await getCustomPost(runtime.guildId, step.postId).catch((): null => null);
    if (!tujuan) {
      logger.warn(`Aksi kirim pesan: pesan ${step.postId} tidak ada di server ${runtime.guildId}`);
      await runtime.peringatan('⚠️ Pesan lanjutan yang dituju sudah dihapus — aksi dilewati.');
      continue;
    }
    if (!tujuan.channelId) {
      logger.warn(`Aksi kirim pesan: pesan ${step.postId} belum punya channel tujuan`);
      await runtime.peringatan('⚠️ Pesan lanjutan belum punya channel tujuan — aksi dilewati.');
      continue;
    }

    try {
      /*
       * Dikirim lewat jalur yang SAMA dengan tombol "Kirim ke Discord":
       * batas komponen, berkas, dan pemetaan tombol/menu role otomatis
       * berlaku, jadi tidak ada perilaku kedua yang bisa menyimpang.
       */
      await sendOrUpdatePost({
        client: runtime.client,
        channelId: tujuan.channelId,
        // Nesting: balasan hanya bisa dipasang di channel yang sama.
        messageId: step.toChannel ? null : runtime.messageId,
        replyTo: step.toChannel || !runtime.messageId || tujuan.channelId !== runtime.channelId
          ? undefined
          : runtime.messageId,
        blocks: tujuan.blocks,
        accent: tujuan.accent ?? undefined,
        postId: tujuan.id,
        /*
         * Nilai template diteruskan supaya teks pesan tujuan bisa memakai
         * `{member.name}`, `{server.name}`, `{selected}`, dan variabel flow.
         * Tanpa ini, tombol yang mengirim "pesan aturan" akan selalu menyapa
         * dengan nama kosong — padahal itu inti dari nesting.
         */
        template: runtime.variables,
      });
    } catch (error) {
      logger.error(`Aksi kirim pesan ${step.postId} gagal`, errorMessage(error));
      await runtime.peringatan('❌ Pesan lanjutan gagal dikirim. Beri tahu admin.');
      return { hasil: 'berhenti', alasan: 'pesan lanjutan gagal dikirim' };
    }

    if (step.followUp) {
      const isi = fillActionText(step.followUp, runtime.konteks).trim();
      if (isi) await runtime.peringatan(isi);
    }
  }

  return { hasil: 'selesai' };
}

/** Buat thread dari pesan pemicu. Gagal = flow berhenti dengan penjelasan. */
async function buatThread(runtime: FlowRuntime, nama: string, privat: boolean): Promise<boolean> {
  if (!runtime.channelId || !runtime.messageId) {
    await runtime.jawab('❌ Thread hanya bisa dibuat dari pesan yang masih ada di channel.', true);
    return false;
  }
  try {
    const channel = await runtime.client.channels.fetch(runtime.channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      await runtime.jawab('❌ Channel pesan ini tidak mendukung thread.', true);
      return false;
    }
    const pesan = await channel.messages.fetch(runtime.messageId).catch((): null => null);
    if (!pesan) {
      await runtime.jawab('❌ Pesan ini sudah tidak ada, jadi thread tidak bisa dibuat.', true);
      return false;
    }
    /*
     * Thread privat dibuat lewat `channel.threads.create` — `startThread` pada
     * pesan hanya bisa membuat thread publik. Kalau channel-nya tidak punya
     * pengelola thread, admin diberi tahu alih-alih mendapat thread publik
     * padahal yang diminta privat.
     */
    const thread: { id: string } | null = privat
      ? 'threads' in channel && channel.threads
        ? await (channel.threads as GuildTextThreadManager<ChannelType.PrivateThread>).create({
            name: nama,
            type: ChannelType.PrivateThread,
            reason: 'Aksi komponen /pesan dari dashboard',
          })
        : null
      : await pesan.startThread({ name: nama, reason: 'Aksi komponen /pesan dari dashboard' });
    if (!thread) {
      await runtime.jawab('❌ Channel ini tidak mendukung thread privat.', true);
      return false;
    }
    await runtime.jawab(`🧵 Thread dibuat: <#${thread.id}>`, false);
    return true;
  } catch (error) {
    logger.warn(`Aksi thread gagal: ${errorMessage(error)}`);
    await runtime.jawab(
      '❌ Thread gagal dibuat. Bot butuh izin **Create Public/Private Threads** di channel ini.',
      true,
    );
    return false;
  }
}

/** Jawaban interaksi: `reply` pertama, `followUp` sesudahnya. */
function jawabInteraksi(interaction: KomponenInteraction): FlowRuntime['jawab'] {
  let sudahBalas = false;
  return async (teks: string, hidden: boolean) => {
    const payload = { content: teks, ...(hidden ? { flags: MessageFlags.Ephemeral } : {}) };
    try {
      if (sudahBalas || interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
      sudahBalas = true;
    } catch {
      // Interaksi kedaluwarsa: kegagalan menjawab tidak boleh membuat aksi
      // dianggap gagal, karena role mungkin sudah berubah.
    }
  };
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
  /**
   * Target berbentuk `button:<id>`, `option:<id>`, `select:<jenis>`, atau
   * `sel:<blok>:<opsi>` untuk satu pilihan blok Select.
   */
  target: string;
  /**
   * Target cadangan bila aksi per pilihan tidak ada — mis. blok Select yang
   * hanya punya aksi untuk seluruh jenis menunya.
   */
  fallbackTarget?: string;
  /** ID pesan pemilik komponen, kalau customId-nya membawa ID itu. */
  postId?: number | null;
}): Promise<boolean> {
  const interaction = asKomponenInteraction(options.interaction);
  if (!interaction || !interaction.guildId || !interaction.guild) return false;

  let found = await findActions(interaction.guildId, options.target, options.postId ?? null).catch(
    (): null => null,
  );
  if ((!found || found.actions.length === 0) && options.fallbackTarget) {
    found = await findActions(interaction.guildId, options.fallbackTarget, options.postId ?? null).catch(
      (): null => null,
    );
  }
  if (!found || found.actions.length === 0) return false;

  const member =
    interaction.member && 'roles' in interaction.member
      ? (interaction.member as GuildMember)
      : await interaction.guild.members.fetch(interaction.user.id).catch((): null => null);
  if (!member) {
    await interaction
      .reply({ content: '❌ Keanggotaanmu di server ini tidak terbaca. Coba lagi sebentar lagi.', flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
    return true;
  }

  const guild = interaction.guild;
  const konteks: TemplateContext = {
    member: member.displayName ?? interaction.user.globalName ?? interaction.user.username,
    mention: `<@${interaction.user.id}>`,
    memberId: interaction.user.id,
    server: guild.name ?? 'server ini',
  };
  const dipilih = (interaction.values ?? []).join(', ');
  const variables = nilaiFlow({ ...konteks, selected: dipilih });

  const runtime: FlowRuntime = {
    client: options.client,
    guildId: interaction.guildId,
    guild,
    member,
    channelId: interaction.channelId ?? null,
    messageId: interaction.message?.id ?? null,
    postId: found.postId,
    userTag: interaction.user.tag,
    konteks,
    variables,
    jawab: jawabInteraksi(interaction),
    peringatan: async (teks: string) => {
      await runtime.jawab(teks, true);
    },
    hapusPesan: async () => {
      /*
       * Hapus pesan pemicu. Sengaja dilaporkan kalau gagal: tombol yang tetap
       * ada sesudah admin memilih "hapus pesan" terlihat seperti fitur rusak.
       */
      try {
        if (!interaction.message) throw new Error('pesan tidak dikenali');
        await interaction.message.delete();
      } catch (error) {
        logger.warn(`Aksi hapus pesan gagal: ${errorMessage(error)}`);
        await runtime.jawab(
          '❌ Pesan gagal dihapus. Bot butuh izin **Manage Messages** di channel ini.',
          true,
        );
      }
    },
  };

  const plan = planActions(found.actions, { selfPostId: found.postId });
  const hasil = await jalankanLangkah(runtime, plan.steps);

  if (hasil.hasil === 'menunggu' && hasil.pending) {
    /*
     * Simpan sisa langkah. `dueAt` dihitung dari aksi tunggu PERTAMA di sisa
     * langkah, lalu aksi tunggu itu dibuang — kalau tidak, sesi akan langsung
     * menunggu lagi untuk durasi yang sama.
     */
    const pertama = hasil.pending[0];
    const detik = pertama?.kind === 'wait' ? pertama.seconds : 1;
    const dueAt = waitUntil(Date.now(), detik);
    if (dueAt !== null && interaction.channelId) {
      await createFlowSession({
        guildId: interaction.guildId,
        postId: found.postId,
        channelId: interaction.channelId,
        messageId: interaction.message?.id ?? null,
        userId: interaction.user.id,
        userName: konteks.member,
        serverName: konteks.server,
        // Variabel disimpan TANPA awalan `var.` supaya nama di dasbor sama
        // dengan yang diketik admin.
        variables: Object.fromEntries(
          Object.entries(runtime.variables)
            .filter(([kunci]) => kunci.startsWith('var.'))
            .map(([kunci, nilai]) => [kunci.slice(4), nilai]),
        ),
        steps: hasil.pending.slice(1),
        dueAt,
      }).catch((error: unknown) => logger.error('Gagal menyimpan sesi flow', errorMessage(error)));
    }
  } else if (hasil.hasil === 'selesai' && !plan.steps.some((step) => step.kind === 'reply')) {
    /*
     * Tidak ada aksi `reply`: member tetap harus tahu hasilnya — kecuali kalau
     * pesannya sudah dihapus oleh aksi `delete` (tidak ada yang tersisa untuk
     * dijawab).
     */
    const dihapus = plan.steps.some((step) => step.kind === 'delete');
    if (!dihapus) {
      await runtime.jawab(konteks.role ? defaultRoleReply(konteks) : '✅ Selesai.', true);
    }
  }

  for (const alasan of plan.skipped) logger.debug(`Aksi dilewati: ${alasan}`);
  return true;
}

/**
 * Lanjutkan sesi flow yang sudah waktunya.
 *
 * Dipanggil timer dari bot. Sesi DIHAPUS LEBIH DULU supaya kegagalan di tengah
 * jalan tidak membuat flow yang sama berjalan berulang setiap putaran timer.
 */
export async function resumeFlowSession(client: Client, session: FlowSession): Promise<void> {
  await deleteFlowSession(session.id).catch((error: unknown) =>
    logger.warn(`Gagal menghapus sesi flow ${session.id}`, errorMessage(error)),
  );

  const guild = await client.guilds.fetch(session.guildId).catch((): null => null);
  if (!guild) {
    logger.warn(`Sesi flow ${session.id}: server ${session.guildId} tidak dijangkau bot — dilewati.`);
    return;
  }
  const member = await guild.members.fetch(session.userId).catch((): null => null);
  if (!member) {
    /*
     * Member sudah keluar. Aksi role tidak masuk akal lagi, dan mengirim
     * pengingat ke orang yang sudah pergi hanya mengganggu channel.
     */
    logger.info(`Sesi flow ${session.id}: member ${session.userId} sudah tidak ada — dilewati.`);
    return;
  }

  const konteks: TemplateContext = {
    member: session.userName,
    mention: `<@${session.userId}>`,
    memberId: session.userId,
    server: session.serverName,
  };
  const variables = nilaiFlow({ ...konteks, variables: session.variables });

  const runtime: FlowRuntime = {
    client,
    guildId: session.guildId,
    guild,
    member,
    channelId: session.channelId,
    messageId: session.messageId,
    postId: session.postId,
    userTag: member.user?.tag ?? session.userId,
    konteks,
    variables,
    /*
     * Lewat timer tidak ada interaksi yang bisa dijawab. Jawaban dikirim ke
     * channel sebagai pesan biasa — ephemeral tidak mungkin di sini, dan
     * menyembunyikannya berarti langkah yang dijanjikan tidak pernah terlihat.
     */
    jawab: async (teks: string, _hidden: boolean) => {
      try {
        const channel = await client.channels.fetch(session.channelId);
        if (channel && channel.isTextBased() && 'send' in channel) {
          await channel.send({ content: teks });
        }
      } catch (error) {
        logger.warn(`Sesi flow ${session.id}: gagal mengirim lanjutan`, errorMessage(error));
      }
    },
    peringatan: async (teks: string) => {
      try {
        const channel = await client.channels.fetch(session.channelId);
        if (channel && channel.isTextBased() && 'send' in channel) {
          await channel.send({ content: teks });
        }
      } catch {
        // Channel hilang: tidak ada yang bisa dilakukan selain mencatat.
        logger.warn(`Sesi flow ${session.id}: channel ${session.channelId} tidak bisa dikirimi pesan.`);
      }
    },
    hapusPesan: async () => {
      if (!session.messageId) return;
      try {
        const channel = await client.channels.fetch(session.channelId);
        if (channel && channel.isTextBased() && 'messages' in channel) {
          const pesan = await channel.messages.fetch(session.messageId).catch((): null => null);
          await pesan?.delete();
        }
      } catch (error) {
        logger.warn(`Sesi flow ${session.id}: gagal menghapus pesan`, errorMessage(error));
      }
    },
  };

  const steps = session.steps as ActionStep[];
  const hasil = await jalankanLangkah(runtime, steps);

  // Rangkaian penantian berikutnya: simpan lagi, jangan tahan di memori.
  if (hasil.hasil === 'menunggu' && hasil.pending) {
    const pertama = hasil.pending[0];
    const detik = pertama?.kind === 'wait' ? pertama.seconds : 1;
    const dueAt = waitUntil(Date.now(), detik);
    if (dueAt !== null) {
      await createFlowSession({
        ...session,
        variables: Object.fromEntries(
          Object.entries(runtime.variables)
            .filter(([kunci]) => kunci.startsWith('var.'))
            .map(([kunci, nilai]) => [kunci.slice(4), nilai]),
        ),
        steps: hasil.pending.slice(1),
        dueAt,
      }).catch((error: unknown) => logger.error('Gagal menyimpan lanjutan sesi flow', errorMessage(error)));
    }
  }
}

/**
 * Satu putaran timer: jalankan semua sesi yang jatuh tempo.
 *
 * Dipisah dari `setInterval` supaya bisa diuji (dan dipanggil manual saat
 * bot baru hidup — sesi yang tertinggal selama bot mati tetap dijalankan).
 */
export async function runDueFlowSessions(client: Client, now = Date.now()): Promise<number> {
  const sesi = await listDueFlowSessions(now).catch((error: unknown) => {
    logger.warn('Gagal membaca sesi flow', errorMessage(error));
    return [];
  });
  let dijalankan = 0;
  for (const satu of sesi) {
    if (!isDue(satu, now)) continue;
    try {
      await resumeFlowSession(client, satu);
      dijalankan += 1;
    } catch (error) {
      logger.error(`Sesi flow ${satu.id} gagal dilanjutkan`, errorMessage(error));
    }
  }
  return dijalankan;
}

/** Apakah daftar aksi ini akan mengubah role (dipakai dasbor untuk peringatan). */
export function actionsTouchRoles(actions: PostAction[] | undefined): boolean {
  return (actions ?? []).some((action) => action.kind === 'role');
}
