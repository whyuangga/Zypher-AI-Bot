/**
 * Design system dashboard — satu blok CSS, tanpa framework.
 *
 * Gaya: editorial monokrom dengan palet pemilik (Kimberly, Wafer, Cold Turkey,
 * Don Juan). Bidang gelap rata, garis rambut 1px, tipografi General Sans
 * (self-host, lihat assets/fonts), label kapital ber-spasi lebar, tombol solid
 * tanpa gradient. Semua warna & radius lewat CSS variable.
 *
 * Tidak ada font dari CDN: file woff2 disajikan server sendiri lewat
 * `/fonts/general-sans-*.woff2`, jadi panel hosting boleh tanpa akses keluar.
 */
export const STYLE = `
@font-face {
  font-family: "General Sans";
  src: url("/fonts/general-sans-regular.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "General Sans";
  src: url("/fonts/general-sans-medium.woff2") format("woff2");
  font-weight: 500 700; font-style: normal; font-display: swap;
}

:root {
  color-scheme: dark;
  /* palet: Kimberly #716c98 · Wafer #e2d1cc · Cold Turkey #d0b2b7 · Don Juan #55434e */
  --bg: #0d0d0f;
  --bg-soft: #121016;
  --surface: #16131a;
  --surface-2: #1d1922;
  --surface-3: #272231;
  --line: rgba(226, 209, 204, .13);
  --line-strong: rgba(226, 209, 204, .3);
  --text: #e2d1cc;
  --text-2: #d0b2b7;
  --text-3: #8f8189;
  --ink: #1a141a;
  --brand: #716c98;
  --brand-soft: rgba(113, 108, 152, .22);
  --brand-line: rgba(113, 108, 152, .5);
  --ok: #a9c3ad;
  --ok-soft: rgba(169, 195, 173, .1);
  --warn: #dcc08f;
  --warn-soft: rgba(220, 192, 143, .1);
  --danger: #d98a8f;
  --danger-soft: rgba(217, 138, 143, .1);
  --r-sm: 2px;
  --r: 2px;
  --r-lg: 3px;
  --shadow: none;
  --sidebar: 252px;
  --font-ui: "General Sans", Inter, "Helvetica Neue", ui-sans-serif, system-ui, -apple-system,
    "Segoe UI", Roboto, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", "Roboto Mono", monospace;
}

* { box-sizing: border-box; }
/* Ikon tidak boleh ikut menyusut di dalam flex (tombol 34px bisa mengecilkan svg jadi 2px). */
svg { flex: 0 0 auto; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 400 15px/1.62 var(--font-ui);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: var(--text); text-decoration: none; border-bottom: 1px solid var(--line-strong); }
a:hover { border-bottom-color: var(--text); }
h1, h2, h3 { margin: 0; font-weight: 500; }
h1 {
  font-size: 44px; line-height: 1.02; letter-spacing: -.035em;
}
h2 { font-size: 13px; }
code, .mono { font-family: var(--font-mono); font-size: 12px; }
code {
  background: rgba(226, 209, 204, .08); border: 0;
  padding: 1px 5px; border-radius: var(--r-sm); color: var(--text);
  font-size: 11.5px; white-space: nowrap;
}
::selection { background: var(--text); color: var(--ink); }
:focus-visible { outline: 1px solid var(--brand); outline-offset: 3px; }

/* label kecil ala katalog pameran: kapital, spasi lebar, tebal medium */
.kicker, .stat-label, .nav-label, th, .badge, .brand-sub, .bar-day, .list-meta,
.status-line, .login-foot, .drop-text span {
  text-transform: uppercase;
}

/* ---------------- shell ---------------- */
.app { position: relative; display: flex; min-height: 100vh; }

.sidebar {
  position: sticky; top: 0; height: 100vh; width: var(--sidebar); flex: 0 0 var(--sidebar);
  display: flex; flex-direction: column; gap: 4px; padding: 26px 20px 20px;
  background: var(--bg); border-right: 1px solid var(--line); z-index: 40;
}
.brand { display: flex; align-items: center; gap: 12px; padding: 0 2px 26px; }
.brand-mark {
  width: 32px; height: 32px; border-radius: var(--r-sm); display: grid; place-items: center;
  background: transparent; border: 1px solid var(--line-strong);
  color: var(--text); flex: 0 0 32px;
}
.brand-text { display: flex; flex-direction: column; line-height: 1.15; }
.brand-name {
  font-weight: 500; font-size: 18px; letter-spacing: -.02em;
}
.brand-sub {
  font-size: 9px; color: var(--text-3); letter-spacing: .2em; margin-top: 4px; font-weight: 500;
}

.nav { display: flex; flex-direction: column; gap: 0; }
.nav-label {
  font-size: 9.5px; letter-spacing: .2em; color: var(--text-3); font-weight: 500;
  padding: 0 0 10px; border-bottom: 1px solid var(--line); margin-bottom: 10px;
}
.nav-item {
  position: relative; display: flex; align-items: center; gap: 11px;
  padding: 10px 10px 10px 12px; border-radius: 0;
  color: var(--text-2); font-size: 14px; font-weight: 400; letter-spacing: -.005em;
  border: 0; transition: color .15s, background .15s;
}
.nav-item:hover { background: rgba(226, 209, 204, .05); color: var(--text); border-bottom-color: transparent; }
.nav-item.active { color: var(--text); background: var(--brand-soft); }
.nav-item.active::before {
  content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 2px; height: 16px; background: var(--brand);
}
.nav-item.active svg { color: var(--text-2); opacity: 1; }
.nav-item svg { color: var(--text-3); opacity: .9; flex: 0 0 18px; }
.nav-badge {
  margin-left: auto; font-size: 10.5px; font-weight: 500; color: var(--text-2);
  border: 1px solid var(--line); border-radius: var(--r-sm); padding: 0 5px; min-width: 20px; text-align: center;
}
.sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: 14px; padding-top: 22px; }
.status-card {
  border: 0; border-top: 1px solid var(--line); background: transparent;
  border-radius: 0; padding: 14px 0 0; display: flex; flex-direction: column; gap: 6px;
}
.status-line {
  display: flex; align-items: center; gap: 8px; font-size: 9.5px; font-weight: 500;
  letter-spacing: .16em; color: var(--text-2);
}
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); box-shadow: none; }
.dot.off { background: var(--warn); }
.dot.pulse { animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.status-meta { font-size: 11.5px; color: var(--text-3); }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 14px;
  padding: 13px 40px; border-bottom: 1px solid var(--line);
  background: rgba(13, 13, 15, .94); backdrop-filter: blur(10px);
}
/* Badge server di topbar. Bukan kontrol: bot ini untuk satu server,
   jadi yang perlu diketahui admin hanya server mana yang sedang dibuka. */
/* Select dengan chevron sendiri: appearance:none membuang panah bawaan
   browser, jadi panahnya digambar sebagai <svg> di dalam shell.

   Dua varian lebar, dan bedanya penting:

   - bawaan (tanpa modifier): untuk select sempit di topbar. Shell menyusut
     mengikuti isi, select dibatasi 260px.
   - .full: untuk select di dalam form yang harus selebar kolomnya.

   Sebelum ada .full, form memakai inline style width:100% pada shell — dan di
   situlah bug-nya: shell jadi selebar kolom (mis. 400px), tetapi select tetap
   dibatasi 260px. Chevron diposisikan right:10px terhadap SHELL, jadi ia jatuh
   140px di kanan teks dan di luar garis bawah select.
   Yang terlihat: garis putus sebelum ujung baris, lalu panah melayang sendiri.
   Kuncinya: select dan chevron harus berbagi kotak yang sama, jadi lebarnya
   diatur di SHELL dan select selalu 100% dari shell. */
.select-shell { position: relative; display: inline-flex; align-items: center; max-width: 100%; }
.select-shell svg { position: absolute; right: 10px; pointer-events: none; color: var(--text-3); }
.select-shell select {
  appearance: none; padding: 8px 32px 8px 0; min-width: 190px; max-width: 260px; width: 100%;
  background: transparent; border: 0; border-bottom: 1px solid var(--line-strong); border-radius: 0;
  color: var(--text); font-family: var(--font-mono); font-size: 12.5px; letter-spacing: .02em;
}
.select-shell select:hover { border-bottom-color: var(--text); }

/* Varian selebar kolom form. Select ikut 100% supaya garis bawah dan chevron
   berakhir di titik yang sama. min-width:0 mencegah select mendorong lebar
   shell melebihi kolom saat nama channel panjang. padding-right 34px = lebar
   chevron (15px) + jarak 10px + ruang aman, supaya nama channel panjang
   terpotong SEBELUM menabrak panah. */
.select-shell.full { display: flex; width: 100%; }
.select-shell.full select { min-width: 0; max-width: none; padding-right: 34px; }

.guild-static {
  display: inline-flex; align-items: center; gap: 9px; min-width: 0;
  padding: 7px 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: rgba(255, 255, 255, .015); color: var(--text);
}
.guild-static svg { color: var(--text-3); flex: none; }
.guild-static > span:not(.guild-static-id) {
  font-size: 13.5px; font-weight: 500; letter-spacing: -.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 34vw;
}
.guild-static-id { color: var(--text-3); font-size: 11px; letter-spacing: .02em; }
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.search { position: relative; display: flex; align-items: center; }
.search svg { position: absolute; left: 0; color: var(--text-3); }
.search input {
  width: 200px; padding: 8px 10px 8px 22px; background: transparent;
  border: 0; border-bottom: 1px solid var(--line); border-radius: 0; color: var(--text); font-size: 13px;
}
.search kbd {
  position: absolute; right: 0; font-size: 10px; color: var(--text-3);
  border: 1px solid var(--line); border-radius: var(--r-sm); padding: 0 4px; background: transparent;
}
.avatar {
  width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 11.5px;
  font-weight: 500; color: var(--text); background: transparent; border: 1px solid var(--line-strong);
  font-family: var(--font-mono); letter-spacing: .02em;
}
.icon-btn {
  display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: var(--r-sm);
  border: 1px solid var(--line); background: transparent; color: var(--text-2); cursor: pointer;
  transition: color .15s, border-color .15s, background .15s;
  /* Aturan button global memberi padding 12px 18px. Di kotak 34px itu
     menyisakan ruang isi hanya 8px, lebih kecil dari ikon 18px, sehingga
     ikon menempel ke atas (turun 5px dari tengah). Nolkan padding dan
     jangan biarkan flex mengecilkannya. */
  padding: 0; flex: 0 0 auto; line-height: 0;
}
.icon-btn:hover { color: var(--text); border-color: var(--line-strong); background: rgba(226, 209, 204, .05); }
.burger { display: none; }

.content { padding: 44px 40px 110px; width: 100%; max-width: 1240px; margin: 0 auto; }
.page-head {
  display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap;
  margin-bottom: 34px; padding-bottom: 20px; border-bottom: 1px solid var(--line);
}
.page-head .kicker {
  display: block; font-size: 9.5px; font-weight: 500; letter-spacing: .22em; color: var(--text-3);
  margin-bottom: 12px;
}
.page-head .sub { color: var(--text-2); font-size: 13.5px; margin: 10px 0 0; max-width: 62ch; }
.page-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

/* ---------------- cards & grid ---------------- */
.card {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
  box-shadow: none; overflow: hidden;
}
.card-pad { padding: 22px 24px; }
.card-head {
  display: flex; align-items: center; gap: 12px; padding: 18px 24px;
  border-bottom: 1px solid var(--line);
}
.card-head h2 {
  font-size: 10px; font-weight: 500; letter-spacing: .18em;
  text-transform: uppercase; color: var(--text);
}
.card-head .hint {
  /* margin-top: 8px global milik .hint membuat teks di samping judul kartu
     turun ~4px. Di dalam card-head teks harus sebaris rata dengan judul. */
  color: var(--text-3); font-size: 12px; letter-spacing: -.005em;
  margin: 0; line-height: 1.2;
}
.card-head .right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.grid { display: grid; gap: 14px; }
.stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cols-2 { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); align-items: start; }
.cols-2-even { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
.mt { margin-top: 14px; }

.stat {
  padding: 20px 22px 22px; display: flex; flex-direction: column; gap: 22px;
  position: relative; overflow: hidden;
}
.stat-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.stat-label { font-size: 9.5px; font-weight: 500; letter-spacing: .16em; color: var(--text-3); line-height: 1.5; }
.stat-ico {
  width: 26px; height: 26px; border-radius: var(--r-sm); display: grid; place-items: center;
  background: transparent; color: var(--text-3); border: 1px solid var(--line);
}
.stat-value {
  font-size: 50px; font-weight: 500;
  letter-spacing: -.045em; line-height: .92; font-variant-numeric: tabular-nums;
}
.stat-foot {
  font-size: 12px; color: var(--text-3); display: flex; align-items: baseline; gap: 6px;
  padding-top: 12px; border-top: 1px solid var(--line);
}
.stat-foot b { color: var(--text-2); font-weight: 500; }

/* ---------------- chart ---------------- */
.chart { padding: 20px 24px 4px; }
.bars {
  display: flex; align-items: flex-end; gap: 12px; height: 176px;
  background-image: repeating-linear-gradient(to top, rgba(226, 209, 204, .08) 0 1px, transparent 1px 44px);
}
.bar-col {
  flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center;
  gap: 8px; height: 100%; position: relative; cursor: default;
}
.bar-day .day-short { display: none; }
.bar-track {
  width: 100%; height: 100%; display: flex; align-items: flex-end;
  background: transparent; position: relative; overflow: hidden;
}
.bar-fill {
  width: 100%; border-radius: 0; min-height: 3px;
  background: rgba(208, 178, 183, .34);
  transition: background .15s, height .4s cubic-bezier(.2, .8, .2, 1);
}
.bar-col:hover .bar-fill { background: var(--text-2); }
.bar-col.today .bar-fill { background: var(--text); }
.bar-col.zero .bar-fill { background: rgba(226, 209, 204, .1); }
.bar-val {
  position: absolute; top: -4px; left: 0; right: 0; text-align: center;
  font-size: 11px; font-weight: 500; color: var(--text);
  opacity: 0; transition: opacity .15s;
}
.bar-col:hover .bar-val { opacity: 1; }
.bar-day {
  font-size: 9px; font-weight: 500; letter-spacing: .12em;
  color: var(--text-3); white-space: nowrap;
}
.bar-col.today .bar-day { color: var(--text); }
.chart-legend {
  display: flex; align-items: center; gap: 14px; font-size: 12px; color: var(--text-3);
  padding: 14px 24px 20px;
}
.legend-key { display: inline-flex; align-items: center; gap: 7px; }
.legend-swatch { width: 8px; height: 8px; border-radius: 0; background: var(--text); }

/* ---------------- sumber daya server ---------------- */
.res-list { display: grid; }
.res-row { padding: 16px 24px; border-bottom: 1px solid var(--line); }
.res-row:last-child { border-bottom: none; }
.res-top {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 10px;
}
.res-label {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text-2);
}
.res-label svg { opacity: .7; }
.res-value {
  font-size: 20px; font-weight: 600; letter-spacing: -.02em;
  font-variant-numeric: tabular-nums; color: var(--text);
}
.res-bar {
  height: 6px; border-radius: 0; overflow: hidden;
  background: rgba(226, 209, 204, .1);
}
.res-bar > span {
  display: block; height: 100%; border-radius: 0;
  background: var(--text); transition: width .4s cubic-bezier(.2, .8, .2, 1);
}
.res-bar.warn > span { background: #d9b06a; }
.res-bar.danger > span { background: #d9736a; }
/* Tidak diketahui: garis putus-putus, bukan bar 0% yang terbaca "kosong". */
.res-bar.unknown {
  background-image: repeating-linear-gradient(90deg, rgba(226, 209, 204, .16) 0 6px, transparent 6px 12px);
  background-color: transparent;
}
.res-sub { margin-top: 7px; font-size: 12px; color: var(--text-3); }
.res-foot {
  padding: 14px 24px 18px; font-size: 12px; color: var(--text-3);
  border-top: 1px solid var(--line);
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
/* Penanda "langsung": titik berdenyut halus selama polling jalan.
   Saat gagal, titik jadi abu-abu dan teksnya "terputus" — angka terakhir
   tetap tampil, karena menghapusnya justru lebih membingungkan. */
.res-live { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.res-dot {
  width: 5px; height: 5px; border-radius: 50%; background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-soft); animation: resPulse 2.4s ease-in-out infinite;
  flex: 0 0 auto;
}
.res-dot.off { background: var(--text-3); box-shadow: none; animation: none; }
@keyframes resPulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) {
  .res-dot { animation: none; }
}
@media (max-width: 560px) {
  .res-value { font-size: 17px; }
  .res-row { padding-left: 16px; padding-right: 16px; }
  .res-foot { padding-left: 16px; padding-right: 16px; }
}

/* ---------------- tables ---------------- */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th {
  text-align: left; padding: 12px 24px; font-size: 9px; letter-spacing: .16em;
  color: var(--text-3); font-weight: 500; border-bottom: 1px solid var(--line); white-space: nowrap;
}
td {
  padding: 15px 24px; border-bottom: 1px solid var(--line); vertical-align: middle;
  font-variant-numeric: tabular-nums;
}
tbody tr:last-child td { border-bottom: none; }
tbody tr { transition: background .12s; }
tbody tr:hover { background: rgba(226, 209, 204, .04); }
.cell-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.avatar-sm {
  width: 28px; height: 28px; border-radius: var(--r-sm); display: grid; place-items: center; flex: 0 0 28px;
  background: transparent; border: 1px solid var(--line); color: var(--text-2);
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 400;
}
.cell-title { font-weight: 500; color: var(--text); overflow-wrap: break-word; }
.cell-sub { color: var(--text-3); font-size: 12px; }
/* hanya tabel transkrip yang perlu satu baris — tabel lain butuh wrap normal */
.table-stack .cell-sub {
  display: block; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.date-short { display: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }

/* Kolom angka di tabel (mis. "Pesan" pada Sesi DM).
   Dulu memakai .num (rata kanan) dengan padding 24px di dua sisi, jadi satu
   digit angka mengambang jauh dari judul kolomnya. Lebar dipatok supaya angka
   duduk tepat di bawah judulnya, bukan di tengah sel. */
.col-count {
  width: 92px; text-align: left;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.col-activity { width: 1%; white-space: nowrap; }
.row-actions { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }

/* ---------------- badges, chips, buttons ---------------- */
.badge {
  display: inline-flex; align-items: center; gap: 6px; font-size: 9px; font-weight: 500;
  letter-spacing: .14em; padding: 3px 7px; border-radius: var(--r-sm);
  border: 1px solid var(--line-strong); color: var(--text-2); background: transparent;
  white-space: nowrap;
}
.badge .dot { width: 5px; height: 5px; box-shadow: none; }
.badge.ok { color: #c3dcc7; background: var(--ok-soft); border-color: rgba(169, 195, 173, .35); }
.badge.ok .dot { background: var(--ok); }
.badge.warn { color: #efd9ad; background: var(--warn-soft); border-color: rgba(220, 192, 143, .35); }
.badge.warn .dot { background: var(--warn); }
.badge.brand { color: #d8d3e8; background: var(--brand-soft); border-color: var(--brand-line); }
.badge.brand .dot { background: #b6b0cf; }
.badge.danger { color: #f0bcc0; background: var(--danger-soft); border-color: rgba(217, 138, 143, .35); }
.chip {
  display: inline-flex; align-items: center; gap: 7px; padding: 5px 9px; border-radius: var(--r-sm);
  background: transparent; border: 1px solid var(--line); font-size: 12px; color: var(--text-2);
}

/* Atribut hidden harus selalu menang.
   Tanpa aturan ini, kelas seperti .preview-img dan .banner-preview img yang
   memakai display:block mengalahkan atribut hidden, sehingga gambar kosong
   tetap tampil sebagai kotak rusak (bug nyata di halaman Sambutan). */
[hidden] {
  display: none !important;
}

/* Tombol: solid Wafer (bukan gradient), huruf kapital ber-spasi. */
button, .btn, .btn-primary, .btn-ghost, .btn-danger {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: var(--font-ui); font-size: 11px; font-weight: 500;
  letter-spacing: .13em; text-transform: uppercase; padding: 12px 18px; border-radius: var(--r-sm);
  cursor: pointer; border: 1px solid transparent;
  transition: background .15s, color .15s, border-color .15s, transform .06s;
  white-space: nowrap; line-height: 1.2;
}
button:active { transform: translateY(1px); }
.btn-primary { background: var(--text); border-color: var(--text); color: var(--ink); }
.btn-primary:hover { background: var(--text-2); border-color: var(--text-2); color: var(--ink); }
.btn-ghost { background: transparent; border-color: var(--line-strong); color: var(--text); }
.btn-ghost:hover { background: rgba(226, 209, 204, .08); border-color: var(--text); }
.btn-danger { background: transparent; border-color: rgba(217, 138, 143, .5); color: #e6aeb2; }
.btn-danger:hover { background: var(--danger-soft); border-color: var(--danger); }
.btn-sm { padding: 8px 12px; font-size: 9.5px; letter-spacing: .12em; border-radius: var(--r-sm); }
.btn-icon { padding: 8px; }
button:disabled { opacity: .45; cursor: not-allowed; }

/* ---------------- forms ---------------- */
label.field {
  display: block; font-size: 9.5px; font-weight: 500; letter-spacing: .16em;
  text-transform: uppercase; color: var(--text-3); margin-bottom: 8px;
}
input[type=text], input[type=password], input[type=search], input[type=url], select, textarea {
  width: 100%; font: inherit; font-size: 13.5px; color: var(--text);
  background: var(--bg-soft); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 11px 12px;
  transition: border-color .15s, background .15s;
}
input:focus, select:focus, textarea:focus {
  outline: none; border-color: var(--brand-line); background: var(--bg-soft);
}
input::placeholder, textarea::placeholder { color: var(--text-3); }
textarea { min-height: 120px; resize: vertical; line-height: 1.6; }
textarea.mono { font-family: var(--font-mono); font-size: 12.5px; }

/* dropzone: input file disembunyikan, seluruh kotak bisa diklik */
.drop {
  position: relative; display: flex; align-items: center; gap: 14px;
  border: 1px dashed var(--line-strong); border-radius: var(--r-sm);
  padding: 20px 18px; cursor: pointer; transition: border-color .15s, background .15s;
}
.drop:hover { border-color: var(--text); background: rgba(226, 209, 204, .04); }
.drop input[type=file] {
  position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;
}
.drop-ico {
  width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center;
  border: 1px solid var(--line); border-radius: var(--r-sm); color: var(--text-2);
}
.drop-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.drop-text b {
  font-weight: 500; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.drop-text span {
  font-size: 9px; font-weight: 500; letter-spacing: .12em; color: var(--text-3);
}
.field-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.field-grid { display: grid; gap: 18px; }
.hint { color: var(--text-3); font-size: 12.5px; margin: 8px 0 0; }

/* ---------------- tab Sambutan / Perpisahan ----------------
   Halaman ini dulu menumpuk dua form panjang lalu pratinjau di bawahnya, jadi
   untuk melihat hasil satu sakelar admin harus scroll jauh. Sekarang hanya satu
   jenis pesan tampil sekaligus, dengan pratinjau menempel di kanan. */
.tabs {
  display: flex; align-items: flex-end; gap: 4px;
  border-bottom: 1px solid var(--line); padding-bottom: 0; flex-wrap: wrap;
}
.tab {
  /* Tombol global: padding 12px 18px + huruf kapital ber-spasi. Tab butuh
     bentuk lain, jadi semuanya ditimpa di sini.
     justify-content: flex-start WAJIB: aturan button global memakai center,
     dan di HP tiap tab selebar layar sehingga teks+penanda sebagai satu grup
     tergeser ke tengah — penandanya jadi tampak melayang jauh dari teksnya. */
  display: inline-flex; align-items: center; justify-content: flex-start; gap: 8px;
  padding: 11px 18px; margin-bottom: -1px;
  background: transparent; border: 1px solid transparent; border-bottom: 2px solid transparent;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
  color: var(--text-3); font-size: 11px; font-weight: 500;
  letter-spacing: .13em; text-transform: uppercase; cursor: pointer;
  transition: color .15s, border-color .15s, background .15s;
}
.tab:hover { color: var(--text); background: rgba(226, 209, 204, .04); }
.tab:active { transform: none; }
.tab.is-active { color: var(--text); border-bottom-color: var(--text); }
/* Penanda "jenis pesan ini sedang aktif". Dulu berupa titik kecil, dan
   maksudnya tidak terbaca: di layar sempit ia tampak seperti bullet nyasar di
   samping teks tab, dan orang mengira itu penanda tab yang sedang dibuka.
   Sekarang teks "AKTIF" — tidak mungkin disalahartikan. */
.tab-flag {
  font-size: 8px; font-weight: 500; letter-spacing: .1em;
  padding: 2px 5px; border-radius: var(--r-sm);
  color: #c3dcc7; background: var(--ok-soft); border: 1px solid rgba(169, 195, 173, .35);
  flex: 0 0 auto; line-height: 1.3; white-space: nowrap;
}

.tab-pane { margin-top: 18px; }
.pane-head {
  display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap;
  margin-bottom: 12px;
}
.pane-head h2 { font-size: 19px; font-weight: 500; letter-spacing: -.02em; }
.pane-head .hint { margin: 4px 0 0; }
.pane-head .right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
/* Form di kiri (lebih lebar), pratinjau di kanan. PENTING: item grid tidak
   boleh saling meregang — tanpa align-items:start, kartu pratinjau ikut
   setinggi form dan "menempel" di layar jadi tidak berguna. */
.pane-grid {
  display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: 14px; align-items: start;
}
/* Pratinjau menempel di bawah topbar saat form di-scroll. Dengan begitu hasil
   tes terlihat tanpa harus menggulir ke bawah. align-self:start wajib supaya
   sticky bekerja di dalam grid. */
.pane-preview {
  position: sticky; top: 84px; align-self: start;
  max-height: calc(100vh - 104px); overflow-y: auto;
}
@media (max-width: 1080px) {
  /* Layar sedang: satu kolom. Pratinjau dilepas dari sticky dan diletakkan
     SETELAH form (bukan sebelumnya), karena di HP orang mengisi dulu baru
     melihat hasil. */
  .pane-grid { grid-template-columns: minmax(0, 1fr); }
  .pane-preview { position: static; max-height: none; overflow: visible; }
}
@media (max-width: 640px) {
  .tabs .hint { display: none; } /* keterangan panjang tidak muat, tab tetap jelas */
  .tab { flex: 1 1 auto; justify-content: center; padding: 11px 12px; }
  .pane-head h2 { font-size: 17px; }
}

/* Kelompok sakelar tampilan (kartu / embed) di halaman Sambutan.
   Dikelompokkan karena dua-duanya mengatur pesan yang sama; dulu hanya ada
   satu checkbox tanpa keterangan, sehingga tidak jelas ia mengubah yang mana. */
.check-group {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-2);
}
.hint code { font-size: 11.5px; }

/* ---------------- empty state ---------------- */
.empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px;
  padding: 48px 24px; color: var(--text-3);
}
.empty-ico {
  width: 44px; height: 44px; border-radius: var(--r-sm); display: grid; place-items: center;
  background: transparent; border: 1px solid var(--line); color: var(--text-2);
}
.empty b {
  color: var(--text); font-weight: 500; font-size: 16px; letter-spacing: -.01em;
}
.empty p { margin: 0; font-size: 12.5px; max-width: 380px; }

/* ---------------- misc ---------------- */
/* Kotak informasi (mis. bot offline di halaman Panel) — tenang, bukan alarm. */
.notice {
  display: flex; gap: 10px; align-items: flex-start; font-size: 12.5px; line-height: 1.5;
  color: var(--text-2); padding: 12px 14px; border-radius: var(--r-sm);
  border: 1px solid rgba(220, 192, 143, .28); background: var(--warn-soft);
}
.notice svg { color: var(--warn); flex: 0 0 16px; margin-top: 1px; }

.list { display: flex; flex-direction: column; }
.list-row {
  display: flex; gap: 12px; align-items: flex-start; padding: 16px 24px; border-bottom: 1px solid var(--line);
}
.list-row:last-child { border-bottom: none; }
.list-row:hover { background: rgba(226, 209, 204, .035); }
.list-body { min-width: 0; flex: 1; }
.list-title {
  font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  letter-spacing: -.005em;
}
.list-text { color: var(--text-2); font-size: 13px; margin-top: 4px; white-space: pre-wrap; }
.list-meta {
  color: var(--text-3); font-size: 9px; font-weight: 500; letter-spacing: .12em;
  margin-top: 9px; display: flex; gap: 12px; flex-wrap: wrap;
}
.kv {
  display: flex; justify-content: space-between; gap: 14px; padding: 13px 24px;
  border-bottom: 1px solid var(--line); font-size: 13px;
}
.kv:last-child { border-bottom: none; }
.kv span { color: var(--text-3); }
.kv b { font-weight: 500; font-variant-numeric: tabular-nums; }
.kv b.mono { font-family: var(--font-mono); font-size: 12px; }
details.user-group { border-bottom: 1px solid var(--line); }
details.user-group:last-child { border-bottom: none; }
details.user-group > summary {
  list-style: none; cursor: pointer; padding: 16px 24px; display: flex; align-items: center; gap: 12px;
}
details.user-group > summary::-webkit-details-marker { display: none; }
details.user-group > summary:hover { background: rgba(226, 209, 204, .035); }
details.user-group[open] > summary { background: rgba(226, 209, 204, .05); }
.chev { margin-left: auto; color: var(--text-3); transition: transform .18s; }
details[open] .chev { transform: rotate(180deg); }

.toast {
  position: fixed; right: 24px; bottom: 24px; z-index: 90; display: flex; align-items: center; gap: 10px;
  background: var(--text); border: 1px solid var(--text); border-left: 3px solid var(--ink);
  border-radius: var(--r-sm); padding: 13px 18px; font-size: 12.5px; max-width: 380px;
  color: var(--ink); font-weight: 500; letter-spacing: .01em;
  box-shadow: 0 24px 60px -28px rgba(0, 0, 0, 1);
  transform: translateY(14px); opacity: 0; pointer-events: none; transition: all .22s ease;
}
.toast.show { transform: translateY(0); opacity: 1; }
.toast.bad { background: #1a1013; color: #f0bcc0; border-color: #2b181c; border-left-color: var(--danger); }

dialog.confirm {
  border: 1px solid var(--line-strong); border-radius: var(--r); background: var(--surface);
  color: var(--text); padding: 0; max-width: 420px; width: calc(100% - 40px); box-shadow: none;
}
dialog.confirm::backdrop { background: rgba(8, 6, 9, .8); backdrop-filter: blur(2px); }
.dialog-body { padding: 26px 24px 22px; }
.dialog-body h3 {
  font-size: 22px; font-weight: 500; letter-spacing: -.025em; margin-bottom: 8px;
}
.dialog-body p { margin: 0; color: var(--text-2); font-size: 13.5px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 24px; border-top: 1px solid var(--line); }

/* ---------------- login ---------------- */
.login-wrap {
  min-height: 100vh; display: grid; place-items: center; padding: 32px 24px; position: relative; z-index: 1;
}
.login-card { width: 100%; max-width: 430px; }
.login-head { display: flex; flex-direction: column; gap: 14px; margin-bottom: 26px; }
.login-head .kicker {
  font-size: 9px; font-weight: 500; letter-spacing: .22em; color: var(--text-3);
}
.login-head .brand-mark { width: 40px; height: 40px; border-radius: var(--r-sm); }
.login-head h1 { font-size: 36px; line-height: 1.03; }
.login-head p { margin: 0; color: var(--text-2); font-size: 13px; max-width: 38ch; }
.login-form { padding: 26px 24px; display: flex; flex-direction: column; gap: 18px; }
.login-form .btn-primary { width: 100%; }
.alert {
  display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; border-radius: var(--r-sm);
  padding: 11px 12px; background: var(--danger-soft);
  border: 1px solid rgba(217, 138, 143, .35); color: #f0bcc0;
}
.login-foot {
  text-align: center; color: var(--text-3); font-size: 9px; font-weight: 500;
  letter-spacing: .12em; margin-top: 20px; line-height: 1.9;
}
.pw-shell { position: relative; display: block; }
.pw-shell input { padding-right: 44px; }
.pw-toggle {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: transparent; border: 0; color: var(--text-3); padding: 7px; cursor: pointer; border-radius: var(--r-sm);
}
.pw-toggle:hover { color: var(--text); background: rgba(226, 209, 204, .06); }

/* ---------------- skeleton ---------------- */
.sk { background: var(--bg-soft); border-radius: var(--r-sm); height: 12px; animation: sk 1.4s ease-in-out infinite; }
@keyframes sk { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }

/* ---------------- responsive ---------------- */
@media (max-width: 1080px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cols-2 { grid-template-columns: minmax(0, 1fr); }
  .search { display: none; }
  .content { padding: 36px 28px 100px; }
  .topbar { padding: 12px 28px; }
}
@media (max-width: 860px) {
  .sidebar {
    position: fixed; inset: 0 auto 0 0; transform: translateX(-102%); transition: transform .22s ease;
    width: 280px; padding: 22px 18px;
  }
  /* bayangan hanya saat drawer terbuka — kalau selalu ada, blur-nya ikut menodai konten. */
  .sidebar.open { transform: translateX(0); box-shadow: 30px 0 80px rgba(0, 0, 0, .9); }
  .backdrop { position: fixed; inset: 0; background: rgba(8, 6, 9, .74); z-index: 35; display: none; }
  .backdrop.show { display: block; }
  .burger { display: inline-grid; }
  .topbar { padding: 10px 16px; gap: 10px; }
  .topbar-right .chip { display: none; }
  .select-shell select { min-width: 0; max-width: 52vw; font-size: 11.5px; padding: 7px 26px 7px 0; }
  /* Di layar sempit ID-nya disembunyikan — nama server sudah cukup. */
  .guild-static { padding: 6px 10px; gap: 7px; flex: 1; min-width: 0; }
  .guild-static-id { display: none; }
  .guild-static > span:not(.guild-static-id) { max-width: 100%; font-size: 12.5px; }
  .content { padding: 26px 16px 96px; }
  h1 { font-size: 33px; }
  .page-head { margin-bottom: 24px; padding-bottom: 16px; gap: 16px; }
  .card-head, .chart { padding-left: 16px; padding-right: 16px; }
  .chart-legend { padding-left: 16px; padding-right: 16px; }
  th { padding: 11px 16px; }
  td { padding: 13px 16px; }
  /* kolom sekunder disembunyikan di HP biar tombol Unduh tidak perlu di-scroll */
  .col-hide-sm { display: none; }
  .date-long { display: none; }
  .date-short { display: inline; }
  .table-stack .cell-sub { max-width: 42vw; }
  .card-pad { padding: 18px 16px; }
  .list-row, .kv, details.user-group > summary { padding-left: 16px; padding-right: 16px; }
  .cols-2-even { grid-template-columns: minmax(0, 1fr); }
  .toast { left: 16px; right: 16px; max-width: none; bottom: 16px; }
  /* Judul kartu + hint + aksi sering tidak muat satu baris di HP. Dulu
     flex-wrap menaruh badge di baris kedua dan hasilnya terlihat melorot
     (38px dari tepi atas, 19px dari bawah). Grid dua kolom membuat
     judul+hint menumpuk di kiri sementara badge tetap di tengah tinggi. */
  .card-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 12px;
    row-gap: 3px;
  }
  .card-head h2, .card-head .hint { grid-column: 1; }
  .card-head .right { grid-column: 2; grid-row: 1 / span 2; margin-left: 0; }
}
@media (max-width: 520px) {
  .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .stat { padding: 13px 11px 15px; gap: 14px; }
  .stat-value { font-size: 30px; }
  .stat-foot { font-size: 10px; line-height: 1.35; }
  .page-head { display: block; }
  .page-head h1 { font-size: 31px; }
  .page-actions { width: 100%; margin-top: 16px; }
  .page-actions .btn, .page-actions .btn-primary, .page-actions .btn-ghost {
    flex: 1; justify-content: center;
  }
  .page-actions .badge { flex: 0 0 auto; }
  .login-head h1 { font-size: 31px; }
  .bars { height: 150px; gap: 8px; background-image: repeating-linear-gradient(to top, rgba(226, 209, 204, .08) 0 1px, transparent 1px 38px); }
  .bar-day { font-size: 8.5px; letter-spacing: .06em; }
  .bar-day .day-long { display: none; }
  .bar-day .day-short { display: inline; }
  /* avatar di tabel memakan ruang di layar sempit — sembunyikan, ID sudah cukup */
  td .cell-main .avatar-sm { display: none; }
  .cell-sub { white-space: nowrap; }
}
/* Tabel arsip transkrip berubah jadi daftar bertumpuk di layar sempit,
   supaya tombol Unduh/Hapus tidak perlu di-scroll ke samping. */
@media (max-width: 560px) {
  .table-stack thead { display: none; }
  .table-stack, .table-stack tbody { display: block; width: 100%; }
  .table-stack tr {
    display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px;
    padding: 16px; border-bottom: 1px solid var(--line);
  }
  .table-stack tr:last-child { border-bottom: 0; }
  .table-stack td { display: block; padding: 0; border: 0; width: auto; }
  /* di tumpukan HP semua statistik muat satu baris, jadi kolom yang tadi disembunyikan dimunculkan lagi */
  .table-stack td.col-hide-sm { display: block; }
  .table-stack td.cell-main-cell { flex: 1 1 100%; }
  .table-stack td.num { flex: 0 0 auto; text-align: left; }
  .table-stack td.num::before {
    content: attr(data-label); font-size: 9px; font-weight: 500; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-3); margin-right: 5px;
  }
  .table-stack td.cell-date { flex: 0 0 auto; margin-left: auto; }
  /* Tombol hapus menempel di kanan baris terakhir, bukan turun ke baris sendiri. */
  .table-stack td.cell-aksi { flex: 0 0 auto; margin-left: 0; }
  .table-stack .row-actions { justify-content: flex-start; }
}

/* Baris toggle: label di kiri, switch di kanan (flex supaya tidak turun baris). */
.toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; width: 100%;
  /* .toggle-row adalah grid item (induknya display:grid). Grid item punya
     min-width:auto, jadi tanpa baris ini ia selebar teks penjelasan dan
     kartu memotong sisanya di layar HP. */
  min-width: 0;
}
/* Sama untuk anak flex-nya: .switch dikecualikan supaya tetap 40x22 px. */
.toggle-row > div { min-width: 0; flex: 1 1 auto; }
.toggle-row > .switch { flex: 0 0 auto; }
/* Penjelasan boleh turun baris; jangan dihitung selebar satu baris teksnya.
   Tanpa nowrap-reset, .cell-sub mewarisi white-space dari aturan tabel
   (nowrap + ellipsis) sehingga kalimatnya terpotong, bukan dibungkus. */
.toggle-row .toggle-text .cell-sub {
  max-width: 100%;
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  word-break: break-word;
}

/* Switch: input asli dipakai untuk aksesibilitas, tampilannya kotak geser. */
.switch {
  position: relative; display: inline-flex; flex: 0 0 auto;
  width: 40px; height: 22px; cursor: pointer;
}
.switch input {
  position: absolute; opacity: 0; width: 100%; height: 100%;
  margin: 0; cursor: pointer; z-index: 1;
}
.switch .slider {
  position: absolute; inset: 0; border-radius: 999px;
  background: var(--bg-soft); border: 1px solid var(--line);
  transition: background .15s ease, border-color .15s ease;
}
.switch .slider::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--text-3); transition: transform .15s ease, background .15s ease;
}
.switch input:checked + .slider { background: var(--brand-soft); border-color: var(--brand); }
.switch input:checked + .slider::after { transform: translateX(18px); background: var(--brand); }
.switch input:focus-visible + .slider { outline: 2px solid var(--brand); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}

/* Kotak pratinjau: menampilkan hasil uji fitur tanpa mengirim apa pun.
   Dibedakan dari kartu pengaturan supaya jelas ini keluaran, bukan isian. */
.preview-box {
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  padding: 14px;
  background: rgba(109, 140, 255, 0.04);
}
.preview-meta {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 8px;
  /* Beberapa catatan digabung dengan newline agar tetap terpisah per baris. */
  white-space: pre-line;
  line-height: 1.7;
}
.preview-text {
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
/* ------------------------------------------------------------------ */
/*  Pratinjau bentuk pesan (embed & container)                         */
/* ------------------------------------------------------------------ */
/*
   Meniru tampilan Discord, bukan menyalin persis. Tujuannya supaya admin bisa
   menilai bentuk pesan sebelum menyimpan: warna aksen, avatar, footer, dan
   posisi banner. Kalau tiap detail ditiru 1:1, CSS ini harus diperbarui setiap
   kali Discord mengubah tema — dan itu pekerjaan yang tidak pernah selesai.

   Yang PENTING ditiru: embed punya garis aksen di kiri + latar gelap, container
   punya garis aksen yang sama tanpa footer abu-abu, dan mention tampil sebagai
   chip biru di ATAS embed (bukan di dalamnya).
*/
.preview-shape {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}
/* Teks content yang menyertai pesan: mention + kalimat pada mode kartu/teks.
   Ditaruh di atas karena begitulah Discord menampilkannya. */
.preview-content {
  font-size: 14.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}
/* Chip mention. Discord menampilkannya sebagai pil biru, dan itu yang membuat
   admin langsung paham mention-nya benar-benar di luar embed. */
.preview-mention {
  display: inline-block;
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(88, 101, 242, 0.3);
  color: #c9cdfb;
  font-weight: 500;
}

/* --- Embed --- */
.preview-embed {
  position: relative;
  border-radius: 4px;
  background: #2b2d31;
  border-left: 4px solid var(--line-strong);
  padding: 12px 16px 12px 12px;
  max-width: 520px;
  overflow: hidden;
}
.preview-embed .pe-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: start;
}
.preview-embed .pe-author {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: #f2f3f5;
}
.preview-embed .pe-author img,
.preview-embed .pe-footer img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
}
.preview-embed .pe-author .pe-initial {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
  font-size: 11px;
  font-weight: 700;
  background: var(--accent);
  color: #0d0d0f;
}
.preview-embed .pe-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: #f2f3f5;
}
.preview-embed .pe-desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: #dbdee1;
  white-space: pre-wrap;
  word-break: break-word;
}
.preview-embed .pe-thumb {
  width: 72px;
  height: 72px;
  border-radius: 4px;
  object-fit: cover;
  flex: none;
}
.preview-embed .pe-thumb.pe-initial {
  display: grid;
  place-items: center;
  font-size: 26px;
  font-weight: 700;
  background: var(--accent);
  color: #0d0d0f;
}
.preview-embed .pe-image {
  display: block;
  width: 100%;
  max-height: 300px;
  object-fit: cover;
  border-radius: 4px;
  margin-top: 12px;
}
.preview-embed .pe-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.preview-embed .pe-field {
  font-size: 13px;
  color: #dbdee1;
  flex: 1 1 160px;
}
.preview-embed .pe-field b {
  display: block;
  font-size: 12.5px;
  color: #f2f3f5;
  margin-bottom: 2px;
}
.preview-embed .pe-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  color: #b5bac1;
}
.preview-embed .pe-footer img {
  width: 20px;
  height: 20px;
}

/* --- Container (Components V2) --- */
.preview-container {
  border-radius: 4px;
  background: #2b2d31;
  border-left: 4px solid var(--line-strong);
  padding: 12px 16px;
  max-width: 520px;
  display: grid;
  gap: 8px;
}
.preview-container .pc-line {
  font-size: 14px;
  line-height: 1.55;
  color: #dbdee1;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
/* Baris -# = teks kecil di Discord. Ditiru supaya footer container terlihat
   berbeda dari isi pesan. */
.preview-container .pc-line.pc-small {
  font-size: 12px;
  color: #b5bac1;
}
.preview-container .pc-sep {
  height: 1px;
  background: rgba(255, 255, 255, 0.07);
  margin: 2px 0;
}
.preview-container .pc-image {
  display: block;
  width: 100%;
  max-height: 300px;
  object-fit: cover;
  border-radius: 4px;
}
/* Avatar di container tampil sebagai gambar bulat kecil di atas teks —
   Media Gallery di Discord tidak membulatkan, tapi bentuk persegi besar untuk
   avatar 128px hanya memakan ruang tanpa menambah informasi. */
.preview-container .pc-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
}
/* Keterangan kecil saat gambar dirujuk sebagai lampiran: di browser tidak ada
   file untuk dimuat, jadi yang tampil kotak berlabel nama file — bukan ikon
   gambar rusak. */
.preview-attachment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px dashed var(--line-strong);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-3);
}

.preview-img {
  display: block;
  width: 100%;
  max-width: 460px;
  margin-top: 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
}

/* Pemilih mode tampilan (Card / Embed / Text).
   Radio, bukan dropdown: ketiga pilihan mengubah tampilan yang dilihat member,
   jadi konsekuensinya (kartu butuh mesin gambar, teks bisa me-ping) ditampilkan
   sekaligus. */
/* Dua kolom untuk 4 mode: tiga kolom membuat catatan mode paling panjang
   (Container) terpotong jadi banyak baris pendek. */
.mode-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 640px) {
  .mode-picker {
    grid-template-columns: 1fr;
  }
}
.mode-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  cursor: pointer;
  background: rgba(109, 140, 255, 0.02);
  transition: border-color 0.15s, background 0.15s;
}
.mode-option:hover {
  border-color: var(--accent);
}
/* Baris terpilih ditandai jelas — mode yang aktif harus terbaca sekali lihat. */
.mode-option:has(input:checked) {
  border-color: var(--accent);
  background: rgba(109, 140, 255, 0.08);
}
.mode-option input {
  margin-top: 2px;
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  flex: 0 0 auto;
}
.mode-body {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.mode-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mode-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--accent);
  background: rgba(109, 140, 255, 0.14);
}
.mode-note {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-2);
}

/* Banner unggahan: kotak pratinjau di kiri, tombol di kanan.
   Ukurannya dibuat mirip kartu (900x320) tapi lebih pendek supaya tidak makan
   tempat di form. */
.banner-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.banner-preview {
  flex: 1 1 260px;
  min-height: 96px;
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: rgba(109, 140, 255, 0.03);
  overflow: hidden;
}
.banner-preview img {
  display: block;
  width: 100%;
  max-height: 150px;
  object-fit: cover;
  border-radius: 6px;
}
.banner-preview span {
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
}
.banner-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Baris tombol kirim-tes: pilihan tujuan + tombol, sejajar dan membungkus
   di layar sempit (390px) tanpa memotong teks tombol. */
.send-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.send-select {
  flex: 1 1 200px;
  min-width: 0;
  padding: 11px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
}
`;