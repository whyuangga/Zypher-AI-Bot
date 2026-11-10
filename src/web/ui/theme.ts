/**
 * Design system dashboard — satu blok CSS, tanpa framework.
 *
 * Gaya: editorial / monokrom. Bidang gelap rata (#0D0D0F), garis rambut 1px,
 * tipografi besar (serif untuk judul & angka, mono untuk label), tombol
 * solid putih tanpa gradient. Semua warna & radius lewat CSS variable.
 * Tidak ada `@import`/font eksternal: panel hosting boleh jadi tidak punya
 * akses internet keluar, dan font sistem sudah cukup cepat.
 */
export const STYLE = `
:root {
  color-scheme: dark;
  --bg: #0d0d0f;
  --bg-soft: #111114;
  --surface: #131316;
  --surface-2: #191920;
  --surface-3: #232329;
  --line: rgba(255, 255, 255, .11);
  --line-strong: rgba(255, 255, 255, .26);
  --text: #ffffff;
  --text-2: #b6b6c0;
  --text-3: #7d7d8a;
  --ink: #0d0d0f;
  --ok: #46d19b;
  --ok-soft: rgba(70, 209, 155, .1);
  --warn: #f2c55c;
  --warn-soft: rgba(242, 197, 92, .1);
  --danger: #ff6b6b;
  --danger-soft: rgba(255, 107, 107, .1);
  --r-sm: 2px;
  --r: 2px;
  --r-lg: 3px;
  --shadow: none;
  --sidebar: 252px;
  --font-ui: Inter, "Helvetica Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Noto Serif", "Times New Roman", serif;
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
  font: 15px/1.62 var(--font-ui);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: var(--text); text-decoration: none; border-bottom: 1px solid var(--line-strong); }
a:hover { border-bottom-color: var(--text); }
h1, h2, h3 { margin: 0; font-weight: 400; }
h1 {
  font-family: var(--font-display); font-size: 42px; line-height: 1.02;
  letter-spacing: -.028em;
}
h2 { font-size: 13px; }
code, .mono { font-family: var(--font-mono); font-size: 12px; }
code {
  background: rgba(255, 255, 255, .06); border: 0;
  padding: 1px 5px; border-radius: var(--r-sm); color: var(--text);
  font-size: 11.5px; white-space: nowrap;
}
::selection { background: #fff; color: var(--ink); }
:focus-visible { outline: 1px solid #fff; outline-offset: 3px; }

/* label kecil ala katalog pameran: mono, huruf kapital, spasi lebar */
.kicker, .stat-label, .nav-label, th, .badge, .brand-sub {
  font-family: var(--font-mono); text-transform: uppercase;
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
  font-family: var(--font-display); font-weight: 400; font-size: 19px; letter-spacing: -.01em;
}
.brand-sub { font-size: 9.5px; color: var(--text-3); letter-spacing: .2em; margin-top: 3px; }

.nav { display: flex; flex-direction: column; gap: 0; }
.nav-label {
  font-size: 9.5px; letter-spacing: .2em; color: var(--text-3);
  padding: 0 0 10px; border-bottom: 1px solid var(--line); margin-bottom: 10px;
}
.nav-item {
  position: relative; display: flex; align-items: center; gap: 11px;
  padding: 10px 10px 10px 12px; border-radius: 0;
  color: var(--text-2); font-size: 14px; font-weight: 400; letter-spacing: -.005em;
  border: 0; border-bottom: 1px solid transparent;
  transition: color .15s, background .15s;
}
.nav-item:hover { background: rgba(255, 255, 255, .05); color: var(--text); border-bottom-color: transparent; }
.nav-item.active { color: var(--text); background: rgba(255, 255, 255, .06); }
.nav-item.active::before {
  content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 2px; height: 16px; background: #fff;
}
.nav-item.active svg { color: var(--text); opacity: 1; }
.nav-item svg { color: var(--text-3); opacity: .9; flex: 0 0 18px; }
.nav-badge {
  margin-left: auto; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-2);
  border: 1px solid var(--line); border-radius: var(--r-sm); padding: 0 5px; min-width: 20px; text-align: center;
}
.sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: 14px; padding-top: 22px; }
.status-card {
  border: 0; border-top: 1px solid var(--line); background: transparent;
  border-radius: 0; padding: 14px 0 0; display: flex; flex-direction: column; gap: 6px;
}
.status-line {
  display: flex; align-items: center; gap: 8px; font-family: var(--font-mono);
  font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-2);
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
.guild-picker { display: flex; align-items: center; gap: 8px; }
.select-shell { position: relative; display: inline-flex; align-items: center; }
.select-shell svg { position: absolute; right: 10px; pointer-events: none; color: var(--text-3); }
.select-shell select {
  appearance: none; padding: 8px 32px 8px 0; min-width: 190px; max-width: 260px;
  background: transparent; border: 0; border-bottom: 1px solid var(--line-strong); border-radius: 0;
  color: var(--text); font-family: var(--font-mono); font-size: 12.5px; letter-spacing: .02em;
}
.select-shell select:hover { border-bottom-color: #fff; }
.guild-manual { display: flex; gap: 6px; }
.guild-manual input {
  width: 168px; padding: 8px 10px; background: transparent; border: 1px solid var(--line);
  border-radius: var(--r-sm); color: var(--text); font-family: var(--font-mono); font-size: 12px;
}
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.search { position: relative; display: flex; align-items: center; }
.search svg { position: absolute; left: 0; color: var(--text-3); }
.search input {
  width: 200px; padding: 8px 10px 8px 22px; background: transparent;
  border: 0; border-bottom: 1px solid var(--line); border-radius: 0; color: var(--text); font-size: 13px;
}
.search kbd {
  position: absolute; right: 0; font-family: var(--font-mono); font-size: 10px; color: var(--text-3);
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
}
.icon-btn:hover { color: var(--text); border-color: var(--line-strong); background: rgba(255, 255, 255, .05); }
.burger { display: none; }

.content { padding: 44px 40px 110px; width: 100%; max-width: 1240px; margin: 0 auto; }
.page-head {
  display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap;
  margin-bottom: 34px; padding-bottom: 20px; border-bottom: 1px solid var(--line);
}
.page-head .kicker {
  display: block; font-size: 10px; letter-spacing: .22em; color: var(--text-3);
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
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 500; letter-spacing: .18em;
  text-transform: uppercase; color: var(--text);
}
.card-head .hint { color: var(--text-3); font-size: 12px; letter-spacing: -.005em; }
.card-head .right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.grid { display: grid; gap: 14px; }
.stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.cols-2 { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); align-items: start; }
.cols-2-even { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
.mt { margin-top: 14px; }

.stat {
  padding: 20px 22px 22px; display: flex; flex-direction: column; gap: 22px;
  position: relative; overflow: hidden;
}
.stat-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.stat-label { font-size: 10px; letter-spacing: .16em; color: var(--text-3); line-height: 1.5; }
.stat-ico {
  width: 26px; height: 26px; border-radius: var(--r-sm); display: grid; place-items: center;
  background: transparent; color: var(--text-3); border: 1px solid var(--line);
}
.stat-value {
  font-family: var(--font-display); font-size: 48px; font-weight: 400;
  letter-spacing: -.035em; line-height: .92; font-variant-numeric: tabular-nums;
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
  background-image: repeating-linear-gradient(to top, rgba(255, 255, 255, .06) 0 1px, transparent 1px 44px);
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
  background: rgba(255, 255, 255, .32);
  transition: background .15s, height .4s cubic-bezier(.2, .8, .2, 1);
}
.bar-col:hover .bar-fill { background: #fff; }
.bar-col.today .bar-fill { background: #fff; }
.bar-col.zero .bar-fill { background: rgba(255, 255, 255, .1); }
.bar-val {
  position: absolute; top: -4px; left: 0; right: 0; text-align: center;
  font-family: var(--font-mono); font-size: 11px; color: var(--text);
  opacity: 0; transition: opacity .15s;
}
.bar-col:hover .bar-val { opacity: 1; }
.bar-day {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--text-3); white-space: nowrap;
}
.bar-col.today .bar-day { color: var(--text); }
.chart-legend {
  display: flex; align-items: center; gap: 14px; font-size: 12px; color: var(--text-3);
  padding: 14px 24px 20px;
}
.legend-key { display: inline-flex; align-items: center; gap: 7px; }
.legend-swatch { width: 8px; height: 8px; border-radius: 0; background: #fff; }

/* ---------------- tables ---------------- */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th {
  text-align: left; padding: 12px 24px; font-size: 9.5px; letter-spacing: .16em;
  color: var(--text-3); font-weight: 500; border-bottom: 1px solid var(--line); white-space: nowrap;
}
td {
  padding: 15px 24px; border-bottom: 1px solid var(--line); vertical-align: middle;
  font-variant-numeric: tabular-nums;
}
tbody tr:last-child td { border-bottom: none; }
tbody tr { transition: background .12s; }
tbody tr:hover { background: rgba(255, 255, 255, .035); }
.cell-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.avatar-sm {
  width: 28px; height: 28px; border-radius: var(--r-sm); display: grid; place-items: center; flex: 0 0 28px;
  background: transparent; border: 1px solid var(--line); color: var(--text-2);
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 400;
}
.cell-title { font-weight: 500; color: var(--text); }
.cell-sub { color: var(--text-3); font-size: 12px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }

/* ---------------- badges, chips, buttons ---------------- */
.badge {
  display: inline-flex; align-items: center; gap: 6px; font-size: 9.5px; font-weight: 500;
  letter-spacing: .12em; padding: 3px 7px; border-radius: var(--r-sm);
  border: 1px solid var(--line-strong); color: var(--text-2); background: transparent;
  white-space: nowrap;
}
.badge .dot { width: 5px; height: 5px; box-shadow: none; }
.badge.ok { color: #9df0cd; background: var(--ok-soft); border-color: rgba(70, 209, 155, .32); }
.badge.ok .dot { background: var(--ok); }
.badge.warn { color: #f7d98f; background: var(--warn-soft); border-color: rgba(242, 197, 92, .32); }
.badge.warn .dot { background: var(--warn); }
.badge.brand { color: #fff; background: rgba(255, 255, 255, .08); border-color: var(--line-strong); }
.badge.brand .dot { background: #fff; }
.badge.danger { color: #ffb3b3; background: var(--danger-soft); border-color: rgba(255, 107, 107, .32); }
.chip {
  display: inline-flex; align-items: center; gap: 7px; padding: 5px 9px; border-radius: var(--r-sm);
  background: transparent; border: 1px solid var(--line); font-size: 12px; color: var(--text-2);
}

/* Tombol: solid putih (bukan gradient), huruf kapital mono — bahasa visual editorial. */
button, .btn, .btn-primary, .btn-ghost, .btn-danger {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 500;
  letter-spacing: .14em; text-transform: uppercase; padding: 12px 18px; border-radius: var(--r-sm);
  cursor: pointer; border: 1px solid transparent;
  transition: background .15s, color .15s, border-color .15s, transform .06s;
  white-space: nowrap; line-height: 1.2;
}
button:active { transform: translateY(1px); }
.btn-primary { background: #fff; border-color: #fff; color: var(--ink); }
.btn-primary:hover { background: #dedee3; border-color: #dedee3; color: var(--ink); }
.btn-ghost { background: transparent; border-color: var(--line-strong); color: var(--text); }
.btn-ghost:hover { background: rgba(255, 255, 255, .07); border-color: #fff; }
.btn-danger { background: transparent; border-color: rgba(255, 107, 107, .5); color: #ff9a9a; }
.btn-danger:hover { background: var(--danger-soft); border-color: var(--danger); }
.btn-sm { padding: 8px 12px; font-size: 9.5px; letter-spacing: .12em; border-radius: var(--r-sm); }
.btn-icon { padding: 8px; }
button:disabled { opacity: .45; cursor: not-allowed; }

/* ---------------- forms ---------------- */
label.field {
  display: block; font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--text-3); margin-bottom: 8px; font-weight: 400;
}
input[type=text], input[type=password], input[type=search], input[type=url], select, textarea {
  width: 100%; font: inherit; font-size: 13.5px; color: var(--text);
  background: var(--bg-soft); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 11px 12px;
  transition: border-color .15s, background .15s;
}
input:focus, select:focus, textarea:focus {
  outline: none; border-color: var(--line-strong); background: var(--surface);
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
.drop:hover { border-color: #fff; background: rgba(255, 255, 255, .03); }
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
  font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--text-3);
}
.field-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.field-grid { display: grid; gap: 18px; }
.hint { color: var(--text-3); font-size: 12.5px; margin: 8px 0 0; }
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
  color: var(--text); font-weight: 400; font-size: 16px; font-family: var(--font-display);
  letter-spacing: -.01em;
}
.empty p { margin: 0; font-size: 12.5px; max-width: 380px; }

/* ---------------- misc ---------------- */
.list { display: flex; flex-direction: column; }
.list-row {
  display: flex; gap: 12px; align-items: flex-start; padding: 16px 24px; border-bottom: 1px solid var(--line);
}
.list-row:last-child { border-bottom: none; }
.list-row:hover { background: rgba(255, 255, 255, .03); }
.list-body { min-width: 0; flex: 1; }
.list-title {
  font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  letter-spacing: -.005em;
}
.list-text { color: var(--text-2); font-size: 13px; margin-top: 4px; white-space: pre-wrap; }
.list-meta {
  color: var(--text-3); font-family: var(--font-mono); font-size: 10px; letter-spacing: .1em;
  text-transform: uppercase; margin-top: 9px; display: flex; gap: 12px; flex-wrap: wrap;
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
details.user-group > summary:hover { background: rgba(255, 255, 255, .03); }
details.user-group[open] > summary { background: rgba(255, 255, 255, .04); }
.chev { margin-left: auto; color: var(--text-3); transition: transform .18s; }
details[open] .chev { transform: rotate(180deg); }

.toast {
  position: fixed; right: 24px; bottom: 24px; z-index: 90; display: flex; align-items: center; gap: 10px;
  background: #fff; border: 1px solid #fff; border-left: 3px solid #fff;
  border-radius: var(--r-sm); padding: 13px 18px; font-size: 12.5px; max-width: 380px;
  color: var(--ink); font-family: var(--font-mono); letter-spacing: .04em;
  box-shadow: 0 24px 60px -28px rgba(0, 0, 0, 1);
  transform: translateY(14px); opacity: 0; pointer-events: none; transition: all .22s ease;
}
.toast.show { transform: translateY(0); opacity: 1; }
.toast.bad { background: #17090b; color: #ffb3b3; border-color: #2a1113; border-left-color: var(--danger); }

dialog.confirm {
  border: 1px solid var(--line-strong); border-radius: var(--r); background: var(--surface);
  color: var(--text); padding: 0; max-width: 420px; width: calc(100% - 40px); box-shadow: none;
}
dialog.confirm::backdrop { background: rgba(5, 5, 7, .78); backdrop-filter: blur(2px); }
.dialog-body { padding: 26px 24px 22px; }
.dialog-body h3 {
  font-family: var(--font-display); font-size: 24px; letter-spacing: -.02em; margin-bottom: 8px;
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
  font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .22em;
  text-transform: uppercase; color: var(--text-3);
}
.login-head .brand-mark { width: 40px; height: 40px; border-radius: var(--r-sm); }
.login-head h1 { font-size: 34px; line-height: 1.04; }
.login-head p { margin: 0; color: var(--text-2); font-size: 13px; max-width: 38ch; }
.login-form { padding: 26px 24px; display: flex; flex-direction: column; gap: 18px; }
.login-form .btn-primary { width: 100%; }
.alert {
  display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; border-radius: var(--r-sm);
  padding: 11px 12px; background: var(--danger-soft);
  border: 1px solid rgba(255, 107, 107, .32); color: #ffb3b3;
}
.login-foot {
  text-align: center; color: var(--text-3); font-family: var(--font-mono); font-size: 9.5px;
  letter-spacing: .1em; text-transform: uppercase; margin-top: 20px; line-height: 1.9;
}
.pw-shell { position: relative; display: block; }
.pw-shell input { padding-right: 44px; }
.pw-toggle {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: transparent; border: 0; color: var(--text-3); padding: 7px; cursor: pointer; border-radius: var(--r-sm);
}
.pw-toggle:hover { color: var(--text); background: rgba(255, 255, 255, .06); }

/* ---------------- skeleton ---------------- */
.sk { background: var(--surface-2); border-radius: var(--r-sm); height: 12px; animation: sk 1.4s ease-in-out infinite; }
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
  .backdrop { position: fixed; inset: 0; background: rgba(5, 5, 7, .72); z-index: 35; display: none; }
  .backdrop.show { display: block; }
  .burger { display: inline-grid; }
  .topbar { padding: 10px 16px; gap: 10px; }
  .guild-manual { display: none; }
  .topbar-right .chip { display: none; }
  .select-shell select { min-width: 0; max-width: 52vw; font-size: 11.5px; padding: 7px 26px 7px 0; }
  .content { padding: 26px 16px 96px; }
  h1 { font-size: 32px; }
  .page-head { margin-bottom: 24px; padding-bottom: 16px; gap: 16px; }
  .card-head, .chart { padding-left: 16px; padding-right: 16px; }
  .chart-legend { padding-left: 16px; padding-right: 16px; }
  th { padding: 11px 16px; }
  td { padding: 13px 16px; }
  .card-pad { padding: 18px 16px; }
  .list-row, .kv, details.user-group > summary { padding-left: 16px; padding-right: 16px; }
  .cols-2-even { grid-template-columns: minmax(0, 1fr); }
  .toast { left: 16px; right: 16px; max-width: none; bottom: 16px; }
}
@media (max-width: 520px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .stat { padding: 16px 14px 18px; gap: 18px; }
  .stat-value { font-size: 38px; }
  .stat-foot { font-size: 11px; }
  .page-head { display: block; }
  .page-head h1 { font-size: 30px; }
  .page-actions { width: 100%; margin-top: 16px; }
  .page-actions .btn, .page-actions .btn-primary, .page-actions .btn-ghost {
    flex: 1; justify-content: center;
  }
  .page-actions .badge { flex: 0 0 auto; }
  .bars { height: 150px; gap: 8px; background-image: repeating-linear-gradient(to top, rgba(255,255,255,.06) 0 1px, transparent 1px 38px); }
  .bar-day { font-size: 9px; letter-spacing: .04em; }
  .bar-day .day-long { display: none; }
  .bar-day .day-short { display: inline; }
  /* avatar di tabel memakan ruang di layar sempit — sembunyikan, ID sudah cukup */
  td .cell-main .avatar-sm { display: none; }
  .cell-sub { white-space: nowrap; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;
