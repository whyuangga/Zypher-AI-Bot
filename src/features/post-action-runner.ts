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
import {
  sendOrUpdatePost,
  sendOrUpdatePostViaWebhook,
  identitasPost,
  sendOrUpdateEmbedPost,
  webhookIdentityFor,
} from './custom-post-send.js';
import { listRoleButtons, listRoleMenus } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';
import { buildTemplateValues } from './post-template.js';
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
  evaluateCondition,
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

/**
 * Selaraskan konteks template dengan variabel flow.
 *
 * Dipanggil sesudah variabel berubah, supaya `{var.nama}` dan `{role}` selalu
 * mencerminkan keadaan TERKINI saat teks diganti. Dulu konteks hanya diisi
 * sekali di awal, sehingga `{var.jalur}` yang disetel sebuah aksi tetap
 * tercetak mentah di balasan berikutnya — bug yang lolos karena tidak ada tes
 * yang memakai variabel di dua aksi berbeda.
 */
function sinkronKonteks(runtime: {
  konteks: TemplateContext;
  variables: FlowVariables;
}): void {
  const variabel: Record<string, string> = {};
  for (const [kunci, nilai] of Object.entries(runtime.variables)) {
    if (kunci.startsWith('var.')) variabel[kunci] = nilai;
  }
  runtime.konteks.variables = variabel;
  runtime.konteks.selected = runtime.variables['selected'] ?? '';
  runtime.konteks.role = runtime.variables['role.name'] ?? runtime.konteks.role;
  runtime.konteks.effect = runtime.variables['effect'] ?? runtime.konteks.effect;
}

/**
 * Nilai template tambahan dari objek Discord.
 *
 * Dipisah sebagai fungsi supaya jalur interaksi dan jalur sesi (timer) memakai
 * isi yang sama. Tanpa ini, `{channel.name}` terisi saat tombol diklik tetapi
 * kosong saat flow dilanjutkan timer — perbedaan yang mustahil dilihat admin
 * kecuali kebetulan memakai token itu di aksi sesudah penantian.
 */
function nilaiKonteks(opsi: {
  guild: NonNullable<KomponenInteraction['guild']>;
  member: GuildMember;
  channelId: string | null;
}): Record<string, string> {
  const { guild, member, channelId } = opsi;
  /*
   * Semua dibaca BERSYARAT. `member.user` selalu ada di Discord sungguhan,
   * tetapi objek member yang datang dari cache lama atau interaksi sebagian
   * bisa tidak membawanya — dan merakit nilai template tidak boleh membuat
   * seluruh flow gagal hanya karena satu token tidak bisa diisi.
   */
  const user = member.user;
  const pengelolaChannel = guild.channels?.cache as
    | { get?: (id: string) => unknown }
    | undefined;
  const channel = channelId
    ? (pengelolaChannel?.get?.(channelId) as { name?: string } | undefined)
    : undefined;
  const avatar = member.displayAvatarURL?.({ size: 256 });
  const ikon = guild.iconURL?.({ size: 256 });
  return buildTemplateValues({
    memberName: member.displayName ?? user?.globalName ?? user?.username,
    ...(user?.username ? { username: user.username } : {}),
    ...(user?.discriminator !== undefined ? { discriminator: user.discriminator } : {}),
    ...(user?.id ? { memberId: user.id } : {}),
    ...(user?.tag ? { tag: user.tag } : {}),
    ...(avatar ? { avatarUrl: avatar } : {}),
    ...(typeof (member.roles?.cache as { keys?: unknown } | undefined)?.keys === 'function'
      ? { roleIds: [...(member.roles.cache as unknown as Map<string, unknown>).keys()] }
      : {}),
    serverId: guild.id,
    ...(guild.name ? { serverName: guild.name } : {}),
    ...(ikon ? { serverIconUrl: ikon } : {}),
    ...(typeof guild.memberCount === 'number' ? { memberCount: guild.memberCount } : {}),
    ...(typeof guild.premiumSubscriptionCount === 'number'
      ? { boostCount: guild.premiumSubscriptionCount }
      : {}),
    ...(typeof guild.roles?.cache?.size === 'number' ? { roleCount: guild.roles.cache.size } : {}),
    ...(channelId ? { channelId } : {}),
    ...(channel?.name ? { channelName: channel.name } : {}),
  });
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
/**
 * Hasil aksi terakhir, untuk variabel `adaptive`.
 *
 * Discohook menyebutnya "adaptive variable": nilai diambil dari hasil aksi
 * sebelumnya (mis. `channel_id` dari pesan yang baru dikirim). Di sini yang
 * tersedia hanya nilai yang benar-benar kita punya — mengarang nilai lain
 * hanya akan membuat flow tampak bisa sesuatu yang belum bisa.
 */
interface HasilAksi {
  messageId?: string;
  channelId?: string;
  threadId?: string;
}

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
  /**
   * Hapus pesan (aksi `delete`).
   *
   * `sasaran` = `pesan` (pesan pemilik komponen) atau `sebelumnya` (pesan yang
   * dikirim aksi kirim terakhir di flow ini). Mengembalikan `false` kalau
   * tidak ada yang bisa dihapus, supaya runner bisa melaporkannya alih-alih
   * diam.
   */
  hapusPesan: (sasaran: 'pesan' | 'sebelumnya') => Promise<boolean>;
  /** Untuk peringatan yang tidak boleh menghentikan flow. */
  peringatan: (teks: string) => Promise<void>;
  /** Hasil aksi terakhir (diisi runner), dipakai variabel `adaptive`. */
  hasil?: HasilAksi;
}

type HasilFlow = 'selesai' | 'menunggu' | 'berhenti';

/**
 * Jalankan langkah-langkah flow.
 *
 * `steps` adalah SISA langkah. Saat menemui `wait`, sisa langkah dikembalikan
 * lewat `pending` supaya pemanggil bisa menyimpannya — bukan ditahan di memori.
 *
 * Cabang bersyarat TIDAK dijalankan dengan panggilan rekursif yang menyembunyikan
 * sisa langkahnya. Cabang yang dipilih DISISIPKAN ke daftar kerja yang sedang
 * berjalan (lihat `jalankanLangkah` pada `condition`), sehingga:
 *
 *   1. `wait` di dalam cabang ikut tersimpan sebagai sesi — dulu cabang
 *      dijalankan lewat rekursi, dan `pending`-nya hanya berisi sisa langkah
 *      cabang; aksi SESUDAH syarat hilang begitu bot restart.
 *   2. Cabang bertingkat (5 tingkat) tidak menumpuk tumpukan panggilan.
 *   3. `stop` di dalam cabang menghentikan SELURUH flow, bukan hanya cabangnya
 *      (perilaku lama: cabang yang berhenti membuat sisa langkah luar hilang
 *      tanpa penjelasan).
 */
async function jalankanLangkah(
  runtime: FlowRuntime,
  steps: ActionStep[],
): Promise<{ hasil: HasilFlow; pending?: ActionStep[]; alasan?: string }> {
  /*
   * Daftar kerja: satu-satunya sumber urutan. Cabang yang dipilih disisipkan
   * di posisi sesudah aksi syarat, jadi "lanjut ke aksi berikutnya" bekerja
   * sama di tingkat atas maupun di dalam cabang.
   */
  const kerja: ActionStep[] = [...steps];
  for (let i = 0; i < kerja.length; i += 1) {
    const step = kerja[i]!;

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
      runtime.variables = {
        ...runtime.variables,
        'role.name': hasil.roleName ?? '',
        role: hasil.roleName ?? '',
        effect: hasil.effect ?? 'diperbarui',
      };
      sinkronKonteks(runtime);
      continue;
    }

    if (step.kind === 'variable') {
      /*
       * Tiga sumber nilai, sama seperti Discohook:
       *   static   teks admin (boleh template);
       *   adaptive nilai dari hasil aksi sebelumnya (messageId/channelId/threadId);
       *   get      salinan variabel lain (nama lengkap, mis. `var.kode`).
       */
      let nilai = '';
      if (step.source === 'adaptive') {
        const kunci = step.value.trim() as keyof HasilAksi;
        nilai = runtime.hasil?.[kunci] ?? '';
        if (!nilai) {
          await runtime.peringatan(
            `⚠️ Variabel "${step.name}" tidak terisi: aksi sebelumnya tidak menghasilkan "${step.value}".`,
          );
        }
      } else if (step.source === 'get') {
        nilai = runtime.variables[step.value.trim()] ?? '';
      } else {
        nilai = fillActionText(step.value, runtime.konteks);
      }
      runtime.variables[`var.${step.name}`] = nilai;
      sinkronKonteks(runtime);
      continue;
    }

    if (step.kind === 'dud') {
      // "Do nothing": sengaja tidak melakukan apa pun, tetapi tetap dihitung
      // sebagai langkah supaya urutan yang disusun admin tidak bergeser.
      continue;
    }

    if (step.kind === 'stop') {
      const pesan = step.message ? fillActionText(step.message, runtime.konteks).trim() : '';
      await runtime.jawab(pesan || '⏹️ Flow dihentikan.', true);
      return { hasil: 'berhenti', alasan: pesan || 'aksi hentikan' };
    }

    if (step.kind === 'condition') {
      /*
       * Dua bentuk syarat, satu tempat evaluasi:
       *   - `check` (pohon and/or/not/in) dievaluasi rekursif;
       *   - `value`/`comparator`/`expected` (datar) memakai testCondition.
       * Yang tidak ada variabelnya menghasilkan string kosong, sehingga
       * `empty` berlaku apa adanya — tidak ada nilai "ajaib".
       */
      let cocok: boolean;
      if (step.check) {
        cocok = evaluateCondition(step.check, (nama) => runtime.variables[nama] ?? '');
      } else {
        const nilai = runtime.variables[step.value ?? ''] ?? '';
        cocok = testCondition({ value: nilai, comparator: step.comparator as never, expected: step.expected });
      }

      /*
       * Dua bentuk, keduanya sah:
       *   - dengan cabang (`then`/`else`): jalankan cabangnya, lalu LANJUT ke
       *     aksi sesudahnya — persis seperti `Check` di Discohook;
       *   - tanpa cabang: perilaku lama, syarat tidak cocok menghentikan flow.
       * Bentuk kedua dipertahankan supaya aksi yang sudah tersimpan sebelum
       * cabang ada tidak berubah artinya diam-diam.
       */
      const punyaCabang = Boolean(step.then?.length || step.otherwise?.length);
      if (!punyaCabang) {
        if (!cocok) {
          const alasan = `⏹️ Syarat "${step.value ?? 'bertingkat'}" tidak terpenuhi, jadi aksi berikutnya tidak dijalankan.`;
          await runtime.jawab(alasan, true);
          return { hasil: 'berhenti', alasan };
        }
        continue;
      }

      const cabang = cocok ? (step.then ?? []) : (step.otherwise ?? []);
      if (cabang.length === 0) {
        // Cabang kosong bukan kesalahan: admin memang tidak ingin apa pun
        // terjadi di jalur itu. Tidak ada pesan apa pun — jangan mengganggu.
        continue;
      }
      /*
       * Sisipkan cabang TEPAT sesudah aksi syarat ini. Dengan begitu sisa
       * langkah sesudah cabang tetap berada di daftar kerja yang sama, ikut
       * tersimpan saat ada `wait`, dan `stop` di dalam cabang menghentikan
       * seluruh flow (bukan hanya cabangnya). Hal yang sama berlaku untuk
       * cabang yang bersarang: penyisipan berulang membuat urutannya persis
       * urutan yang dibaca admin di dasbor.
       */
      kerja.splice(i + 1, 0, ...cabang);
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
      /*
       * Yang disimpan adalah SISA DAFTAR KERJA, bukan sisa `steps` asli:
       * kalau penantian berada di dalam cabang, sisa itu sudah memuat cabang
       * yang belum dijalankan DAN langkah sesudah syaratnya. Versi lama
       * menyimpan `steps.slice(i)` sehingga aksi sesudah syarat hilang.
       */
      return { hasil: 'menunggu', pending: kerja.slice(i) };
    }

    if (step.kind === 'thread') {
      const nama = fillActionText(step.threadName, runtime.konteks).trim().slice(0, 100) || 'Thread baru';
      const berhasil = await buatThread(runtime, nama, {
        private: step.private,
        ...(step.autoArchiveMinutes !== undefined ? { autoArchiveMinutes: step.autoArchiveMinutes } : {}),
        ...(step.slowmodeSeconds !== undefined ? { rateLimitPerUser: step.slowmodeSeconds } : {}),
        ...(step.invitable !== undefined ? { invitable: step.invitable } : {}),
        ...(step.appliedTags?.length ? { appliedTags: step.appliedTags } : {}),
        ...(step.threadMessage
          ? { pesanPembuka: fillActionText(step.threadMessage, runtime.konteks).trim() }
          : {}),
      });
      if (!berhasil) return { hasil: 'berhenti', alasan: 'thread gagal dibuat' };
      continue;
    }

    if (step.kind === 'delete') {
      const berhasil = await runtime.hapusPesan(step.what);
      if (!berhasil) {
        /*
         * Tidak ada yang dihapus. Discohook menggagalkan flow di kasus ini
         * ("No messageId variable was set"), dan itu masuk akal: admin yang
         * menyusun "hapus pesan sebelumnya" mengharapkan pesannya hilang.
         * Bedanya, di sini alasannya diberitahukan ke pengklik lebih dulu.
         */
        const alasan =
          step.what === 'sebelumnya'
            ? '❌ Tidak ada pesan dari aksi sebelumnya yang bisa dihapus.'
            : '❌ Pesan ini tidak bisa dihapus. Bot butuh izin Manage Messages.';
        await runtime.jawab(alasan, true);
        await runtime.peringatan(alasan);
        return { hasil: 'berhenti', alasan };
      }
      continue;
    }

    if (step.kind === 'raw') {
      const isi = fillActionText(step.text, runtime.konteks).trim();
      if (!isi) {
        // Templat yang seluruhnya kosong: pesan kosong ditolak Discord, jadi
        // dilewati dengan laporan alih-alih gagal di API.
        await runtime.peringatan('⚠️ Teks aksi kosong setelah templat diisi — aksi dilewati.');
        continue;
      }
      try {
        const channelId = step.channelId ?? runtime.channelId;
        if (!channelId) throw new Error('channel tidak dikenali');
        const channel = await runtime.client.channels.fetch(channelId);
        if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
          throw new Error('channel tidak bisa dikirimi pesan');
        }
        const terkirim = (await channel.send({ content: isi.slice(0, 2000) })) as {
          id: string;
          channelId?: string;
        };
        runtime.hasil = {
          messageId: terkirim.id,
          channelId: terkirim.channelId ?? channelId,
        };
      } catch (error) {
        logger.warn(`Aksi kirim teks gagal: ${errorMessage(error)}`);
        await runtime.peringatan('❌ Teks gagal dikirim. Beri tahu admin.');
        return { hasil: 'berhenti', alasan: 'teks gagal dikirim' };
      }
      continue;
    }

    // step.kind === 'message' (termasuk `viaWebhook`)
    const tujuan = await getCustomPost(runtime.guildId, step.postId).catch((): null => null);
    if (!tujuan) {
      logger.warn(`Aksi kirim pesan: pesan ${step.postId} tidak ada di server ${runtime.guildId}`);
      await runtime.peringatan('⚠️ Pesan lanjutan yang dituju sudah dihapus — aksi dilewati.');
      continue;
    }
    /*
     * Channel tujuan: pilihan aksi MENANG atas channel pesan tersimpan.
     * Discohook juga begitu — pesan dipakai sebagai ISI, channel ditentukan
     * per aksi. Tanpa channel di keduanya, tidak ada tempat mengirim.
     */
    const channelTujuan = step.channelId ?? tujuan.channelId;
    if (!channelTujuan) {
      logger.warn(`Aksi kirim pesan: pesan ${step.postId} belum punya channel tujuan`);
      await runtime.peringatan('⚠️ Pesan lanjutan belum punya channel tujuan — aksi dilewati.');
      continue;
    }

    try {
      let terkirim: { messageId: string };
      /*
       * Pesan tujuan berBENTUK EMBED punya jalur kirim sendiri, dan harus
       * didahulukan dari jalur webhook/V2: aturan Discord berlawanan (embed
       * tidak boleh membawa flag V2, V2 tidak boleh membawa embeds). Tanpa
       * cabang ini, aksi "kirim pesan tersimpan" mengirim embed sebagai kartu
       * V2 — pesan yang tampak berbeda dari saat dikirim manual.
       */
      if (tujuan.layout === 'embed') {
        if (step.viaWebhook) {
          await runtime.peringatan(
            'ℹ️ Pesan tujuan berbentuk embed dikirim lewat bot — embed klasik tidak butuh webhook.',
          );
        }
        if (runtime.messageId && !step.toChannel) {
          await runtime.peringatan(
            'ℹ️ Pesan berbentuk embed dikirim sebagai pesan baru, bukan balasan — Discord tidak mengizinkan balasan berisi embed dari aksi ini.',
          );
        }
        const tombolEmbed = await listRoleButtons(runtime.guildId, tujuan.id).catch(() => []);
        const menuEmbed = await listRoleMenus(runtime.guildId, tujuan.id).catch(() => []);
        terkirim = await sendOrUpdateEmbedPost({
          client: runtime.client,
          channelId: channelTujuan,
          messageId: null,
          blocks: tujuan.blocks,
          accent: tujuan.accent,
          title: tujuan.name,
          postId: tujuan.id,
          flags: tujuan.flags || undefined,
          allowedMentions: tujuan.allowedMentions,
          embed: tujuan.embed,
          threadName: tujuan.threadName,
          roleButtons: tombolEmbed.map((satu) => ({
            id: satu.id,
            label: satu.label,
            emoji: satu.emoji ?? null,
            style: satu.style ?? null,
          })),
          roleMenus: menuEmbed.map((menu) => ({
            id: menu.id,
            placeholder: menu.placeholder,
            minValues: menu.minValues,
            maxValues: menu.maxValues,
            options: menu.options.map((option) => ({
              roleId: option.roleId,
              label: option.label,
              emoji: option.emoji,
              description: option.description,
            })),
          })),
          template: runtime.variables,
        });
        runtime.hasil = { messageId: terkirim.messageId, channelId: channelTujuan };
        continue;
      }
      if (step.viaWebhook) {
        /*
         * Jalur webhook: pesan tampil atas nama server. Komponen role tidak
         * bisa ikut — Discord hanya mengirim interaksi ke aplikasi pemilik
         * komponen, dan di pesan webhook pemiliknya webhook itu sendiri.
         * Karena itu komponen role TIDAK diteruskan; kalau pesannya punya,
         * admin diberi tahu alih-alih mendapat tombol yang diam.
         */
        const tombol = await listRoleButtons(runtime.guildId, tujuan.id).catch(() => []);
        const menu = await listRoleMenus(runtime.guildId, tujuan.id).catch(() => []);
        if (tombol.length > 0 || menu.length > 0) {
          await runtime.peringatan(
            '⚠️ Tombol/menu role pada pesan webhook tidak bisa diklik — Discord hanya mengirim interaksi ke aplikasi pengirim. Komponennya tidak ikut terkirim.',
          );
        }
        terkirim = await sendOrUpdatePostViaWebhook({
          client: runtime.client,
          guildId: runtime.guildId,
          channelId: channelTujuan,
          messageId: null,
          blocks: tujuan.blocks,
          accent: tujuan.accent ?? undefined,
          identity: identitasPost(tujuan, await webhookIdentityFor(runtime.client, runtime.guildId)),
          postId: tujuan.id,
          flags: tujuan.flags || undefined,
          template: runtime.variables,
        });
      } else {
        const tombol = await listRoleButtons(runtime.guildId, tujuan.id).catch(() => []);
        const menu = await listRoleMenus(runtime.guildId, tujuan.id).catch(() => []);
        /*
         * Dikirim lewat jalur yang SAMA dengan tombol "Kirim ke Discord":
         * batas komponen, berkas, dan pemetaan tombol/menu role otomatis
         * berlaku, jadi tidak ada perilaku kedua yang bisa menyimpang.
         */
        terkirim = await sendOrUpdatePost({
          client: runtime.client,
          roleButtons: tombol.map((satu) => ({
            id: satu.id,
            label: satu.label,
            emoji: satu.emoji,
            style: satu.style,
            roleId: satu.roleId,
          })) as never,
          roleMenus: menu as never,
          channelId: channelTujuan,
          // Nesting: balasan hanya bisa dipasang di channel yang sama.
          messageId: step.toChannel ? null : runtime.messageId,
          replyTo:
            step.toChannel || !runtime.messageId || channelTujuan !== runtime.channelId
              ? undefined
              : runtime.messageId,
          blocks: tujuan.blocks,
          accent: tujuan.accent ?? undefined,
          flags: tujuan.flags || undefined,
          postId: tujuan.id,
          /*
           * Nilai template diteruskan supaya teks pesan tujuan bisa memakai
           * `{member.name}`, `{server.name}`, `{selected}`, dan variabel flow.
           * Tanpa ini, tombol yang mengirim "pesan aturan" akan selalu menyapa
           * dengan nama kosong — padahal itu inti dari nesting.
           */
          template: runtime.variables,
        });
      }
      // Hasil dikirim untuk variabel `adaptive`.
      runtime.hasil = {
        messageId: terkirim.messageId,
        channelId: channelTujuan,
      };
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

/**
 * Buat thread. Gagal = flow berhenti dengan penjelasan.
 *
 * Yang ditiru dari `CreateThread` Discohook: lama arsip, slowmode, jenis
 * (publik/privat), `invitable`, tag forum, dan pesan pembuka. Yang TIDAK
 * ditiru: memilih channel tujuan lewat variabel bebas — di sini thread selalu
 * dibuat di channel pesan pemicu, karena itu satu-satunya channel yang pasti
 * boleh disentuh bot untuk interaksi ini.
 *
 * Channel FORUM punya aturan sendiri: thread tidak bisa dimulai dari pesan
 * yang sudah ada, melainkan dari postingan baru. Kalau admin menambahkan tag
 * forum, kita memperlakukannya sebagai forum.
 */
async function buatThread(
  runtime: FlowRuntime,
  nama: string,
  opsi: {
    private: boolean;
    autoArchiveMinutes?: number;
    rateLimitPerUser?: number;
    invitable?: boolean;
    appliedTags?: string[];
    pesanPembuka?: string;
  },
): Promise<boolean> {
  if (!runtime.channelId) {
    await runtime.jawab('❌ Thread hanya bisa dibuat dari pesan di channel.', true);
    return false;
  }
  try {
    const channel = await runtime.client.channels.fetch(runtime.channelId);
    if (!channel || !('messages' in channel)) {
      await runtime.jawab('❌ Channel pesan ini tidak mendukung thread.', true);
      return false;
    }

    const arsip = opsi.autoArchiveMinutes as
      | 60
      | 1440
      | 4320
      | 10080
      | undefined;

    /* --- Forum: thread = postingan baru dengan tag --- */
    if ((channel.type as number) === ChannelType.GuildForum) {
      const forum = channel as unknown as {
        threads: {
          create: (options: Record<string, unknown>) => Promise<{ id: string }>;
        };
      };
      const thread = await forum.threads.create({
        name: nama,
        message: { content: opsi.pesanPembuka?.slice(0, 2000) || nama },
        ...(opsi.appliedTags?.length
          ? { appliedTags: opsi.appliedTags.filter((tag) => /^\d{5,25}$/.test(tag)) }
          : {}),
        ...(arsip ? { autoArchiveDuration: arsip } : {}),
        ...(opsi.rateLimitPerUser ? { rateLimitPerUser: opsi.rateLimitPerUser } : {}),
        reason: 'Aksi komponen /pesan dari dashboard',
      });
      runtime.hasil = { ...runtime.hasil, threadId: thread.id, channelId: thread.id };
      await runtime.jawab(`🧵 Postingan forum dibuat: <#${thread.id}>`, false);
      return true;
    }

    if (!runtime.messageId) {
      await runtime.jawab('❌ Thread hanya bisa dibuat dari pesan yang masih ada di channel.', true);
      return false;
    }
    const pesan = await channel.messages.fetch(runtime.messageId).catch((): null => null);
    if (!pesan) {
      await runtime.jawab('❌ Pesan ini sudah tidak ada, jadi thread tidak bisa dibuat.', true);
      return false;
    }

    /*
     * Pesan pembuka: dikirim lebih dulu, lalu thread dimulai DARI pesan itu.
     * Dengan begitu isi pembuka terlihat sebagai pesan pertama thread, bukan
     * pesan lepas di channel — persis yang diharapkan admin.
     */
    const induk = opsi.pesanPembuka
      ? await (channel as { send: (isi: { content: string }) => Promise<typeof pesan> })
          .send({ content: opsi.pesanPembuka.slice(0, 2000) })
          .catch((): null => null)
      : pesan;
    if (!induk) {
      await runtime.jawab('❌ Pesan pembuka thread gagal dikirim (izin kirim pesan?).', true);
      return false;
    }

    /*
     * Thread privat dibuat lewat `channel.threads.create` — `startThread` pada
     * pesan hanya bisa membuat thread publik. Kalau channel-nya tidak punya
     * pengelola thread, admin diberi tahu alih-alih mendapat thread publik
     * padahal yang diminta privat.
     */
    const thread: { id: string } | null = opsi.private
      ? 'threads' in channel && channel.threads
        ? await (channel.threads as GuildTextThreadManager<ChannelType.PrivateThread>).create({
            name: nama,
            type: ChannelType.PrivateThread,
            ...(arsip ? { autoArchiveDuration: arsip } : {}),
            ...(opsi.rateLimitPerUser ? { rateLimitPerUser: opsi.rateLimitPerUser } : {}),
            ...(opsi.invitable !== undefined ? { invitable: opsi.invitable } : {}),
            reason: 'Aksi komponen /pesan dari dashboard',
          })
        : null
      : await induk.startThread({
          name: nama,
          ...(arsip ? { autoArchiveDuration: arsip } : {}),
          ...(opsi.rateLimitPerUser ? { rateLimitPerUser: opsi.rateLimitPerUser } : {}),
          reason: 'Aksi komponen /pesan dari dashboard',
        });
    if (!thread) {
      await runtime.jawab('❌ Channel ini tidak mendukung thread privat.', true);
      return false;
    }
    runtime.hasil = { ...runtime.hasil, threadId: thread.id, channelId: thread.id };
    await runtime.jawab(`🧵 Thread dibuat: <#${thread.id}>`, false);
    return true;
  } catch (error) {
    logger.warn(`Aksi thread gagal: ${errorMessage(error)}`);
    await runtime.jawab(
      '❌ Thread gagal dibuat. Bot butuh izin **Create Public/Private Threads** (dan **Manage Threads** untuk tag forum) di channel ini.',
      true,
    );
    return false;
  }
}

/**
 * Apakah rencana ini (termasuk cabang bersyarat) memuat balasan?
 *
 * Dulu pemeriksaannya hanya melihat tingkat teratas, sehingga balasan yang
 * berada di dalam cabang tidak dihitung — akibatnya member menerima balasan
 * cabang LALU "✅ Selesai." sesudahnya. Dua jawaban untuk satu klik terlihat
 * seperti bot yang tidak yakin apa yang baru dilakukannya.
 */
function adaBalasan(steps: ActionStep[]): boolean {
  return steps.some((step) => {
    if (step.kind === 'reply') return true;
    if (step.kind === 'condition') {
      return adaBalasan(step.then ?? []) || adaBalasan(step.otherwise ?? []);
    }
    return false;
  });
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
    values: nilaiKonteks({ guild, member, channelId: interaction.channelId ?? null }),
  };
  /*
   * `selected` ikut ke konteks, bukan hanya ke variabel: teks balasan admin
   * paling sering ingin menyebut pilihan member (`{selected}`), dan tanpa ini
   * token itu selalu kosong walaupun menunya jelas punya nilai.
   */
  const dipilih = (interaction.values ?? []).join(', ');
  konteks.selected = dipilih;
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
    hapusPesan: async (sasaran: 'pesan' | 'sebelumnya') => {
      /*
       * Hapus pesan pemicu ATAU pesan hasil aksi kirim sebelumnya. Sengaja
       * dilaporkan kalau gagal: tombol yang tetap ada sesudah admin memilih
       * "hapus pesan" terlihat seperti fitur rusak.
       */
      try {
        if (sasaran === 'sebelumnya') {
          const sebelumnya = runtime.hasil;
          if (!sebelumnya?.messageId) return false;
          const channelId = sebelumnya.channelId ?? interaction.channelId ?? null;
          if (!channelId) return false;
          const channel = await options.client.channels.fetch(channelId);
          if (!channel || !('messages' in channel)) return false;
          const pesan = await (channel as unknown as {
            messages: { fetch: (id: string) => Promise<{ delete: () => Promise<unknown> }> };
          }).messages.fetch(sebelumnya.messageId);
          await pesan.delete();
          // Hasil dipakai ulang: sesudah dihapus, aksi berikutnya tidak boleh
          // menghapus pesan yang sama lagi (Discord menjawab 404).
          runtime.hasil = { ...sebelumnya, messageId: '' };
          return true;
        }
        if (!interaction.message) return false;
        await interaction.message.delete();
        return true;
      } catch (error) {
        logger.warn(`Aksi hapus pesan gagal: ${errorMessage(error)}`);
        return false;
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
  } else if (hasil.hasil === 'selesai' && !adaBalasan(plan.steps)) {
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
    values: nilaiKonteks({ guild, member, channelId: session.channelId }),
  };
  const variables = nilaiFlow({ ...konteks, variables: session.variables });
  konteks.variables = Object.fromEntries(
    Object.entries(variables)
      .filter(([kunci]) => kunci.startsWith('var.'))
      .map(([kunci, nilai]) => [kunci, nilai]),
  );

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
    hapusPesan: async (sasaran: 'pesan' | 'sebelumnya') => {
      /*
       * Sesi yang dilanjutkan timer tidak punya objek interaksi, jadi pesan
       * pemilik komponen dicari lewat ID yang disimpan di sesi. Sasaran
       * `sebelumnya` memakai `runtime.hasil`, sama seperti jalur interaksi.
       */
      try {
        if (sasaran === 'sebelumnya') {
          const sebelumnya = runtime.hasil;
          if (!sebelumnya?.messageId) return false;
          const channelId = sebelumnya.channelId ?? session.channelId;
          const channel = await client.channels.fetch(channelId);
          if (!channel || !channel.isTextBased() || !('messages' in channel)) return false;
          const pesan = await channel.messages.fetch(sebelumnya.messageId).catch((): null => null);
          if (!pesan) return false;
          await pesan.delete();
          runtime.hasil = { ...sebelumnya, messageId: '' };
          return true;
        }
        if (!session.messageId) return false;
        const channel = await client.channels.fetch(session.channelId);
        if (!channel || !channel.isTextBased() || !('messages' in channel)) return false;
        const pesan = await channel.messages.fetch(session.messageId).catch((): null => null);
        if (!pesan) return false;
        await pesan.delete();
        return true;
      } catch (error) {
        logger.warn(`Sesi flow ${session.id}: gagal menghapus pesan`, errorMessage(error));
        return false;
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
