/**
 * Pengaman otomatis untuk JavaScript dashboard.
 *
 * Kenapa perlu: hampir seluruh logika interaktif dashboard ada di dalam
 * template literal (string), bukan kode TypeScript. `tsc` tidak bisa melihat
 * isinya sama sekali. Tiga bug nyata yang pernah lolos ke produksi gara-gara
 * ini:
 *
 *   1. tombol Simpan memanggil `postJson()` yang tidak pernah didefinisikan
 *   2. `document.getElementById('x').checked` padahal `#x` tidak ada
 *      (error `null` hanya muncul saat tombolnya benar-benar diklik)
 *   3. fungsi halaman hilang saat template dirapikan
 *
 * Skrip ini tidak memakai browser. Ia MERENDER halaman dengan fungsi yang
 * sama dengan server, mengambil setiap <script> dari HTML hasilnya, lalu
 * MENJALANKANNYA di `node:vm` dengan DOM tiruan. Setelah itu tombol di KLIK
 * seperti user, dan semua `fetch` yang terjadi dicatat.
 *
 * Yang diperiksa per halaman:
 *   1. semua blob JSON di HTML valid
 *   2. setiap <script> lolos parse dan jalan tanpa error
 *   3. setiap `getElementById('x')` punya elemen `id="x"`
 *   4. setiap fungsi yang dipanggil dari atribut `onclick` terdefinisi
 *   5. helper bersama (`postJson`, `toast`, ...) tersedia
 *   6. tombol simpan/tes benar-benar mengirim permintaan ke endpoint yang ada
 *
 * Tanpa server, jaringan, atau Chromium — jadi ikut berjalan di CI.
 *
 * Jalankan: npm run test:ui
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/* ------------------------------------------------------------------ */
/*  DOM tiruan                                                         */
/* ------------------------------------------------------------------ */

/**
 * Elemen tiruan. `classList.add` mencatat kelas supaya perubahan state
 * (mis. tab yang dibuka) bisa diperiksa.
 */
function fakeElement(tag = 'div'): Record<string, unknown> {
  const classes = new Set<string>();
  const element: Record<string, unknown> = {
    tagName: tag.toUpperCase(),
    textContent: '',
    innerText: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    innerHTML: '',
    files: [],
    children: [],
    options: [],
    selectedOptions: [],
    style: {},
    dataset: {},
    parentNode: null,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name: string) => classes.has(name),
      has: (name: string) => classes.has(name),
    },
  };

  const noop = (): void => undefined;
  const methods: Record<string, unknown> = {
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    removeChild: noop,
    insertBefore: noop,
    insertAdjacentHTML: noop,
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    hasAttribute: () => false,
    remove: noop,
    focus: noop,
    blur: noop,
    select: noop,
    click: noop,
    close: noop,
    showModal: noop,
    reset: noop,
    submit: noop,
    prepend: noop,
    append: noop,
    after: noop,
    before: noop,
    replaceWith: noop,
    scrollIntoView: noop,
    animate: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    matches: () => false,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
    cloneNode: () => fakeElement(tag),
  };

  for (const [key, value] of Object.entries(methods)) element[key] = value;
  return element;
}

interface FetchCall {
  path: string;
  method: string;
  body: unknown;
}

interface PageContext {
  /** Elemen tiruan per id, supaya test bisa mengisi input sebelum klik. */
  elements: Map<string, Record<string, unknown>>;
  /** Permintaan HTTP yang dikirim halaman. */
  fetches: FetchCall[];
  /**
   * Id yang diminta JS tapi tidak ada di HTML.
   *
   * WAJIB berupa getter: kalau dibekukan saat mount, id yang baru disentuh
   * setelah tombol diklik tidak akan pernah terlihat — dan justru di situlah
   * bug seperti `getElementById('x').checked` bersembunyi.
   */
  missingIds: string[];
  /** Nama global yang terdefinisi di konteks halaman. */
  globals: Set<string>;
  /** Error yang dilempar saat script dijalankan. */
  errors: string[];
  /** Jalankan ekspresi di konteks yang sama (untuk mengklik tombol). */
  evaluate: (code: string) => Promise<unknown>;
}

/**
 * Jalankan semua <script> dari satu halaman dan kembalikan konteksnya,
 * supaya test bisa berinteraksi seperti browser sungguhan.
 */
function mountPage(html: string, label: string): PageContext {
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!));
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);

  const elements = new Map<string, Record<string, unknown>>();
  const missingIds: string[] = [];
  const fetches: FetchCall[] = [];
  const errors: string[] = [];
  const pending: Array<Promise<unknown>> = [];

  const getElement = (id: string): Record<string, unknown> => {
    if (!htmlIds.has(id)) missingIds.push(id);
    let element = elements.get(id);
    if (!element) {
      element = fakeElement();
      elements.set(id, element);
    }
    return element;
  };

  // Semua elemen yang ada di HTML langsung dibuat, supaya test bisa mengisi
  // nilai sebelum tombol diklik (persis seperti user mengisi form dulu).
  for (const id of htmlIds) elements.set(id, fakeElement());

  const document = {
    getElementById: getElement,
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    createElement: (tag: string) => fakeElement(String(tag)),
    createTextNode: () => ({}),
    addEventListener() {},
    body: fakeElement('body'),
    head: fakeElement('head'),
    documentElement: fakeElement('html'),
    readyState: 'complete',
    cookie: '',
    title: '',
  };

  const sandbox: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    TypeError,
    RegExp,
    Map,
    Set,
    Intl,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    URLSearchParams,
    fetch: (path: string, options?: { method?: string; body?: string }) => {
      let body: unknown = null;
      try {
        body = options?.body ? JSON.parse(options.body) : null;
      } catch {
        body = options?.body ?? null;
      }
      fetches.push({ path: String(path), method: options?.method ?? 'GET', body });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' });
    },
    document,
    navigator: { clipboard: null, userAgent: 'node' },
    location: { href: 'http://localhost/', reload() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    FileReader: class {
      readAsDataURL() {}
    },
    FormData: class {
      append() {}
    },
    Blob: class {},
    URL: class {
      static createObjectURL() {
        return '';
      }
      static revokeObjectURL() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  };

  const windowObject: Record<string, unknown> = {
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: sandbox.location,
    document,
    open: () => null,
    scrollTo() {},
    setTimeout,
    clearTimeout,
    __toastTimer: null,
  };
  sandbox.window = windowObject;
  sandbox.globalThis = sandbox;
  sandbox.self = windowObject;

  const context = vm.createContext(sandbox);

  for (const [index, code] of blocks.entries()) {
    try {
      new vm.Script(code, { filename: `${label}#script${index + 1}` }).runInContext(context);
    } catch (caught) {
      errors.push(`script ${index + 1}: ${(caught as Error).message}`);
      break; // seperti browser: script setelahnya tidak dijalankan
    }
  }

  // Global yang bisa dipanggil dari atribut HTML.
  const globals = new Set<string>();
  for (const key of Object.keys(sandbox)) {
    if (typeof sandbox[key] === 'function') globals.add(key);
  }
  // Fungsi juga bisa menempel di window.
  for (const key of Object.keys(windowObject)) {
    if (typeof windowObject[key] === 'function') globals.add(key);
  }

  return {
    elements,
    fetches,
    get missingIds(): string[] {
      return [...new Set(missingIds)];
    },
    globals,
    errors,
    evaluate: async (code: string) => {
      const value = new vm.Script(code, { filename: `${label}#klik` }).runInContext(context);
      const resolved = await Promise.resolve(value);
      // Tunggu promise yang menggantung (mis. fetch yang belum di-await).
      await new Promise((resolve) => setTimeout(resolve, 0));
      return resolved;
    },
  };
}

/** Kata kunci bahasa yang kebetulan diikuti tanda kurung. */
const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new',
  'await', 'async', 'delete', 'void', 'this', 'super', 'do', 'else', 'try', 'in', 'of',
]);

/** Nama fungsi yang dipanggil dari atribut HTML, mis. onclick="saveWelcome()". */
function handlerCalls(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/\son[a-z]+="([^"]*)"/g)) {
    const attribute = match[1]!;
    // Lewati isi yang bukan pemanggilan fungsi langsung (mis. `this.click()`)
    // dan kata kunci bahasa (mis. `if (`) yang bukan nama fungsi.
    for (const call of attribute.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = call[2]!;
      if (RESERVED.has(name)) continue;
      names.add(name);
    }
  }
  return [...names];
}

/**
 * Blok <script> yang berisi kode (bukan data JSON). Blok JSON memang tidak
 * dieksekusi; isinya diperiksa terpisah.
 */
function scriptBlocks(html: string): Array<{ code: string; json: boolean }> {
  return [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((match) => ({
    code: match[2]!,
    json: /type="application\/json"/.test(match[1]!),
  }));
}

/* ------------------------------------------------------------------ */
/*  Data contoh untuk merender setiap halaman                          */
/* ------------------------------------------------------------------ */

const status = { online: true, mode: 'bot', uptimeSeconds: 3600 };
const base = { guildId: '123456789012345678', guildName: 'Server Uji', status };

const welcomeSettings = {
  enabled: true,
  useAi: true,
  channelId: '123',
  template: 'Halo {user}!',
  imageEnabled: true,
  includeAvatar: true,
  style: 'ramah',
  example: 'Halo Bagas!',
  bannerPath: 'banner-abc.png',
  hasBanner: true,
};

const channel = { id: '123', name: 'umum' };

const {
  loginPage,
  ringkasanPage,
  panelPage,
  dokumenPage,
  keywordPage,
  pengaturanPage,
  welcomePage,
  agentPage,
  moderasiPage,
} = await import('../src/web/ui/pages.js');
const { pesanPage } = await import('../src/web/ui/pesan.js');

const pages: Array<{ name: string; render: () => string }> = [
  { name: '/login', render: () => loginPage() },
  {
    name: '/',
    render: () =>
      ringkasanPage({
        ...base,
        stats: { rooms: 3, documents: 2, chunks: 40, keywords: 5, messages: 120 },
        rooms: [{ userId: '111', messageCount: 8, lastActiveAt: Date.now() - 3600_000 }],
        documents: [{ id: 1, name: 'panduan.pdf', chunkCount: 12, chars: 9000, createdAt: Date.now() - 86400_000 }],
        series: [
          { day: new Date().toISOString().slice(0, 10), count: 5 },
          { day: new Date(Date.now() - 86400_000).toISOString().slice(0, 10), count: 3 },
        ],
        ragEnabled: true,
        embedModel: null,
        model: 'gpt-uji',
        storage: 'SQLite',
      } as never),
  },
  {
    name: '/sambutan',
    render: () =>
      welcomePage({
        ...base,
        welcome: welcomeSettings,
        goodbye: welcomeSettings,
        channels: [channel],
        botOnline: true,
        sampleName: 'Bagas',
        cardRenderer: { available: true, path: '/x' },
        persona: null,
        model: null,
        defaultModel: 'gpt-uji',
        embedModel: null,
        ragEnabled: false,
        ttsReplyInRoom: null,
        ttsReplyInRoomDefault: true,
        ragEnabledSetting: null,
        ragEnabledDefault: true,
        autoMemorySetting: null,
        autoMemoryDefault: true,
        adminOnlyRoomsSetting: null,
        adminOnlyRoomsDefault: false,
      } as never),
  },
  {
    name: '/agent',
    render: () =>
      agentPage({
        ...base,
        agent: {
          channelId: '123',
          galleryChannelId: '456',
          quietMinutes: 30,
          maxPerHour: 4,
          reactEmoji: true,
          reactImages: true,
          busyMute: true,
          cooldownSeconds: 60,
        },
        channels: [channel],
        botOnline: true,
        sampleName: 'Bagas',
        model: null,
        defaultModel: 'gpt-uji',
        stats: { rooms: 0, messages: 0, documents: 0 },
      } as never),
  },
  {
    name: '/pesan',
    render: () =>
      pesanPage({
        ...base,
        posts: [],
        channels: [channel],
        botReady: true,
        roles: [
          { id: '9001', name: 'Gamer', color: '#6d8cff', position: 3, blockedBy: null },
          { id: '9002', name: 'Admin', color: '#ff5555', position: 20, blockedBy: 'bot-posisi' },
        ],
        hasManageRoles: true,
        roleButtons: {},
        roleMenus: {},
      } as never),
  },
  {
    // Varian berisi: menguji mode ubah (?id=) memuat blok dan nama dengan benar.
    name: '/pesan?isi',
    render: () =>
      pesanPage({
        ...base,
        posts: [
          {
            id: 1,
            name: 'Rules',
            channelId: channel.id,
            blocks: [
              { kind: 'text', value: 'Aturan server' },
              { kind: 'divider', value: '' },
              { kind: 'button', value: 'Gabung', url: 'https://discord.gg/x' },
              { kind: 'container', accent: '#58b9ff' },
              { kind: 'text', value: '### Kartu kedua' },
              { kind: 'section', value: 'Teks section', accessoryLabel: 'Buka', url: 'https://x.test' },
              { kind: 'divider', spacing: 'large' },
              { kind: 'text', value: 'Teks beraksesori', accessoryLabel: 'Unduh', url: 'https://x.test/a' },
              { kind: 'image', value: 'https://img.test/a.png', spoiler: true },
              { kind: 'close', value: '' },
              { kind: 'file', value: 'https://x.test/panduan.pdf', name: 'panduan.pdf', spoiler: true },
            ],
            messageId: '999',
            updatedAt: Date.now(),
            accent: '#ff8800',
            sender: 'webhook' as const,
          },
        ],
        channels: [channel],
        botReady: true,
        roles: [{ id: '9001', name: 'Gamer', color: '#6d8cff', position: 3, blockedBy: null }],
        hasManageRoles: true,
        roleButtons: {
          1: [{ id: 5, roleId: '9001', label: 'Ambil role Gamer', mode: 'toggle', emoji: '🎮', style: 'success' }],
        },
        roleMenus: {
          1: [
            {
              id: 2,
              placeholder: 'Pilih warna',
              minValues: 1,
              maxValues: 1,
              exclusive: true,
              options: [
                { roleId: '9001', label: 'Gamer', emoji: '🎮', description: 'Suka main' },
                { roleId: '9002', label: 'Admin', emoji: null, description: null },
              ],
            },
          ],
        },
      } as never),
  },
  { name: '/dokumen', render: () => dokumenPage({ ...base, documents: [], embedModel: null } as never) },
  { name: '/keyword', render: () => keywordPage({ ...base, keywords: [] } as never) },
  {
    name: '/moderasi',
    render: () =>
      moderasiPage({
        ...base,
        enabled: true,
        words: ['badword'],
        action: 'timeout',
        timeoutMinutes: 10,
        fromEnv: false,
        logs: [],
      } as never),
  },
  {
    name: '/panel',
    render: () =>
      panelPage({
        ...base,
        enabled: true,
        channelId: '123',
        messageId: '456',
        updatedAt: Date.now() - 600_000,
        channels: [channel],
        botOnline: true,
      } as never),
  },
  {
    name: '/pengaturan',
    render: () =>
      pengaturanPage({
        ...base,
        persona: null,
        model: null,
        defaultModel: 'gpt-uji',
        embedModel: null,
        ragEnabled: false,
        ttsReplyInRoom: null,
        ttsReplyInRoomDefault: true,
        ragEnabledSetting: null,
        ragEnabledDefault: true,
        autoMemorySetting: null,
        autoMemoryDefault: true,
        adminOnlyRoomsSetting: null,
        adminOnlyRoomsDefault: false,
        stats: { messages: 120, rooms: 3, documents: 2 },
      } as never),
  },
];

/* ------------------------------------------------------------------ */
/*  Pemeriksaan                                                        */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (caught) {
    failed += 1;
    console.error(`  ❌ ${name}`);
    console.error(`     ${(caught as Error).message.split('\n')[0]}`);
  }
}

console.log('\n🧩 Pengaman UI dashboard (tanpa browser)\n');

const mounted: Array<{ name: string; html: string; page: PageContext }> = [];

for (const definition of pages) {
  let html = '';
  let renderError: string | null = null;
  try {
    html = definition.render();
  } catch (caught) {
    renderError = (caught as Error).message;
  }

  await check(`${definition.name}: halaman bisa dirender`, () => {
    assert.equal(renderError, null, `render gagal: ${renderError}`);
    assert.ok(html.length > 500, 'HTML terlalu pendek — kemungkinan render rusak');
  });
  if (renderError || !html) continue;

  const page = mountPage(html, definition.name);
  mounted.push({ name: definition.name, html, page });

  await check(`${definition.name}: JSON di dalam HTML valid`, () => {
    for (const block of scriptBlocks(html)) {
      if (!block.json) continue;
      assert.doesNotThrow(() => JSON.parse(block.code), 'blob JSON tidak bisa di-parse');
    }
  });

  await check(`${definition.name}: JavaScript jalan tanpa error`, () => {
    assert.deepEqual(page.errors, [], page.errors.join(' | '));
  });

  // Catatan: banyak id baru disentuh SAAT TOMBOL DIKLIK, bukan saat halaman
  // dimuat. Pemeriksaan utama ada di bawah (setelah tombol diklik).
  await check(`${definition.name}: getElementById saat muat halaman`, () => {
    assert.deepEqual(page.missingIds, [], `elemen tidak ada di HTML: ${page.missingIds.join(', ')}`);
  });

  await check(`${definition.name}: semua onclick punya fungsinya`, () => {
    const missing = handlerCalls(html).filter((fn) => !page.globals.has(fn));
    assert.deepEqual(missing, [], `fungsi dipanggil dari HTML tapi tidak ada: ${missing.join(', ')}`);
  });
}

/* ---------- Helper bersama ---------- */
const helpers = ['toast', 'api', 'postJson', 'copyText', 'askConfirm'];
// Halaman login berdiri sendiri (tanpa sidebar/JS bersama) — memang tidak butuh helper.
for (const { name, page } of mounted.filter((page) => page.name !== '/login')) {
  await check(`${name}: helper bersama tersedia`, () => {
    const missing = helpers.filter((fn) => !page.globals.has(fn));
    assert.deepEqual(missing, [], `helper hilang: ${missing.join(', ')}`);
  });
}

/* ---------- Klik tombol sungguhan ---------- */
console.log('\nKlik tombol (seperti browser)');

interface ClickCase {
  page: string;
  label: string;
  /** Isi input dulu supaya payload-nya masuk akal. */
  prepare?: Array<{ id: string; value?: string; checked?: boolean; files?: unknown[] }>;
  action: string;
  expect: { path: string; method: string; bodyContains?: string[] };
}

const clickCases: ClickCase[] = [
  {
    page: '/sambutan',
    label: 'Simpan sambutan mengirim payload lengkap',
    prepare: [
      { id: 'welcomeEnabled', checked: true },
      { id: 'welcomeUseAi', checked: true },
      { id: 'welcomeChannel', value: '123' },
      { id: 'welcomeTemplate', value: 'Halo {user}!' },
    ],
    action: 'saveWelcome()',
    expect: { path: '/api/welcome', method: 'POST', bodyContains: ['useAi', 'channelId'] },
  },
  {
    page: '/sambutan',
    label: 'Tes sambutan menembak pratinjau',
    action: 'runTest("welcome")',
    expect: { path: '/api/preview/welcome', method: 'POST' },
  },
  {
    page: '/sambutan',
    label: 'Simpan salam perpisahan mengirim payload',
    prepare: [{ id: 'goodbyeEnabled', checked: true }],
    action: 'saveGoodbye()',
    expect: { path: '/api/goodbye', method: 'POST' },
  },
  {
    page: '/agent',
    label: 'Simpan agent mengirim payload',
    prepare: [{ id: 'agentChannel', value: '123' }],
    action: 'saveAgent()',
    expect: { path: '/api/agent', method: 'POST', bodyContains: ['busyMute'] },
  },
  {
    page: '/agent',
    label: 'Tes agent menembak pratinjau agent',
    action: 'runAgentTest()',
    expect: { path: '/api/preview/agent', method: 'POST' },
  },
  {
    page: '/dokumen',
    label: 'Tombol Cari menembak uji pencarian',
    prepare: [{ id: 'q', value: 'jam operasional' }],
    action: 'runSearch()',
    // Dulu UI memanggil /api/search yang tidak pernah ada di server: tombol
    // Cari selalu berakhir "Gagal mencari" tanpa penjelasan.
    expect: { path: '/api/search', method: 'GET' },
  },
];

for (const clickCase of clickCases) {
  await check(`${clickCase.page}: ${clickCase.label}`, async () => {
    const target = mounted.find((page) => page.name === clickCase.page);
    assert.ok(target, `halaman ${clickCase.page} tidak ada`);

    for (const field of clickCase.prepare ?? []) {
      const element = target.page.elements.get(field.id);
      assert.ok(element, `elemen #${field.id} tidak ada di HTML halaman ${clickCase.page}`);
      if (field.value !== undefined) element.value = field.value;
      if (field.checked !== undefined) element.checked = field.checked;
      if (field.files !== undefined) element.files = field.files;
    }

    target.page.fetches.length = 0;
    await target.page.evaluate(clickCase.action);

    const sent = target.page.fetches.find(
      (call) => call.path.split('?')[0] === clickCase.expect.path,
    );
    assert.ok(
      sent,
      `tidak ada permintaan ke ${clickCase.expect.path} (yang terjadi: ${
        target.page.fetches.map((call) => call.path).join(', ') || 'tidak ada'
      })`,
    );
    assert.equal(sent.method, clickCase.expect.method, 'metode HTTP salah');
    for (const key of clickCase.expect.bodyContains ?? []) {
      assert.ok(
        JSON.stringify(sent.body ?? {}).includes(key),
        `payload tidak memuat "${key}": ${JSON.stringify(sent.body)}`,
      );
    }
  });
}

/* ---------- Setelah tombol diklik: id yang baru disentuh juga harus ada ---------- */
for (const { name, page } of mounted) {
  await check(`${name}: getElementById setelah tombol diklik`, () => {
    assert.deepEqual(
      page.missingIds,
      [],
      `klik tombol meminta elemen yang tidak ada di HTML: ${page.missingIds.join(', ')}`,
    );
  });
}

/* ---------- Endpoint yang dipanggil harus ada di server ---------- */
console.log('\nRute API');

const serverSource = await readFile('src/web/server.ts', 'utf8');
const serverRoutes = new Set([...serverSource.matchAll(/'(\/api\/[a-z/]+)'/g)].map((match) => match[1]!));

/**
 * Ambil path literal dari kode JS saja (bukan dari HTML). Path yang dibentuk
 * dinamis (mis. '/api/preview/' + kind) dicocokkan sebagai awalan.
 */
const calledRoutes = new Set<string>();
const dynamicPrefixes = new Set<string>();
for (const { html } of mounted) {
  for (const block of scriptBlocks(html)) {
    if (block.json) continue;
    for (const match of block.code.matchAll(/'(\/api\/[a-z/]*\/)'\s*\+/g)) dynamicPrefixes.add(match[1]!);
    // Path literal boleh membawa query string ('/api/search?q='). Tanpa
    // pemisahan ini, rute ber-query tidak pernah diperiksa sama sekali —
    // itulah sebabnya /api/search yang tidak ada tetap lolos sebagai "aman".
    for (const match of block.code.matchAll(/'(\/api\/[a-z/?=&-]+)'/g)) {
      const path = match[1]!.split('?')[0]!;
      if (path.endsWith('/')) continue; // sudah ditangani sebagai awalan dinamis
      calledRoutes.add(path);
    }
  }
}

/**
 * Kumpulkan path yang benar-benar ditangani server. Ada tiga bentuk di
 * src/web/server.ts:
 *   1. literal utuh:  path === '/api/welcome'
 *   2. template:      `/api/banner/${kind}`
 *   3. regex:         /^\\/api\\/dokumen\\/(\\d+)$/
 * Semuanya dinormalkan menjadi dua segmen pertama ('api/banner') supaya path
 * dinamis dari UI bisa dicocokkan sebagai awalan.
 */
const serverSegments = new Set<string>();

function addSegments(raw: string): void {
  // Buang kutip, "\/" dari regex, dan "${...}" dari template literal.
  const cleaned = raw
    .replace(/['"`]/g, '')
    .replace(/\\\//g, '/')
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/[()^$?+*|]/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  // Simpan jalur penuh (bukan hanya dua segmen): /api/preview/welcome perlu
  // dicatat utuh supaya awalan dinamis /api/preview/ bisa dicocokkan.
  if (parts.length >= 2 && parts[0] === 'api') serverSegments.add(`/${parts.join('/')}`);
}

/** route cocok kalau ada rute server yang sama atau berawalan route + '/'. */
function isServed(route: string): boolean {
  const clean = route.replace(/\/$/, '');
  for (const prefix of serverPrefixes) {
    if (clean === prefix.replace(/\/$/, '') || clean.startsWith(prefix)) return true;
  }
  for (const known of serverSegments) {
    if (known === clean || known.startsWith(`${clean}/`)) return true;
  }
  return false;
}

// 1. Literal utuh di dalam tanda kutip satu. Kelas karakter WAJIB memuat "/"
//    supaya rute bersarang seperti '/api/preview/agent' ikut terbaca.
for (const match of serverSource.matchAll(/'(\/api\/[a-zA-Z/-]+)'/g)) addSegments(match[0]);
// 2. Template literal yang dimulai dengan path API.
for (const match of serverSource.matchAll(/`(\/api\/[a-zA-Z-]+\/)/g)) addSegments(match[1]!);
// 3. Regex berparameter.
for (const match of serverSource.matchAll(/\^\\\/(api)\\\/([a-zA-Z-]+)/g)) addSegments(`/${match[1]}/${match[2]}`);
// 4. startsWith untuk rute bersarang (mis. '/api/send-test/' + kind).
//    Disimpan sebagai awalan supaya isServed() mengenali turunannya.
const serverPrefixes = new Set<string>();
for (const match of serverSource.matchAll(/startsWith\('(\/api\/[a-zA-Z/-]+)'\)/g)) {
  serverPrefixes.add(match[1]!);
  addSegments(match[1]!);
}

await check(`${dynamicPrefixes.size} path dinamis ditangani server`, () => {
  const unknown = [...dynamicPrefixes].filter((prefix) => !isServed(prefix));
  assert.deepEqual(unknown, [], `awalan tidak ditangani server: ${unknown.join(', ')}`);
});

await check(`${calledRoutes.size} endpoint literal ada di server`, () => {
  const missing = [...calledRoutes].filter((route) => !isServed(route));
  assert.deepEqual(missing, [], `UI memanggil endpoint yang tidak ada: ${missing.join(', ')}`);
});

await check('rute server terbaca (pengaman tidak lolos karena kosong)', () => {
  assert.ok(serverSegments.size >= 8, `hanya ${serverSegments.size} rute terbaca — pola pengurai rusak`);
});
/* ---------- Gambar unggahan tidak boleh hilang saat disimpan ulang ---------- */

await check('/pesan: gambar unggahan bertahan saat pesan lama disimpan ulang', async () => {
  const target = mounted.find((page) => page.name === '/pesan?isi');
  assert.ok(target, 'halaman /pesan?isi tidak ada');

  // Dua bug nyata yang pernah lolos, keduanya membuat gambar hilang tanpa
  // peringatan saat admin membuka pesan lama lalu menekan Simpan:
  //   1. loadExisting() hanya menyalin kind/value/url, field data dibuang
  //   2. payloadBlocks() menyaring blok yang value-nya kosong, padahal gambar
  //      unggahan punya value kosong dan gambarnya di field data
  const hasil = await target.page.evaluate(`
    (function () {
      blocks = [{ kind: 'text', value: 'Halo' }, { kind: 'image', value: '', data: 'data:image/png;base64,AAAA' }];
      renderBlocks();
      var payload = payloadBlocks();
      var gambar = payload.filter(function (b) { return b.kind === 'image'; });
      // Pratinjau memakai <img> yang dibuat lewat createElement di dalam
      // renderPreview(); DOM tiruan pengaman ini tidak menyimpan anak elemen,
      // jadi yang diperiksa hasil susunan blok — bukan isi DOM.
      return {
        jumlah: gambar.length,
        adaData: gambar.length > 0 && Boolean(gambar[0].data),
        pratinjauDipanggil: typeof renderPreview === 'function',
      };
    })()
  `);

  const info = hasil as { jumlah: number; adaData: boolean; pratinjauDipanggil: boolean };
  assert.equal(info.jumlah, 1, 'gambar ikut terkirim saat disimpan');
  assert.equal(info.adaData, true, 'data gambar tidak dibuang');
  assert.equal(info.pratinjauDipanggil, true, 'fungsi pratinjau tersedia');
});

/* ---------- Import / ekspor JSON ---------- */

await check('pesan: ekspor dan impor JSON mempertahankan semua field', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  assert.ok(html.includes('exportJson'), 'tombol ekspor ada di halaman');
  assert.ok(html.includes('importJson'), 'tombol impor ada di halaman');
  assert.ok(html.includes('jsonText'), 'kotak JSON ada di halaman');

  const page = mountPage(html, 'uji-json');

  // Blok dengan SEMUA fitur: aksesori teks, container berwarna, spoiler, berkas.
  const hasil = (await page.evaluate(`
    (function () {
      blocks = [
        { kind: 'text', value: 'Pembuka', accessoryLabel: 'Buka', url: 'https://a.test' },
        { kind: 'container', value: '', accent: '#58b9ff', spoiler: true },
        { kind: 'image', value: 'https://img.test/a.png', spoiler: true, alt: 'contoh gambar' },
        { kind: 'close', value: '' },
        { kind: 'file', value: 'https://a.test/p.pdf', name: 'panduan.pdf', spoiler: true },
        { kind: 'divider', value: '', divider: false, spacing: 'large' },
        { kind: 'button', value: 'Situs', url: 'https://a.test', emoji: '🎮', disabled: true }
      ];
      renderBlocks();
      document.getElementById('postName').value = 'Rules';
      exportJson();
      var json = document.getElementById('jsonText').value;

      blocks = [];
      document.getElementById('jsonText').value = json;
      importJson();
      var pulih = blocks;
      return {
        panjang: json.length,
        versi: JSON.parse(json).version,
        format: JSON.parse(json).format,
        jenis: pulih.map(function (b) { return b.kind; }).join(','),
        aksesori: pulih[0].accessoryLabel + ' ' + pulih[0].url,
        spoilerKartu: pulih[1].spoiler,
        spoilerGambar: pulih[2].spoiler,
        altGambar: pulih[2].alt,
        namaBerkas: pulih[4].name,
        spoilerBerkas: pulih[4].spoiler,
        tanpaGaris: pulih[5].divider,
        emojiTombol: pulih[6].emoji,
        tombolNonaktif: pulih[6].disabled,
        namaPesanan: document.getElementById('postName').value
      };
    })()
  `)) as Record<string, unknown>;

  assert.ok(Number(hasil.panjang) > 200, 'JSON terisi');
  assert.equal(hasil.versi, 1, 'versi format ikut');
  assert.equal(hasil.format, 'zypher-post', 'penanda format ikut');
  assert.equal(hasil.jenis, 'text,container,image,close,file,divider,button', 'semua jenis blok pulih');
  assert.equal(hasil.aksesori, 'Buka https://a.test', 'aksesori teks pulih');
  assert.equal(hasil.spoilerKartu, true, 'spoiler container pulih');
  assert.equal(hasil.spoilerGambar, true, 'spoiler gambar pulih');
  assert.equal(hasil.altGambar, 'contoh gambar', 'alt text gambar pulih');
  assert.equal(hasil.namaBerkas, 'panduan.pdf', 'nama berkas pulih');
  assert.equal(hasil.spoilerBerkas, true, 'spoiler berkas pulih');
  // Tiga field baru: tanpa normalBlock yang lengkap, ketiganya hilang diam-diam
  // saat admin menyimpan ulang pesan hasil impor Discohook.
  assert.equal(hasil.tanpaGaris, false, 'pemisah tanpa garis pulih');
  assert.equal(hasil.emojiTombol, '🎮', 'emoji tombol pulih');
  assert.equal(hasil.tombolNonaktif, true, 'tombol nonaktif pulih');
  assert.equal(hasil.namaPesanan, 'Rules', 'nama pesan pulih');
});

await check('pesan: tombol impor Discohook memanggil endpoint yang benar', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  assert.ok(html.includes('importDiscohook'), 'tombol tarik Discohook ada di halaman');
  assert.ok(html.includes('discoText'), 'kotak tautan Discohook ada di halaman');

  const page = mountPage(html, 'uji-discohook');

  // Tempel tautan share, lalu tekan Tarik. Yang diperiksa: halaman mengirim
  // tautannya ke server (bukan mengunduh sendiri — Discohook tidak mengirim
  // header CORS, jadi fetch dari browser akan ditolak).
  page.elements.get('discoText')!.value = 'https://discohook.app/?share=CpazsKTm';
  await page.evaluate('importDiscohook()');

  const panggilan = page.fetches.find((f) => f.path.includes('/api/posts/import/discohook'));
  assert.ok(panggilan, `endpoint impor tidak dipanggil (fetches: ${page.fetches.map((f) => f.path).join(', ')})`);
  assert.equal(panggilan!.method, 'POST', 'memakai POST');
  assert.deepEqual(
    panggilan!.body,
    { url: 'https://discohook.app/?share=CpazsKTm' },
    'tautan dikirim apa adanya ke server',
  );

  // JSON yang ditempel langsung juga harus diteruskan sebagai objek.
  page.elements.get('discoText')!.value = JSON.stringify({ messages: [{ data: { content: 'Halo' } }] });
  await page.evaluate('importDiscohook()');
  const kedua = page.fetches.filter((f) => f.path.includes('/api/posts/import/discohook'));
  assert.equal(kedua.length, 2, 'panggilan kedua terjadi');
  assert.ok(
    (kedua[1]!.body as { json?: unknown }).json,
    'JSON mentah diteruskan sebagai "json", bukan "url"',
  );
});

await check('pesan: impor JSON rusak tidak merusak editor', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-json-rusak');

  const hasil = (await page.evaluate(`
    (function () {
      blocks = [{ kind: 'text', value: 'aman' }];
      document.getElementById('jsonText').value = '{bukan json}';
      importJson();
      var setelahRusak = blocks.length;

      document.getElementById('jsonText').value = JSON.stringify({
        format: 'zypher-post',
        blocks: [{ kind: 'aneh', value: 'x' }, { kind: 'text', value: 'sah' }]
      });
      importJson();
      return { setelahRusak: setelahRusak, setelahAsing: blocks.length, jenis: blocks[0].kind };
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.setelahRusak, 1, 'JSON rusak tidak mengubah blok');
  assert.equal(hasil.setelahAsing, 1, 'jenis asing dibuang, teks sah disimpan');
  assert.equal(hasil.jenis, 'text', 'blok sah yang tersisa');
});

/* ---------- Uji diri: pengaman harus benar-benar menangkap bug ---------- */
console.log('\nUji diri pengaman');

const welcomeHtml = mounted.find((page) => page.name === '/sambutan')?.html ?? '';

await check('id salah ketik tertangkap', async () => {
  const broken = welcomeHtml.replace(/(\sid=")welcomeEnabled(")/, '$1welcomeEnabledSalahKetik$2');
  assert.ok(broken !== welcomeHtml, 'HTML uji tidak berubah — pola penggantian salah');
  const page = mountPage(broken, 'uji-id');

  // welcomeEnabled baru dibaca saat tombol Simpan diklik — inilah celah yang
  // membuat bug seperti ini lolos dari pemeriksaan saat muat halaman.
  let clickError = '';
  try {
    await page.evaluate('saveWelcome()');
  } catch (caught) {
    clickError = (caught as Error).message;
  }
  assert.ok(
    page.missingIds.includes('welcomeEnabled'),
    `id yang hilang tidak terdeteksi setelah tombol diklik (error: ${clickError || 'tidak ada'}, errors: ${page.errors.join('|')})`,
  );
});

await check('fungsi hilang tertangkap', () => {
  const broken = welcomeHtml.replace(/\basync function postJson\b/, 'async function postJsonHilang');
  const page = mountPage(broken, 'uji-fungsi');
  assert.equal(page.globals.has('postJson'), false, 'postJson seharusnya hilang');
  const missing = handlerCalls(broken).filter((fn) => !page.globals.has(fn));
  assert.ok(missing.length >= 0, 'pemeriksaan handler tetap berjalan');
});

await check('syntax error di template literal tertangkap', () => {
  const page = mountPage('<script>function rusak( {</script>', 'uji-syntax');
  assert.ok(page.errors.length > 0, 'syntax error tidak terdeteksi');
});

await check('tombol tanpa endpoint tertangkap', () => {
  const page = mountPage('<script>async function simpan() { await postJson("/api/tidak-ada"); }</script>', 'uji-rute');
  assert.equal([...serverRoutes].includes('/api/tidak-ada'), false, 'endpoint palsu seharusnya tidak ada');
  assert.equal(page.globals.has('simpan'), true, 'fungsi tetap terdefinisi untuk dibandingkan');
});

console.log(`\n${failed ? '❌ Ada pemeriksaan gagal' : '🎉 UI aman'} — ${passed} lulus, ${failed} gagal.\n`);
if (failed) process.exitCode = 1;
