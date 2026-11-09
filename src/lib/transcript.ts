export interface TranscriptMessage {
  authorName: string;
  authorAvatarUrl: string | null;
  isBot: boolean;
  content: string;
  createdAt: Date;
  attachments: Array<{ name: string; url: string }>;
}

export interface TranscriptInput {
  guildName: string;
  guildIconUrl: string | null;
  userName: string;
  userTag: string;
  channelName: string;
  startedAt: Date;
  endedAt: Date;
  messages: TranscriptMessage[];
  memoryLines: string[];
  summary?: string | null;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDateTime = (date: Date): string =>
  new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date);

const formatTime = (date: Date): string =>
  new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(date);

/** Ubah teks Discord sederhana jadi HTML yang aman (tanpa mengizinkan HTML mentah). */
function renderContent(raw: string): string {
  let text = escapeHtml(raw);

  // Blok kode ```...```
  text = text.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_match, code: string) => `<pre><code>${code.trim()}</code></pre>`);
  // Kode inline `...`
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Tebal **...**
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Miring *...* dan _..._
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
  // Baris kutipan "> "
  text = text.replace(/^&gt;\s?(.*)$/gm, '<span class="quote">$1</span>');
  // Baris baru
  text = text.replace(/\n/g, '<br>');

  return text;
}

function renderMessage(message: TranscriptMessage): string {
  const avatar = message.authorAvatarUrl
    ? `<img class="avatar" src="${escapeHtml(message.authorAvatarUrl)}" alt="">`
    : '<div class="avatar avatar-fallback"></div>';

  const attachments = message.attachments.length
    ? `<div class="attachments">${message.attachments
        .map(
          (attachment) =>
            `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(attachment.name)}</a>`,
        )
        .join('')}</div>`
    : '';

  return `
    <article class="message ${message.isBot ? 'bot' : 'user'}">
      ${avatar}
      <div class="body">
        <header>
          <span class="name">${escapeHtml(message.authorName)}</span>
          ${message.isBot ? '<span class="badge">AI</span>' : ''}
          <time>${formatTime(message.createdAt)}</time>
        </header>
        <div class="content">${renderContent(message.content) || '<em class="empty">(tanpa teks)</em>'}</div>
        ${attachments}
      </div>
    </article>`;
}

/** Rakit transkrip HTML mandiri (tanpa aset eksternal) siap diunduh. */
export function buildTranscriptHtml(input: TranscriptInput): string {
  const memoryList = input.memoryLines.length
    ? `<ul>${input.memoryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : '<p class="muted">Tidak ada memori tersimpan.</p>';

  const summaryBlock = input.summary
    ? `<section class="card"><h2>Ringkasan Sesi</h2><p>${escapeHtml(input.summary).replace(/\n/g, '<br>')}</p></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transkrip — ${escapeHtml(input.userName)} — ${formatDateTime(input.endedAt)}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0d13;
    --card: #151925;
    --card-2: #1b2130;
    --text: #e7ecf5;
    --muted: #93a0b8;
    --accent: #6d8cff;
    --accent-2: #38d9a9;
    --border: #242c3d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 16px 64px;
    background: radial-gradient(1200px 600px at 10% -10%, #1a2440 0%, var(--bg) 55%);
    color: var(--text);
    font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.55;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  .hero {
    background: linear-gradient(135deg, rgba(109,140,255,.18), rgba(56,217,169,.10));
    border: 1px solid var(--border); border-radius: 18px; padding: 24px; margin-bottom: 20px;
  }
  .hero-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .hero img { width: 56px; height: 56px; border-radius: 50%; border: 2px solid var(--border); }
  .hero h1 { font-size: 20px; margin: 0; }
  .hero p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
  .stats { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
  .stat {
    background: rgba(255,255,255,.04); border: 1px solid var(--border);
    border-radius: 12px; padding: 10px 14px; min-width: 130px;
  }
  .stat span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .stat strong { font-size: 15px; font-weight: 600; }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    padding: 20px 22px; margin-bottom: 20px;
  }
  .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 12px; }
  .card ul { margin: 0; padding-left: 20px; }
  .card li { margin-bottom: 6px; }
  .muted { color: var(--muted); }
  .log { display: flex; flex-direction: column; gap: 4px; }
  .message { display: flex; gap: 12px; padding: 12px 14px; border-radius: 12px; }
  .message:hover { background: rgba(255,255,255,.02); }
  .message.bot { background: rgba(109,140,255,.06); border: 1px solid rgba(109,140,255,.16); }
  .avatar { width: 38px; height: 38px; border-radius: 50%; flex: 0 0 38px; object-fit: cover; }
  .avatar-fallback { background: var(--card-2); }
  .body { min-width: 0; flex: 1; }
  .body header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .name { font-weight: 600; font-size: 14px; }
  .bot .name { color: var(--accent); }
  .badge {
    font-size: 10px; font-weight: 700; letter-spacing: .08em;
    background: rgba(56,217,169,.16); color: var(--accent-2);
    padding: 2px 6px; border-radius: 999px;
  }
  time { color: var(--muted); font-size: 11px; margin-left: auto; }
  .content { font-size: 14.5px; margin-top: 4px; overflow-wrap: anywhere; }
  .content pre {
    background: #0a0c12; border: 1px solid var(--border); border-radius: 10px;
    padding: 12px; overflow-x: auto; font-size: 13px;
  }
  .content code { background: rgba(255,255,255,.06); padding: 1px 5px; border-radius: 5px; font-size: 13px; }
  .content pre code { background: none; padding: 0; }
  .quote { display: block; border-left: 3px solid var(--accent); padding-left: 10px; color: var(--muted); }
  .empty { color: var(--muted); }
  .attachments { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; font-size: 13px; }
  .attachments a { color: var(--accent); text-decoration: none; }
  footer { text-align: center; color: var(--muted); font-size: 12px; margin-top: 28px; }
</style>
</head>
<body>
<div class="wrap">
  <section class="hero">
    <div class="hero-top">
      ${input.guildIconUrl ? `<img src="${escapeHtml(input.guildIconUrl)}" alt="">` : ''}
      <div>
        <h1>Transkrip Sesi AI</h1>
        <p>${escapeHtml(input.guildName)} • #${escapeHtml(input.channelName)}</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><span>Member</span><strong>${escapeHtml(input.userName)}</strong></div>
      <div class="stat"><span>Pesan</span><strong>${input.messages.length}</strong></div>
      <div class="stat"><span>Mulai</span><strong>${formatDateTime(input.startedAt)}</strong></div>
      <div class="stat"><span>Selesai</span><strong>${formatDateTime(input.endedAt)}</strong></div>
    </div>
  </section>

  ${summaryBlock}

  <section class="card">
    <h2>Memori Jangka Panjang</h2>
    ${memoryList}
  </section>

  <section class="card">
    <h2>Percakapan</h2>
    <div class="log">
      ${input.messages.map(renderMessage).join('\n') || '<p class="muted">Belum ada pesan.</p>'}
    </div>
  </section>

  <footer>Dibuat otomatis oleh Zypher AI Bot • ${formatDateTime(input.endedAt)} WIB</footer>
</div>
</body>
</html>`;
}

export function transcriptFileName(userName: string, endedAt: Date): string {
  const safeName = userName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member';
  const stamp = endedAt.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `transkrip-${safeName}-${stamp}.html`;
}
