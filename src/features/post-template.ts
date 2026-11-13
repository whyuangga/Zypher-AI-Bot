/**
 * Variabel template untuk teks pesan & aksi — nama yang SAMA dengan Discohook.
 *
 * Kenapa modul sendiri dan MURNI (tanpa discord.js):
 *
 *   - Nama variabelnya diambil dari kode sumber Discohook
 *     (`packages/bot/src/flows/backup.ts`, `flattenMember`/`flattenChannel`/
 *     `flattenRole`/`getReplacements`). Admin yang sudah punya resep di sana
 *     harus bisa menyalinnya apa adanya.
 *   - Nilainya dirakit dari objek Discord (member, guild, channel). Merakitnya
 *     di dalam runner membuat nilai yang mustahil diuji tanpa server — dan
 *     justru nilai-nilai ini yang paling sering salah (mis. `{member.name}`
 *     diisi username padahal Discohook memakai `display_name`).
 *
 * Aturan yang dipegang:
 *
 *   1. **Token yang tidak dikenal dibiarkan apa adanya.** Salah tulis harus
 *      terlihat di pesan, bukan menghilang menjadi teks kosong.
 *   2. **Nilai kosong = string kosong**, bukan teks "undefined". Variabel yang
 *      tidak tersedia (mis. `{role.name}` di tombol tanpa aksi role) harus
 *      hilang, bukan mencetak `[object Object]`.
 *   3. **Tidak ada nilai karangan.** Kalau bot tidak tahu jumlah boost server,
 *      `{server.boosts}` kosong — lebih baik daripada angka palsu.
 *
 * Catatan penting soal `{member.name}`: Discohook menamai `member.name` sebagai
 * `username`, dan nama tampilan ada di `member.display_name`. Bot ini sejak
 * awal memakai nama tampilan untuk `{member.name}` (itu yang diharapkan member
 * di pesan sambutan), jadi `{member.name}` DIPERTAHANKAN sebagai nama tampilan
 * dan `{member.username}` ditambahkan untuk yang butuh username. Perbedaan ini
 * didokumentasikan di docs/pesan.md supaya tidak jadi jebakan.
 */

/** Data mentah yang dipakai merakit nilai template. */
export interface TemplateSource {
  /** Nama tampilan member (nick > globalName > username). */
  memberName?: string;
  /** Username Discord (tanpa `#0`). */
  username?: string;
  /** Diskriminator lama (`1234`, atau `0` untuk username baru). */
  discriminator?: string;
  memberId?: string;
  /** `nick#1234` / `username` — bentuk `{member.tag}` Discohook. */
  tag?: string;
  avatarUrl?: string;
  /** ID role member, urutan apa adanya dari Discord. */
  roleIds?: string[];
  serverId?: string;
  serverName?: string;
  serverIconUrl?: string;
  /** Jumlah member & boost — hanya diisi kalau benar-benar diketahui. */
  memberCount?: number;
  boostCount?: number;
  roleCount?: number;
  channelId?: string;
  channelName?: string;
  /** Nama role hasil aksi role (jika ada). */
  roleName?: string;
  /** `ditambahkan` / `dilepas` / `diperbarui`. */
  effect?: string;
  /** Pilihan menu (satu nilai, gabungan koma). */
  selected?: string;
  /** Pilihan menu sebagai daftar — untuk `{selected_values.N}`. */
  selectedValues?: string[];
  /** Waktu sekarang; bisa diinjeksi supaya tes tidak bergantung jam mesin. */
  now?: Date;
  /** Variabel flow, TANPA awalan `var.` (mis. `{ kode: 'abc' }`). */
  variables?: Record<string, string>;
}

/**
 * Batas jumlah nilai pilihan yang diekspos.
 *
 * Discord membatasi select menu sampai 25 pilihan; angka yang sama dipakai di
 * sini supaya `{selected_values.26}` tidak pernah ada tanpa alasan.
 */
const MAKS_PILIHAN = 25;

/** `2026-11-12` (tanggal pendek), dipakai `{now}`. */
function tanggalPendek(waktu: Date): string {
  const bulan = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'Mei',
    'Jun',
    'Jul',
    'Agu',
    'Sep',
    'Okt',
    'Nov',
    'Des',
  ][waktu.getUTCMonth()];
  return `${waktu.getUTCDate()} ${bulan} ${waktu.getUTCFullYear()}`;
}

/**
 * Stempel waktu gaya Discord.
 *
 * Discohook memakai `<t:…:d>` / `<t:…:R>` / `<t:…:F>`; bentuk yang sama dipakai
 * di sini supaya hasilnya diterjemahkan Discord ke zona waktu pembaca — bukan
 * zona waktu server.
 */
function stempel(waktu: Date, gaya: 'd' | 'R' | 'F'): string {
  return `<t:${Math.floor(waktu.getTime() / 1000)}:${gaya}>`;
}

/**
 * Rakit semua nilai template.
 *
 * Kunci yang tidak punya nilai TIDAK dimasukkan: dengan begitu `{member.tag}`
 * di pesan tanpa konteks member tetap tampil sebagai teks, bukan berubah jadi
 * kosong. Itu perilaku yang sama dengan `fillActionText` versi lama.
 */
export function buildTemplateValues(source: TemplateSource): Record<string, string> {
  const nilai: Record<string, string> = {};
  const isi = (kunci: string, isiNilai: string | number | undefined | null): void => {
    if (isiNilai === undefined || isiNilai === null) return;
    const teks = String(isiNilai);
    if (teks === '') return;
    nilai[kunci] = teks;
  };

  /* ---------------- member ---------------- */
  const nama = source.memberName?.trim();
  isi('member.name', nama);
  isi('member.display_name', nama);
  isi('member.username', source.username);
  isi('member.id', source.memberId);
  if (source.memberId) isi('member.mention', `<@${source.memberId}>`);
  isi('member.avatar_url', source.avatarUrl);
  if (source.roleIds?.length) isi('member.role_ids', JSON.stringify(source.roleIds));
  /*
   * `{member.tag}`: Discord membuang diskriminator (`0000`) sejak username
   * baru. Discohook mengembalikan username saja untuk kasus itu, dan bentuk
   * yang sama dipakai di sini — `nama#0000` bukan tag yang berguna.
   */
  if (source.tag) isi('member.tag', source.tag);
  else if (source.username) {
    isi(
      'member.tag',
      !source.discriminator || source.discriminator === '0'
        ? source.username
        : `${source.username}#${source.discriminator}`,
    );
  }

  /* ---------------- server ---------------- */
  isi('server.id', source.serverId);
  isi('server.name', source.serverName);
  isi('server.icon_url', source.serverIconUrl);
  isi('server.members', source.memberCount);
  isi('server.boosts', source.boostCount);
  isi('server.roles', source.roleCount);
  if (source.serverId) {
    /*
     * `{server.created}` dari Snowflake, sama seperti Discohook. Snowflake
     * Discord = (waktu ms - 1420070400000) << 22.
     */
    const dibuat = Number(source.serverId);
    if (Number.isSafeInteger(dibuat) && dibuat > 0) {
      const waktu = new Date((dibuat >> 22) + 1_420_070_400_000);
      if (!Number.isNaN(waktu.getTime())) {
        isi('server.created', stempel(waktu, 'd'));
        isi('server.created_relative', stempel(waktu, 'R'));
        isi('server.created_long', stempel(waktu, 'F'));
      }
    }
  }

  /* ---------------- channel ---------------- */
  isi('channel.id', source.channelId);
  isi('channel.name', source.channelName);
  if (source.channelId) {
    isi('channel.mention', `<#${source.channelId}>`);
    isi('channel.link', `https://discord.com/channels/${source.serverId ?? '@me'}/${source.channelId}`);
  }

  /* ---------------- hasil aksi role ---------------- */
  isi('role.name', source.roleName);
  isi('role', source.roleName);
  isi('effect', source.effect);

  /* ---------------- pilihan menu ---------------- */
  isi('selected', source.selected);
  const dipilih = (source.selectedValues ?? []).slice(0, MAKS_PILIHAN);
  if (dipilih.length > 0) {
    isi('selected_value', dipilih[0]);
    dipilih.forEach((satu, urutan) => {
      // Discohook memakai nomor MULAI DARI 1, bukan 0.
      isi(`selected_values.${urutan + 1}`, satu);
    });
  }

  /* ---------------- waktu ---------------- */
  const waktu = source.now ?? new Date();
  isi('now', stempel(waktu, 'd'));
  isi('now_relative', stempel(waktu, 'R'));
  isi('now_long', stempel(waktu, 'F'));
  isi('now_short_date', tanggalPendek(waktu));

  /* ---------------- variabel flow ---------------- */
  for (const [kunci, isiNilai] of Object.entries(source.variables ?? {})) {
    const bersih = kunci.replace(/^var\./, '');
    if (!bersih) continue;
    nilai[`var.${bersih}`] = isiNilai;
  }

  return nilai;
}

/**
 * Ganti semua token `{nama}` di satu teks.
 *
 * Diganti dari kunci TERPANJANG lebih dulu: `{member.name}` dan
 * `{member.name_x}` bisa sama-sama ada, dan mengganti yang pendek duluan
 * membuat yang panjang rusak separuh.
 *
 * Token yang tidak ada di tabel DIBIARKAN apa adanya.
 */
export function applyTemplate(template: string, values: Record<string, string>): string {
  if (!template || !template.includes('{')) return template;
  let hasil = template;
  const kunci = Object.keys(values).sort((a, b) => b.length - a.length);
  for (const satu of kunci) {
    const token = `{${satu}}`;
    if (!hasil.includes(token)) continue;
    hasil = hasil.split(token).join(values[satu]!);
  }
  return hasil;
}

/**
 * Hapus token yang tidak terisi.
 *
 * Dipakai hanya untuk teks yang memang TIDAK boleh menampilkan token mentah —
 * saat ini tidak ada, dan itu disengaja: membiarkan token terlihat adalah cara
 * termurah membuat salah tulis ketahuan. Fungsi ini disediakan supaya
 * keputusan itu tercatat di satu tempat, bukan supaya dipakai diam-diam.
 */
export function tokenTersisa(teks: string): string[] {
  const hasil: string[] = [];
  for (const cocok of teks.matchAll(/\{([a-z_][\w.]{0,63})\}/gi)) {
    const token = cocok[1]!;
    if (!hasil.includes(token)) hasil.push(token);
  }
  return hasil;
}
