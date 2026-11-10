/**
 * Design system dashboard — satu blok CSS, tanpa framework.
 *
 * Semua warna, radius, dan bayangan lewat CSS variable supaya konsisten dan
 * gampang diubah. Tidak ada `@import`/font eksternal: panel hosting boleh jadi
 * tidak punya akses internet keluar, dan font sistem sudah cukup cepat.
 */
export const STYLE = `
:root {
  color-scheme: dark;
  --bg: #080a0f;
  --bg-soft: #0b0e15;
  --surface: #0f131c;
  --surface-2: #141926;
  --surface-3: #1a2130;
  --line: rgba(255, 255, 255, .07);
  --line-strong: rgba(255, 255, 255, .13);
  --text: #edeff5;
  --text-2: #a7afc2;
  --text-3: #6f7891;
  --brand: #7c5cff;
  --brand-2: #5b8cff;
  --brand-soft: rgba(124, 92, 255, .14);
  --ok: #34d399;
  --ok-soft: rgba(52, 211, 153, .12);
  --warn: #fbbf24;
  --warn-soft: rgba(251, 191, 36, .12);
  --danger: #f87171;
  --danger-soft: rgba(248, 113, 113, .12);
  --r-sm: 8px;
  --r: 12px;
  --r-lg: 16px;
  --shadow: 0 1px 0 rgba(255, 255, 255, .03) inset, 0 18px 40px -24px rgba(0, 0, 0, .9);
  --sidebar: 248px;
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(760px 420px at 12% -8%, rgba(124, 92, 255, .16), transparent 70%),
    radial-gradient(600px 380px at 92% 0%, rgba(91, 140, 255, .10), transparent 70%);
}
a { color: var(--brand-2); text-decoration: none; }
a:hover { color: #8fb0ff; }
h1, h2, h3 { margin: 0; letter-spacing: -.02em; font-weight: 650; }
h1 { font-size: 26px; line-height: 1.25; }
h2 { font-size: 15px; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", monospace; font-size: 12.5px; }
code { background: var(--surface-2); border: 1px solid var(--line); padding: 1px 6px; border-radius: 6px; }
::selection { background: rgba(124, 92, 255, .35); }
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

/* ---------------- shell ---------------- */
.app { position: relative; z-index: 1; display: flex; min-height: 100vh; }

.sidebar {
  position: sticky; top: 0; height: 100vh; width: var(--sidebar); flex: 0 0 var(--sidebar);
  display: flex; flex-direction: column; gap: 6px; padding: 18px 14px;
  background: linear-gradient(180deg, rgba(20, 25, 38, .92), rgba(11, 14, 21, .96));
  border-right: 1px solid var(--line);
  backdrop-filter: blur(12px); z-index: 40;
}
.brand { display: flex; align-items: center; gap: 11px; padding: 6px 8px 18px; }
.brand-mark {
  width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
  background: linear-gradient(140deg, var(--brand), var(--brand-2));
  box-shadow: 0 8px 20px -8px rgba(124, 92, 255, .9);
  color: #fff; flex: 0 0 34px;
}
.brand-text { display: flex; flex-direction: column; line-height: 1.2; }
.brand-name { font-weight: 700; font-size: 15px; letter-spacing: -.01em; }
.brand-sub { font-size: 11px; color: var(--text-3); letter-spacing: .06em; text-transform: uppercase; }

.nav { display: flex; flex-direction: column; gap: 3px; }
.nav-label {
  font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--text-3); padding: 14px 10px 6px;
}
.nav-item {
  display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: 10px;
  color: var(--text-2); font-size: 14px; font-weight: 500; transition: background .15s, color .15s;
  border: 1px solid transparent;
}
.nav-item:hover { background: rgba(255, 255, 255, .04); color: var(--text); }
.nav-item.active {
  background: linear-gradient(90deg, var(--brand-soft), rgba(124, 92, 255, .04));
  border-color: rgba(124, 92, 255, .28); color: #fff;
}
.nav-item.active svg { color: var(--brand); }
.nav-item svg { color: var(--text-3); flex: 0 0 18px; }
.nav-badge {
  margin-left: auto; font-size: 11px; color: var(--text-2);
  background: var(--surface-3); border-radius: 999px; padding: 1px 7px;
}
.sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: 10px; padding-top: 14px; }
.status-card {
  border: 1px solid var(--line); background: rgba(255, 255, 255, .02);
  border-radius: var(--r); padding: 11px 12px; display: flex; flex-direction: column; gap: 4px;
}
.status-line { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-2); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
.dot.off { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
.dot.pulse { animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
.status-meta { font-size: 11px; color: var(--text-3); }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 14px;
  padding: 12px 28px; border-bottom: 1px solid var(--line);
  background: rgba(8, 10, 15, .78); backdrop-filter: blur(14px);
}
.guild-picker { display: flex; align-items: center; gap: 8px; }
.select-shell { position: relative; display: inline-flex; align-items: center; }
.select-shell svg { position: absolute; right: 10px; pointer-events: none; color: var(--text-3); }
.select-shell select {
  appearance: none; padding: 8px 34px 8px 12px; min-width: 190px; max-width: 260px;
  background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px;
  color: var(--text); font-size: 13.5px;
}
.guild-manual { display: flex; gap: 6px; }
.guild-manual input {
  width: 168px; padding: 8px 11px; background: var(--surface); border: 1px solid var(--line);
  border-radius: 10px; color: var(--text); font-size: 13px;
}
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.search {
  position: relative; display: flex; align-items: center;
}
.search svg { position: absolute; left: 10px; color: var(--text-3); }
.search input {
  width: 220px; padding: 8px 34px 8px 32px; background: var(--surface); border: 1px solid var(--line);
  border-radius: 10px; color: var(--text); font-size: 13px;
}
.search kbd {
  position: absolute; right: 8px; font: inherit; font-size: 11px; color: var(--text-3);
  border: 1px solid var(--line); border-radius: 5px; padding: 0 5px; background: var(--surface-2);
}
.avatar {
  width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-size: 12.5px;
  font-weight: 700; color: #fff; background: linear-gradient(140deg, #6d5bff, #3f7bff); letter-spacing: .02em;
}
.icon-btn {
  display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2); cursor: pointer;
}
.icon-btn:hover { color: var(--text); border-color: var(--line-strong); background: var(--surface-2); }
.burger { display: none; }

.content { padding: 26px 28px 90px; width: 100%; max-width: 1220px; margin: 0 auto; }
.page-head { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
.page-head .sub { color: var(--text-2); font-size: 13.5px; margin: 5px 0 0; }
.page-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }

/* ---------------- cards & grid ---------------- */
.card {
  background: linear-gradient(180deg, rgba(255, 255, 255, .022), rgba(255, 255, 255, 0) 60%), var(--surface);
  border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow);
}
.card-pad { padding: 18px 20px; }
.card-head {
  display: flex; align-items: center; gap: 10px; padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}
.card-head h2 { font-size: 14px; }
.card-head .hint { color: var(--text-3); font-size: 12.5px; }
.card-head .right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.grid { display: grid; gap: 14px; }
.stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.cols-2 { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); }
.cols-2-even { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mt { margin-top: 14px; }

.stat { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; position: relative; overflow: hidden; }
.stat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.stat-label { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); }
.stat-ico {
  width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center;
  background: var(--brand-soft); color: #b7a6ff; border: 1px solid rgba(124, 92, 255, .25);
}
.stat-value { font-size: 28px; font-weight: 700; letter-spacing: -.03em; line-height: 1; }
.stat-foot { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 6px; }
.stat-foot b { color: var(--text-2); font-weight: 600; }

/* ---------------- chart ---------------- */
.chart { padding: 14px 20px 6px; }
.bars { display: flex; align-items: flex-end; gap: 10px; height: 172px; }
.bar-col {
  flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center;
  gap: 8px; height: 100%; position: relative; cursor: default;
}
.bar-track {
  width: 100%; height: 100%; display: flex; align-items: flex-end; border-radius: 9px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .02), transparent);
  position: relative; overflow: hidden;
}
.bar-fill {
  width: 100%; border-radius: 8px 8px 4px 4px; min-height: 4px;
  background: linear-gradient(180deg, #8a6bff, #5b8cff);
  box-shadow: 0 0 24px -6px rgba(124, 92, 255, .55);
  transition: filter .15s, height .4s cubic-bezier(.2, .8, .2, 1);
}
.bar-col:hover .bar-fill { filter: brightness(1.18); }
.bar-col.zero .bar-fill { background: var(--surface-3); box-shadow: none; }
.bar-val {
  position: absolute; top: -2px; left: 0; right: 0; text-align: center;
  font-size: 11.5px; font-weight: 600; color: var(--text-2); opacity: 0; transition: opacity .15s;
}
.bar-col:hover .bar-val { opacity: 1; }
.bar-day { font-size: 11.5px; color: var(--text-3); }
.bar-col.today .bar-day { color: var(--text); font-weight: 600; }
.chart-legend { display: flex; align-items: center; gap: 14px; font-size: 12px; color: var(--text-3); padding: 6px 20px 16px; }
.legend-key { display: inline-flex; align-items: center; gap: 6px; }
.legend-swatch { width: 9px; height: 9px; border-radius: 3px; background: linear-gradient(180deg, var(--brand), var(--brand-2)); }

/* ---------------- tables ---------------- */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th {
  text-align: left; padding: 10px 20px; font-size: 11px; letter-spacing: .09em; text-transform: uppercase;
  color: var(--text-3); font-weight: 600; border-bottom: 1px solid var(--line); white-space: nowrap;
}
td { padding: 13px 20px; border-bottom: 1px solid var(--line); vertical-align: middle; }
tbody tr:last-child td { border-bottom: none; }
tbody tr { transition: background .12s; }
tbody tr:hover { background: rgba(255, 255, 255, .022); }
.cell-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.avatar-sm {
  width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; flex: 0 0 30px;
  background: var(--surface-3); border: 1px solid var(--line); color: var(--text-2); font-size: 11.5px; font-weight: 700;
}
.cell-title { font-weight: 550; color: var(--text); }
.cell-sub { color: var(--text-3); font-size: 12px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }

/* ---------------- badges, chips, buttons ---------------- */
.badge {
  display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 550;
  padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line-strong);
  color: var(--text-2); background: rgba(255, 255, 255, .03); white-space: nowrap;
}
.badge .dot { width: 6px; height: 6px; box-shadow: none; }
.badge.ok { color: #7ff0c4; background: var(--ok-soft); border-color: rgba(52, 211, 153, .3); }
.badge.ok .dot { background: var(--ok); }
.badge.warn { color: #ffd782; background: var(--warn-soft); border-color: rgba(251, 191, 36, .3); }
.badge.warn .dot { background: var(--warn); }
.badge.brand { color: #c3b5ff; background: var(--brand-soft); border-color: rgba(124, 92, 255, .32); }
.badge.danger { color: #ffb4b4; background: var(--danger-soft); border-color: rgba(248, 113, 113, .3); }
.chip {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px;
  background: var(--surface-2); border: 1px solid var(--line); font-size: 12.5px; color: var(--text-2);
}

button, .btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font: inherit; font-size: 13.5px; font-weight: 600; padding: 9px 15px; border-radius: 10px;
  cursor: pointer; border: 1px solid transparent; transition: transform .06s, filter .15s, background .15s;
  white-space: nowrap;
}
button:active { transform: translateY(1px); }
.btn-primary {
  background: linear-gradient(140deg, var(--brand), var(--brand-2)); color: #fff;
  box-shadow: 0 10px 24px -14px rgba(124, 92, 255, .95);
}
.btn-primary:hover { filter: brightness(1.08); }
.btn-ghost { background: var(--surface-2); border-color: var(--line); color: var(--text); }
.btn-ghost:hover { border-color: var(--line-strong); background: var(--surface-3); }
.btn-danger { background: var(--danger-soft); border-color: rgba(248, 113, 113, .3); color: #ffb4b4; }
.btn-danger:hover { background: rgba(248, 113, 113, .2); }
.btn-sm { padding: 6px 11px; font-size: 12.5px; border-radius: 9px; }
.btn-icon { padding: 7px; border-radius: 9px; }
button:disabled { opacity: .5; cursor: not-allowed; }

/* ---------------- forms ---------------- */
label.field { display: block; font-size: 12.5px; color: var(--text-2); margin-bottom: 6px; font-weight: 550; }
input[type=text], input[type=password], input[type=search], input[type=url], select, textarea {
  width: 100%; font: inherit; font-size: 13.5px; color: var(--text);
  background: var(--bg-soft); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px;
  transition: border-color .15s, box-shadow .15s;
}
input:focus, select:focus, textarea:focus {
  outline: none; border-color: rgba(124, 92, 255, .55); box-shadow: 0 0 0 3px rgba(124, 92, 255, .16);
}
input::placeholder, textarea::placeholder { color: var(--text-3); }
textarea { min-height: 120px; resize: vertical; line-height: 1.55; }
textarea.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
input[type=file] {
  width: 100%; font-size: 13px; color: var(--text-2); background: var(--bg-soft);
  border: 1px dashed var(--line-strong); border-radius: 12px; padding: 18px 14px; cursor: pointer;
}
input[type=file]:hover { border-color: rgba(124, 92, 255, .5); background: rgba(124, 92, 255, .04); }
input[type=file]::file-selector-button {
  font: inherit; font-size: 12.5px; font-weight: 600; margin-right: 12px; padding: 7px 12px;
  border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface-3);
  color: var(--text); cursor: pointer;
}
.field-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.field-grid { display: grid; gap: 14px; }
.hint { color: var(--text-3); font-size: 12.5px; margin: 6px 0 0; }

/* ---------------- empty state ---------------- */
.empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px;
  padding: 34px 20px; color: var(--text-3);
}
.empty-ico {
  width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center;
  background: var(--surface-2); border: 1px solid var(--line); color: var(--text-2);
}
.empty b { color: var(--text-2); font-weight: 600; font-size: 13.5px; }
.empty p { margin: 0; font-size: 12.5px; max-width: 380px; }

/* ---------------- misc ---------------- */
.list { display: flex; flex-direction: column; }
.list-row {
  display: flex; gap: 12px; align-items: flex-start; padding: 14px 20px; border-bottom: 1px solid var(--line);
}
.list-row:last-child { border-bottom: none; }
.list-row:hover { background: rgba(255, 255, 255, .02); }
.list-body { min-width: 0; flex: 1; }
.list-title { font-size: 13.5px; font-weight: 550; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.list-text { color: var(--text-2); font-size: 13px; margin-top: 3px; white-space: pre-wrap; }
.list-meta { color: var(--text-3); font-size: 11.5px; margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap; }
.kv { display: flex; justify-content: space-between; gap: 14px; padding: 11px 20px; border-bottom: 1px solid var(--line); font-size: 13px; }
.kv:last-child { border-bottom: none; }
.kv span { color: var(--text-3); }
.kv b { font-weight: 550; }
details.user-group { border-bottom: 1px solid var(--line); }
details.user-group:last-child { border-bottom: none; }
details.user-group > summary {
  list-style: none; cursor: pointer; padding: 14px 20px; display: flex; align-items: center; gap: 12px;
}
details.user-group > summary::-webkit-details-marker { display: none; }
details.user-group > summary:hover { background: rgba(255, 255, 255, .02); }
details.user-group[open] > summary { background: rgba(255, 255, 255, .025); }
.chev { margin-left: auto; color: var(--text-3); transition: transform .18s; }
details[open] .chev { transform: rotate(180deg); }

.toast {
  position: fixed; right: 20px; bottom: 20px; z-index: 90; display: flex; align-items: center; gap: 10px;
  background: var(--surface-2); border: 1px solid var(--line-strong); border-left: 3px solid var(--ok);
  border-radius: 12px; padding: 12px 16px; font-size: 13.5px; max-width: 380px;
  box-shadow: 0 20px 50px -20px rgba(0, 0, 0, .9);
  transform: translateY(14px); opacity: 0; pointer-events: none; transition: all .22s ease;
}
.toast.show { transform: translateY(0); opacity: 1; }
.toast.bad { border-left-color: var(--danger); }

dialog.confirm {
  border: 1px solid var(--line-strong); border-radius: var(--r-lg); background: var(--surface);
  color: var(--text); padding: 0; max-width: 400px; width: calc(100% - 40px); box-shadow: var(--shadow);
}
dialog.confirm::backdrop { background: rgba(4, 6, 10, .68); backdrop-filter: blur(3px); }
.dialog-body { padding: 20px; }
.dialog-body h3 { font-size: 15px; margin-bottom: 6px; }
.dialog-body p { margin: 0; color: var(--text-2); font-size: 13.5px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--line); }

/* ---------------- login ---------------- */
.login-wrap {
  min-height: 100vh; display: grid; place-items: center; padding: 24px; position: relative; z-index: 1;
}
.login-card { width: 100%; max-width: 400px; }
.login-head { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 22px; text-align: center; }
.login-head .brand-mark { width: 46px; height: 46px; border-radius: 14px; }
.login-head h1 { font-size: 21px; }
.login-head p { margin: 0; color: var(--text-2); font-size: 13.5px; max-width: 320px; }
.login-form { padding: 22px; display: flex; flex-direction: column; gap: 14px; }
.alert {
  display: flex; gap: 9px; align-items: flex-start; font-size: 13px; border-radius: 10px; padding: 10px 12px;
  background: var(--danger-soft); border: 1px solid rgba(248, 113, 113, .3); color: #ffb4b4;
}
.login-foot { text-align: center; color: var(--text-3); font-size: 12px; margin-top: 16px; }
.pw-shell { position: relative; }
.pw-shell input { padding-right: 42px; }
.pw-toggle {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: transparent; border: 0; color: var(--text-3); padding: 6px; cursor: pointer; border-radius: 7px;
}
.pw-toggle:hover { color: var(--text); background: rgba(255, 255, 255, .05); }

/* ---------------- skeleton ---------------- */
.sk { background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 37%, var(--surface-2) 63%);
  background-size: 400% 100%; animation: sk 1.3s ease infinite; border-radius: 8px; height: 12px; }
@keyframes sk { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

/* ---------------- responsive ---------------- */
@media (max-width: 1080px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cols-2 { grid-template-columns: minmax(0, 1fr); }
  .search { display: none; }
}
@media (max-width: 860px) {
  .sidebar {
    position: fixed; inset: 0 auto 0 0; transform: translateX(-102%); transition: transform .22s ease;
    box-shadow: 0 0 60px rgba(0, 0, 0, .8); width: 268px;
  }
  .sidebar.open { transform: translateX(0); }
  .backdrop { position: fixed; inset: 0; background: rgba(4, 6, 10, .6); z-index: 35; display: none; }
  .backdrop.show { display: block; }
  .burger { display: inline-grid; }
  .topbar { padding: 10px 16px; gap: 10px; }
  .guild-manual { display: none; }
  .select-shell select { min-width: 0; max-width: 46vw; }
  .content { padding: 18px 16px 86px; }
  .page-head h1 { font-size: 22px; }
  .card-head, .chart { padding-left: 16px; padding-right: 16px; }
  th { padding: 10px 16px; }
  td { padding: 12px 16px; }
  .cols-2-even { grid-template-columns: minmax(0, 1fr); }
  .toast { left: 16px; right: 16px; max-width: none; bottom: 16px; }
}
@media (max-width: 520px) {
  .stats { grid-template-columns: minmax(0, 1fr); }
  .page-actions { width: 100%; }
  .page-actions .btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;
