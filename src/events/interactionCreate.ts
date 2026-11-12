import { MessageFlags, type Client, type Interaction } from 'discord.js';
import { commandMap } from '../commands/index.js';
import { handleButton } from '../features/buttons.js';
import { handleRoleMenu } from '../features/role-button-handler.js';
import { runComponentActions } from '../features/post-action-runner.js';
import {
  CONTEXT_SELECT_PREFIX,
  parseRoleButtonId,
  parseRoleMenuId,
} from '../features/role-buttons.js';
import { errorMessage, logger } from '../lib/logger.js';
import { ownsGuild } from '../lib/shard.js';

/**
 * Target aksi untuk select menu "tampilan" (blok Select di /pesan).
 *
 * Dua bentuk customId dikenali:
 *   - `post-ctx:<postId>:<jenis>` — bentuk sekarang, aksi bisa dicari pasti;
 *   - `post-ctx:<jenis>` — pesan lama yang dikirim sebelum ID pesan
 *     disisipkan. Tetap didukung supaya menunya tidak berhenti bekerja.
 *
 * Aksi per OPSI tidak didukung untuk select jenis user/role/channel: nilai
 * pilihannya berasal dari Discord dan tidak punya ID baris di database.
 */
export function targetSelectTampilan(
  customId: string,
  values?: readonly string[],
): { postId: number | null; target: string; fallbackTarget: string } | null {
  if (!customId.startsWith(CONTEXT_SELECT_PREFIX)) return null;
  const sisa = customId.slice(CONTEXT_SELECT_PREFIX.length);
  const bagian = sisa.split(':');

  const rakit = (postId: number | null, jenis: string) => {
    const fallbackTarget = `select:${jenis}`;
    /*
     * Aksi per PILIHAN hanya masuk akal untuk menu string: nilainya ditentukan
     * admin, jadi bisa dipakai sebagai kunci. Untuk menu user/role/channel,
     * nilainya ID Discord yang berubah-ubah — aksi per pilihan di sana tidak
     * bisa disusun di dasbor.
     */
    const dipilih = (values ?? []).filter((v) => typeof v === 'string' && v.length > 0);
    if (jenis === 'string' && dipilih.length === 1) {
      // Target per pilihan; `select:<jenis>` tetap dipakai sebagai cadangan.
      return { postId, target: `sel:${dipilih[0]!.slice(0, 100)}`, fallbackTarget };
    }
    return { postId, target: fallbackTarget, fallbackTarget };
  };

  if (bagian.length === 2 && /^\d+$/.test(bagian[0]!) && /^[a-z]{2,20}$/.test(bagian[1]!)) {
    return rakit(Number(bagian[0]), bagian[1]!);
  }
  if (bagian.length === 1 && /^[a-z]{2,20}$/.test(bagian[0]!)) {
    // Bentuk lama: tanpa ID pesan, jadi aksi dicari lewat target saja.
    return rakit(null, bagian[0]!);
  }
  return null;
}

async function reportFailure(interaction: Interaction, error: unknown): Promise<void> {
  const message = `⚠️ Terjadi kesalahan: ${errorMessage(error).slice(0, 200)}`;

  if (!interaction.isRepliable()) return;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Interaksi sudah kedaluwarsa — tidak ada yang bisa dilakukan.
  }
}

/**
 * `client` bisa tidak tersedia (mis. saat tes). Aksi "kirim pesan tersimpan"
 * butuh client untuk mengirim; tanpa client, aksi lain tetap jalan.
 */
export async function onInteractionCreate(interaction: Interaction, client?: Client): Promise<void> {
  try {
    // Multi-shard: abaikan interaksi dari server yang bukan porsi instance ini.
    if (interaction.guildId && !ownsGuild(interaction.guildId)) return;

    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) {
        logger.warn(`Command tidak dikenal: ${interaction.commandName}`);
        return;
      }
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      /*
       * Aksi komponen diperiksa LEBIH DULU.
       *
       * Tombol role lama punya customId `post-role:<id>`; setelah admin
       * menambahkan aksi, tombol yang sama harus menjalankan aksinya. Kalau
       * `handleButton` dipanggil lebih dulu, aksi tidak pernah tercapai.
       */
      const buttonId = parseRoleButtonId(interaction.customId);
      if (client && buttonId !== null && (await runComponentActions({ client, interaction, target: `button:${buttonId}` }))) {
        return;
      }
      await handleButton(interaction);
      return;
    }

    /*
     * Select menu "tampilan" dengan aksi (`select:<jenis>`).
     *
     * Diperiksa sebelum cabang penjelasan di bawah: kalau admin sudah memberi
     * aksi, menunya tidak lagi sekadar tampilan.
     */
    if (
      client &&
      (interaction.isStringSelectMenu() ||
        interaction.isUserSelectMenu() ||
        interaction.isRoleSelectMenu() ||
        interaction.isMentionableSelectMenu() ||
        interaction.isChannelSelectMenu())
    ) {
      const select = targetSelectTampilan(interaction.customId, interaction.values);
      if (
        select &&
        (await runComponentActions({
          client,
          interaction,
          target: select.target,
          fallbackTarget: select.fallbackTarget,
          postId: select.postId,
        }))
      ) {
        return;
      }
    }

    /*
     * Dropdown role. Diperiksa lewat prefix customId, bukan lewat
     * `interaction.isStringSelectMenu()` saja: bot tidak punya dropdown lain,
     * jadi apa pun yang masuk ke sini dan bukan milik fitur ini cukup
     * diabaikan tanpa jawaban (Discord akan menampilkan "interaksi gagal"
     * kalau didiamkan, tapi itu lebih baik daripada menjawab salah).
     */
    if (interaction.isStringSelectMenu() && parseRoleMenuId(interaction.customId) !== null) {
      await handleRoleMenu(interaction);
      return;
    }

    /*
     * Select menu "tampilan" (blok Select di /pesan).
     *
     * Menu ini sengaja tidak mengubah apa pun: akun bot tidak bisa membaca
     * pilihan user/role/channel (Discord menyembunyikan nilai @everyone dari
     * user biasa). Kalau didiamkan, Discord menampilkan "interaksi gagal" dan
     * member mengira botnya rusak. Jadi dijawab singkat, hanya untuk yang
     * memilih.
     */
    if (
      (interaction.isStringSelectMenu() ||
        interaction.isUserSelectMenu() ||
        interaction.isRoleSelectMenu() ||
        interaction.isMentionableSelectMenu() ||
        interaction.isChannelSelectMenu()) &&
      interaction.customId.startsWith(CONTEXT_SELECT_PREFIX)
    ) {
      await interaction
        .reply({
          content:
            'ℹ️ Menu ini hanya tampilan — tidak menyimpan pilihan. Untuk mengambil role, pakai tombol atau dropdown role di pesan yang sama.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);
    }
  } catch (error) {
    logger.error(`Error saat menangani interaksi (${interaction.type})`, errorMessage(error));
    await reportFailure(interaction, error);
  }
}
