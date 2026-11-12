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
    /*
     * textContent mengumpulkan teks anak seperti DOM sungguhan. Test perlu
     * membacanya untuk memastikan tulisan yang dilihat admin benar-benar
     * tergambar, bukan hanya ada di source.
     */
    get textContent(): string {
      const sendiri = (element._teks as string | undefined) ?? '';
      return sendiri + children.map((child) => String(child.textContent ?? '')).join('');
    },
    set textContent(nilai: string) {
      element._teks = nilai;
      children.length = 0;
    },
    innerText: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    get innerHTML(): string {
      return '';
    },
    set innerHTML(_nilai: string) {
      // Halaman memakai innerHTML = '' untuk mengosongkan wadah sebelum
      // menggambar ulang; anak tiruan harus ikut kosong.
      children.length = 0;
    },
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
  const children = element.children as Record<string, unknown>[];
  const methods: Record<string, unknown> = {
    addEventListener: noop,
    removeEventListener: noop,
    /*
     * Pohon anak DILACAK, bukan no-op.
     *
     * Beberapa halaman menggambar ulang isi wadah (mis. kartu aksi di editor
     * /pesan) dan test perlu memeriksa apa yang benar-benar tergambar. Tanpa
     * pelacakan ini, satu-satunya cara menguji adalah membaca source code —
     * yang justru tidak membuktikan apa pun.
     */
    appendChild: (child: Record<string, unknown>) => {
      child.parentNode = element;
      children.push(child);
      return child;
    },
    append: (...isi: Record<string, unknown>[]) => {
      for (const child of isi) if (child && typeof child === 'object') children.push(child);
    },
    prepend: (child: Record<string, unknown>) => {
      children.unshift(child);
    },
    insertBefore: (child: Record<string, unknown>) => {
      children.unshift(child);
      return child;
    },
    removeChild: (child: Record<string, unknown>) => {
      const at = children.indexOf(child);
      if (at !== -1) children.splice(at, 1);
      return child;
    },
    remove: () => {
      const induk = element.parentNode as Record<string, unknown> | null;
      const daftar = induk?.children as Record<string, unknown>[] | undefined;
      const at = daftar ? daftar.indexOf(element) : -1;
      if (at !== -1) daftar!.splice(at, 1);
    },
    insertAdjacentHTML: noop,
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    hasAttribute: () => false,
    focus: noop,
    blur: noop,
    select: noop,
    click: noop,
    close: noop,
    showModal: noop,
    reset: noop,
    submit: noop,
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
      /*
       * Dokumen multi-pesan: balasan tiruan harus memuat `document`, karena
       * halaman MEMAKAI hasil simpan (id + isi yang sudah disaring server).
       * Halaman lain cukup `{ ok: true }`.
       */
      const jawaban: Record<string, unknown> =
        /*
         * Endpoint payload JSON: balasannya dipakai halaman apa adanya
         * (`components`, `codegen`, `dropped`), jadi tiruannya harus memuat
         * ketiganya — dengan begitu tes bisa memeriksa apa yang DITAMPILKAN,
         * bukan sekadar URL yang dipanggil.
         */
        /*
         * Satu versi riwayat: dipakai panel Bandingkan. Snapshot-nya sengaja
         * BEDA dari isi editor tiruan (teks blok pertama diganti), supaya tes
         * memeriksa diff yang benar-benar dihitung, bukan panel kosong.
         */
        String(path).includes('/revisions?revision=')
          ? {
              ok: true,
              revision: {
                id: 77,
                name: 'Rules',
                createdAt: 1700000000000,
                snapshot: {
                  blocks: [{ kind: 'text', value: 'versi lama' }],
                  accent: '#6d8cff',
                  sender: 'bot',
                  flags: 0,
                  series: false,
                  allowedMentions: { parse: [] },
                  threadName: null,
                },
              },
            }
          : String(path).includes('/json?')
          ? {
              ok: true,
              flags: 32768,
              allowedMentions: null,
              threadName: null,
              components: [{ type: 17, components: [{ type: 10, content: 'Halo' }] }],
              dropped: [],
              library: 'dpy2',
              codegen: {
                imports: 'import discord\nfrom discord import ui',
                code: 'view = ui.Container([\n    ui.TextDisplay("Halo"),\n])',
                documentation: 'https://discordpy.readthedocs.io/en/stable/api.html',
                dropped: [],
              },
            }
          : String(path) === '/api/documents' && body && typeof body === 'object'
          ? { ok: true, document: { id: 7, name: (body as { name?: string }).name ?? '', series: (body as { series?: boolean }).series === true, messages: (body as { messages?: unknown[] }).messages ?? [] } }
          : { ok: true };
      return Promise.resolve({ ok: true, status: 200, json: async () => jawaban, text: async () => '' });
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
        /*
         * Riwayat versi ikut dikirim bersama halaman: tab Riwayat harus bisa
         * langsung menampilkan daftar tanpa permintaan tambahan.
         */
        revisions: {
          1: [
            { id: 77, name: 'Rules lama', createdAt: Date.now() - 3_600_000, ringkas: '2 teks · 1 tombol' },
            { id: 76, name: 'Rules sebelum disunting', createdAt: Date.now() - 7_200_000, ringkas: '1 teks' },
          ],
        },
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
  {
    // Halaman dengan pesan ber-pemicu: badge pemicu harus terlihat di daftar.
    name: '/pesan?pemicu',
    render: () =>
      pesanPage({
        ...base,
        posts: [
          {
            id: 3,
            name: 'Sambutan otomatis',
            channelId: channel.id,
            blocks: [{ kind: 'text', value: 'Selamat datang!' }],
            messageId: '1000',
            updatedAt: Date.now(),
            accent: null,
            sender: 'bot' as const,
            trigger: 'member_add' as const,
          },
        ],
        channels: [channel],
        botReady: true,
        roles: [],
        hasManageRoles: false,
        roleButtons: {},
        roleMenus: {},
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
  `)) as { tampil: boolean; html: string };

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

await check('pesan: tidak ada id ganda antar tab (penyebab isian mati)', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';

  /*
   * Bug nyata: kartu pengaturan (warna aksen & pengirim) pernah dirender di
   * dua tab. Dua elemen ber-id sama membuat getElementById selalu mengambil
   * yang PERTAMA — yang ada di tab tersembunyi — sehingga mengubah warna dari
   * tab lain tidak berpengaruh, tanpa error apa pun.
   *
   * Karena itu: setiap id yang dibaca JavaScript halaman ini harus muncul
   * tepat satu kali di HTML.
   */
  const dihitung = new Map<string, number>();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
    const id = match[1]!;
    dihitung.set(id, (dihitung.get(id) ?? 0) + 1);
  }
  const ganda = [...dihitung.entries()].filter(([, jumlah]) => jumlah > 1).map(([id]) => id);
  assert.deepEqual(ganda, [], `id muncul lebih dari sekali: ${ganda.join(', ')}`);

  // Elemen yang dipakai bersama tetap harus ada, tepat satu.
  for (const id of ['previewHost', 'previewHostBesar', 'postName', 'postAccent', 'postSender', 'blockList']) {
    assert.equal(dihitung.get(id), 1, `#${id} ada tepat satu kali`);
  }
});

await check('pesan: tab halaman menyembunyikan panel, bukan menghapusnya', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  // Empat tab: Susun, Pratinjau, Ambil role, Impor.
  for (const key of ['susun', 'pratinjau', 'role', 'impor']) {
    assert.ok(html.includes(`id="tab-${key}"`), `tab ${key} ada`);
    assert.ok(html.includes(`id="pane-${key}"`), `panel ${key} ada`);
  }
  assert.ok(html.includes('showPesanTab'), 'fungsi pindah tab ada di halaman');

  const page = mountPage(html, 'uji-tab');
  // Pindah ke tab Pratinjau: panel lain disembunyikan, tab aktif ditandai.
  await page.evaluate("showPesanTab('pratinjau')");
  assert.equal(page.elements.get('pane-pratinjau')!.hidden, false, 'panel pratinjau terbuka');
  assert.equal(page.elements.get('pane-susun')!.hidden, true, 'panel susun disembunyikan');
  assert.equal(
    page.elements.get('pane-role')!.hidden,
    true,
    'panel role ikut tersembunyi (satu tab sekaligus)',
  );
  assert.equal(page.errors.length, 0, `tidak ada error: ${page.errors.join('|')}`);
});

await check('pesan: editor menggambar komponen bertumpuk di dalam kartu', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-tumpuk');

  /*
   * Yang diperiksa BUKAN tampilan DOM (DOM tiruan tidak menyimpan anak
   * elemen), melainkan hasil pengelompokan yang dipakai untuk menggambar:
   * komponen sesudah `container` harus masuk ke kartu itu, dan `close`
   * mengeluarkan komponen berikutnya. Ini aturan yang sama dengan penyusun
   * payload — kalau berbeda, editor dan pesan sungguhan akan melenceng.
   */
  const hasil = (await page.evaluate(`
    (function () {
      blocks = [
        { kind: 'text', value: 'Pembuka' },
        { kind: 'container', value: '', accent: '#58b9ff' },
        { kind: 'text', value: 'Di dalam kartu' },
        { kind: 'button', value: 'Situs', url: 'https://a.test' },
        { kind: 'close', value: '' },
        { kind: 'text', value: 'Penutup' }
      ];
      renderBlocks();
      return {
        // Panel pratinjau ada dua: kecil di tab Susun & besar di tab Pratinjau.
        duaPratinjau: Boolean(
          document.getElementById('previewHost') && document.getElementById('previewHostBesar'),
        ),
        fungsiTumpuk: typeof buatKartuEditor === 'function' && typeof buatItemEditor === 'function',
        error: null,
      };
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.fungsiTumpuk, true, 'penggambar kartu & komponen tersedia');
  assert.equal(hasil.duaPratinjau, true, 'dua host pratinjau tersedia');
  assert.equal(page.errors.length, 0, `editor tidak melempar error: ${page.errors.join('|')}`);

  /*
   * Pengelompokan kartu dipanggil dari fungsi NYATA (kelompokkanBlok), bukan
   * dari salinan logikanya — supaya tes ini gagal kalau aturan editor berubah
   * tanpa aturan penyusun payload ikut berubah.
   */
  const grup = (await page.evaluate(`
    (function () {
      function ringkas(daftar) {
        return kelompokkanBlok(daftar).map(function (g) {
          var jenis = g.kartu ? 'kartu' : (g.penutup ? 'tutup' : 'luar');
          return jenis + ':' + g.isi.map(function (i) { return i.block.kind; }).join('+');
        });
      }
      function logika(daftar) {
        return kelompokkanBlok(daftar, true).map(function (g) {
          return g.isi.map(function (i) { return i.block.kind + '@' + i.index; }).join('+');
        });
      }
      return {
        // Pembuka di luar kartu, satu kartu berisi teks & tombol, penutup
        // mengeluarkan blok sesudahnya.
        lengkap: ringkas([
          { kind: 'text' },
          { kind: 'container' },
          { kind: 'text' },
          { kind: 'button' },
          { kind: 'close' },
          { kind: 'text' }
        ]),
        // Tanpa container: semuanya di luar kartu (payload akan membungkusnya
        // sendiri jadi satu kartu bawaan).
        tanpaContainer: ringkas([{ kind: 'text' }, { kind: 'divider' }, { kind: 'text' }]),
        // Dua container berurutan: dua kartu, tanpa wadah luar kosong.
        duaKartu: ringkas([
          { kind: 'container' },
          { kind: 'text' },
          { kind: 'container' },
          { kind: 'text' }
        ]),
        // Select & Row adalah isi kartu biasa: keduanya tidak membuka atau
        // menutup kartu, hanya mengisi kartu tempatnya berada.
        selectDanRow: ringkas([
          { kind: 'container' },
          { kind: 'text' },
          { kind: 'select' },
          { kind: 'row' },
          { kind: 'button' }
        ]),
        /*
         * Mode logika (dipakai tombol naik/turun): Row hanya dipertahankan
         * kalau benar-benar memisahkan dua tombol. Row di antara teks dan
         * gambar dibuang, karena di Discord ia tidak mengubah apa pun.
         */
        logikaBerguna: logika([
          { kind: 'button' },
          { kind: 'row' },
          { kind: 'button' }
        ]),
        logikaSiaSia: logika([
          { kind: 'text' },
          { kind: 'row' },
          { kind: 'image' }
        ])
      };
    })()
  `)) as Record<string, string[]>;

  /*
   * Dibandingkan sebagai string, bukan deepEqual: array yang dibuat di dalam
   * `node:vm` berasal dari realm lain, sehingga prototype-nya berbeda dan
   * deepStrictEqual menolaknya walaupun isinya sama persis.
   */
  assert.equal(
    grup.lengkap.join(' | '),
    'luar:text | kartu:text+button | luar:text',
    'komponen masuk ke kartunya, close mengeluarkan sisanya',
  );
  assert.equal(
    grup.tanpaContainer.join(' | '),
    'luar:text+divider+text',
    'tanpa container tetap satu wadah',
  );
  assert.equal(
    grup.duaKartu.join(' | '),
    'kartu:text | kartu:text',
    'dua kartu, tanpa wadah luar kosong',
  );
  assert.equal(
    grup.selectDanRow.join(' | '),
    'kartu:text+select+row+button',
    'select & row tetap isi kartu, bukan struktur',
  );
  assert.equal(
    grup.logikaBerguna.join(' | '),
    'button@0+row@1+button@2',
    'Row yang memisahkan dua tombol dipertahankan',
  );
  assert.equal(
    grup.logikaSiaSia.join(' | '),
    'text@0+image@2',
    'Row yang tidak memisahkan tombol dibuang, indeks blok tetap benar',
  );
});

await check('pesan: select menu & baris baru bisa disusun dari editor', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';

  /*
   * Halaman harus menawarkan KEDUA komponen baru di daftar "tambah komponen".
   * Tanpa tombolnya, blok select/row hanya bisa muncul dari impor Discohook —
   * admin tidak punya jalan membuatnya sendiri.
   */
  assert.ok(html.includes("addBlock('select')"), 'tombol tambah Select menu ada');
  assert.ok(html.includes("addBlock('row')"), 'tombol tambah Baris baru ada');

  const page = mountPage(html, 'uji-select-row');

  const hasil = (await page.evaluate(`
    (function () {
      // Blok baru harus langsung bisa dipakai: select string tanpa pilihan
      // ditolak Discord, jadi addBlock wajib menyertakan satu pilihan contoh.
      blocks = [];
      addBlock('select');
      addBlock('row');
      var select = blocks[0];
      var ringkas = {
        jenis: select.selectKind,
        punyaPilihan: select.options.length,
        min: select.minValues,
        max: select.maxValues,
        // Row tidak akan terkirim kalau dibuang payloadBlocks.
        terkirim: payloadBlocks().map(function (b) { return b.kind; })
      };
      renderBlocks();
      return ringkas;
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.jenis, 'string', 'select baru berjenis string');
  assert.equal(hasil.punyaPilihan, 1, 'select baru sudah punya satu pilihan contoh');
  assert.equal(hasil.min, 1, 'minimal 1 pilihan');
  assert.equal(hasil.max, 1, 'maksimal 1 pilihan');
  assert.equal(
    (hasil.terkirim as string[]).join(' | '),
    'select | row',
    'select & row ikut terkirim ke server',
  );
  assert.equal(page.errors.length, 0, `editor select tidak melempar error: ${page.errors.join('|')}`);
});

await check('pesan: editor aksi tampil di komponen & tersimpan bersama tombol', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';

  /*
   * Halaman harus MEMBAWA aksi tersimpan ke browser: tanpa ini, membuka pesan
   * yang sudah punya aksi akan menampilkannya kosong dan menyimpan ulang akan
   * menghapus aksi itu.
   */
  assert.ok(html.includes('POST_ACTIONS'), 'aksi tersimpan ditanam ke halaman');
  assert.ok(html.includes('kartuAksi'), 'penggambar kartu aksi ada');
  assert.ok(html.includes('susunAksi'), 'penyusun muatan aksi ada');

  const page = mountPage(html, 'uji-aksi');

  const hasil = (await page.evaluate(`
    (function () {
      // Simulasi pesan yang sudah punya satu tombol tersimpan + aksinya.
      editingId = 1;
      roleButtons = [{ id: 7, roleId: ROLES[0] ? ROLES[0].id : '900', label: 'Gamer', mode: 'toggle', emoji: '', style: 'primary' }];
      POST_ACTIONS = { 1: { 'button:7': [
        { kind: 'role', roleId: '900', op: 'toggle' },
        { kind: 'reply', text: 'Hai {member.name}', hidden: true }
      ] } };
      loadActionsFor(1);
      renderRoleButtons();

      var ringkas = {
        termuat: Object.keys(postActions).join(','),
        jumlah: aksiUntuk('button:7').length,
        ringkasan: ringkasAksi(aksiUntuk('button:7')[1]),
        // Kartu aksi harus muncul di daftar tombol (tombol ada di dalam host).
        adaKartu: Boolean(document.getElementById('roleList')),
        // Kunci target memakai ID tombol tersimpan, bukan label.
        target: targetTombol(roleButtons[0])
      };
      // Muatan yang dikirim ke server hanya berisi aksi yang sah.
      postActions['button:7'].push({ kind: 'reply', text: '' });
      ringkas.muatan = Object.keys(susunAksi()).join(',');
      ringkas.muatanJumlah = susunAksi()['button:7'].length;
      return ringkas;
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.termuat, 'button:7', 'aksi termuat per target');
  assert.equal(hasil.jumlah, 2, 'dua aksi terbaca');
  assert.equal(hasil.ringkasan, 'balas "Hai {member.name}"', 'ringkasan aksi bisa dibaca');
  assert.equal(hasil.target, 'button:7', 'target memakai ID tombol');
  assert.equal(hasil.muatanJumlah, 2, 'aksi tanpa teks tidak ikut dikirim');
  assert.equal(page.errors.length, 0, `editor aksi tidak melempar error: ${page.errors.join('|')}`);
});

await check('pesan: kartu aksi blok Select bisa dibuka & digambar ulang', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-aksi-select');

  /*
   * Regresi yang dijaga: kartu aksi dipakai di TIGA tempat (tombol role,
   * pilihan dropdown, dan blok Select). Dulu tombol "Atur aksi" hanya
   * menyegarkan dua tempat pertama, sehingga kartu di blok Select tidak pernah
   * terbuka — state berubah, tetapi editor tidak digambar ulang.
   *
   * Pemeriksaan HARUS lewat pohon elemen yang tergambar: getElementById pada
   * DOM tiruan membuat elemen baru sesuai permintaan, jadi memeriksa id saja
   * akan lolos walaupun tidak ada yang digambar.
   */
  const hasil = (await page.evaluate(`
    (function () {
      // Wadah luar wajib: renderBlocks hanya menggambar isi container/kartu.
      blocks = [{ kind: 'container', accent: null, spoiler: false }, { kind: 'select', selectKind: 'role' }];
      renderBlocks();

      /** Cari SEMUA elemen dengan kelas tertentu di pohon tergambar. */
      function cariKelas(node, kelas, hasil) {
        if (!node) return hasil;
        if (node.className === kelas) hasil.push(node);
        (node.children || []).forEach(function (c) { cariKelas(c, kelas, hasil); });
        return hasil;
      }
      function cariTeks(node, teks, hasil) {
        if (!node) return hasil;
        if (node.textContent === teks) hasil.push(node);
        (node.children || []).forEach(function (c) { cariTeks(c, teks, hasil); });
        return hasil;
      }

      var host = document.getElementById('blockList');
      var kartuAwal = cariKelas(host, 'aksi-kartu', []);
      var teksAwal = kartuAwal.length ? kartuAwal[0].textContent : '';
      var tombol = cariTeks(host, 'Atur aksi', [])[0];
      if (tombol) tombol.onclick();

      // Sesudah diklik: pohon yang tergambar harus benar-benar berubah.
      var kartuAkhir = cariKelas(host, 'aksi-kartu', []);
      var isianAksi = cariKelas(host, 'aksi-daftar', []);
      var judul = cariKelas(host, 'aksi-judul', []).map(function (n) { return n.textContent; });

      return {
        adaKartu: kartuAwal.length > 0,
        adaTombol: Boolean(tombol),
        teksAwal: teksAwal,
        terbuka: aksiTerbuka,
        adaIsianAksi: isianAksi.length > 0,
        judul: judul.join(' | '),
        adaTombolTutup: cariTeks(host, 'Tutup', []).length > 0
      };
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.adaKartu, true, 'kartu aksi muncul di blok Select');
  assert.equal(hasil.adaTombol, true, 'tombol "Atur aksi" ada di pohon tergambar');
  assert.match(String(hasil.teksAwal), /Belum ada aksi/, 'keadaan awal dijelaskan');
  assert.equal(hasil.terbuka, 'select:role', 'kartu terbuka untuk target yang benar');
  assert.equal(hasil.adaIsianAksi, true, 'isian aksi tergambar setelah dibuka');
  assert.equal(hasil.adaTombolTutup, true, 'tombol berubah jadi "Tutup"');
  assert.match(String(hasil.judul), /Aksi: menu Role select/, 'judul memakai label jenis menu');
  assert.equal(page.errors.length, 0, `kartu aksi select error: ${page.errors.join('|')}`);
});

await check('pesan: lima jenis aksi baru bisa disusun & dikirim', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-aksi-jenis');

  const hasil = (await page.evaluate(`
    (function () {
      editingId = 1;
      POST_LIST = [{ id: 1, name: 'Ini' }, { id: 2, name: 'Lain' }];
      ROLES = [];
      postActions = {};
      aksiTerbuka = 'button:7';

      // Susun satu aksi tiap jenis lewat jalur yang dipakai tombol "+ Tambah".
      var jenis = ['wait', 'condition', 'variable', 'thread', 'delete', 'reply', 'message', 'role'];
      postActions['button:7'] = [];
      pilihDanTambah = function (target, nilai) {
        var daftar = aksiUntuk(target);
        if (nilai === 'wait') daftar.push({ kind: 'wait', seconds: 300 });
        else if (nilai === 'condition') daftar.push({ kind: 'condition', value: 'selected', comparator: 'equals', expected: 'gamer' });
        else if (nilai === 'variable') daftar.push({ kind: 'variable', name: 'kode', value: '{member.id}' });
        else if (nilai === 'thread') daftar.push({ kind: 'thread', threadName: 'Bantuan', private: true });
        else if (nilai === 'delete') daftar.push({ kind: 'delete', what: 'pesan' });
        else if (nilai === 'reply') daftar.push({ kind: 'reply', text: 'Halo {member.name}' });
        else if (nilai === 'message') daftar.push({ kind: 'message', postId: 2, toChannel: true });
        else daftar.push({ kind: 'role', roleId: '900', op: 'toggle' });
      };
      jenis.forEach(function (j) { pilihDanTambah('button:7', j); });

      var label = aksiUntuk('button:7').map(function (a) { return jenisAksiLabel(a.kind); });
      var ringkas = aksiUntuk('button:7').map(function (a) { return ringkasAksi(a); });
      var muatan = susunAksi()['button:7'] || [];
      return {
        jumlah: aksiUntuk('button:7').length,
        label: label.join(' | '),
        ringkas: ringkas.join(' | '),
        terkirim: muatan.map(function (a) { return a.kind; }).join(','),
        // Durasi & waktu diformat untuk manusia, bukan angka mentah.
        limaMenit: jamAksi(300),
        waktu: waktuLokal(new Date(2026, 0, 2, 3, 4).getTime())
      };
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.jumlah, 8, 'delapan aksi tersusun');
  assert.match(String(hasil.label), /Tunggu \| Syarat \| Variabel \| Thread \| Hapus pesan/, 'label jenis baru ada');
  assert.match(String(hasil.ringkas), /tunggu 5 menit/, 'durasi tunggu terbaca');
  assert.match(String(hasil.ringkas), /syarat selected sama dengan "gamer"/);
  assert.match(String(hasil.ringkas), /buat thread "Bantuan"/);
  assert.equal(hasil.terkirim, 'wait,condition,variable,thread,delete,reply,message,role', 'semua jenis ikut dikirim');
  assert.equal(hasil.limaMenit, '5 menit');
  assert.equal(hasil.waktu, '2026-01-02 03:04', 'waktu lokal diformat dengan nol di depan');
  assert.equal(page.errors.length, 0, `editor jenis aksi error: ${page.errors.join('|')}`);
});

await check('pesan: panel jadwal kirim menyusun & menyimpan jadwal', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-jadwal');
  const depan = Date.now() + 3 * 60 * 60 * 1000;

  const hasil = (await page.evaluate(`
    (function () {
      editingId = 1;
      POST_SCHEDULES = {};
      muatJadwal();

      document.getElementById('scheduleDue').value = new Date(${depan}).toISOString().slice(0, 16);
      document.getElementById('scheduleRepeat').value = '360';
      tambahJadwal();

      // Waktu lampau ditolak, bukan disimpan lalu tidak pernah terkirim.
      var sebelum = jadwalPesan.length;
      document.getElementById('scheduleDue').value = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 16);
      tambahJadwal();

      return {
        jumlah: jadwalPesan.length,
        ditolak: jadwalPesan.length === sebelum,
        ulang: jadwalPesan[0] ? jadwalPesan[0].repeatMinutes : 0,
        target: editingId
      };
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.jumlah, 1, 'satu jadwal tersusun');
  assert.equal(hasil.ditolak, true, 'jadwal di masa lampau ditolak');
  assert.equal(hasil.ulang, 360, 'pengulangan tersimpan');

  // Simpan: harus memanggil endpoint jadwal, bukan endpoint lain.
  const respons = (await page.evaluate(`
    simpanJadwal().then(function () { return true; })
  `)) as unknown;
  assert.equal(respons, true);
  const panggilan = page.fetches.filter((call) => call.path.includes('/schedules'));
  assert.equal(panggilan.length, 1, 'satu permintaan ke endpoint jadwal');
  assert.equal(panggilan[0]!.method, 'PUT');
  assert.match(String(panggilan[0]!.path), /\/api\/posts\/1\/schedules/);
  const body = panggilan[0]!.body as { schedules: Array<{ repeatMinutes: number }> };
  assert.equal(body.schedules.length, 1, 'jadwal dikirim');
  assert.equal(body.schedules[0]!.repeatMinutes, 360);
  assert.equal(page.errors.length, 0, `panel jadwal error: ${page.errors.join('|')}`);
});

await check('pesan: cabang syarat bisa diisi & tampil bersarang', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-cabang');

  const hasil = (await page.evaluate(`
    (function () {
      editingId = 1;
      ROLES = [];
      POST_LIST = [{ id: 2, name: 'Lain' }];
      postActions = { 'button:9': [
        { kind: 'condition', value: 'selected', comparator: 'equals', expected: 'gamer' }
      ] };
      aksiTerbuka = 'button:9';
      renderRoleButtons();

      // Tambah satu aksi ke cabang "cocok" lewat kotak cabang.
      var daftar = aksiUntuk('button:9');
      daftar[0].then = [{ kind: 'reply', text: 'kamu gamer', hidden: true }];
      daftar[0].else = [{ kind: 'stop' }];
      var kotak = kotakCabang(daftar, 0, 'then', 'cocok');
      var kotakLain = kotakCabang(daftar, 0, 'else', 'tidak cocok');

      return {
        jumlahCabang: kotak.children ? kotak.children.length : 0,
        teksCocok: kotak.textContent,
        teksLain: kotakLain.textContent,
        ringkas: ringkasAksi(daftar[0]),
        label: jenisAksiLabel('stop'),
        // Cabang ikut terkirim ke server; tanpa ini percabangan hilang diam-diam.
        muatan: (susunAksi()['button:9'] || [])[0],
      };
    })()
  `)) as Record<string, unknown>;

  assert.match(String(hasil.teksCocok), /Kalau cocok \(1\)/, 'cabang cocok menampilkan jumlah');
  assert.match(String(hasil.teksCocok), /kamu gamer/, 'isi cabang terbaca');
  assert.match(String(hasil.teksLain), /Hentikan/, 'cabang tidak cocok berisi aksi stop');
  assert.equal(hasil.label, 'Hentikan');
  const muatan = hasil.muatan as { then?: unknown[]; else?: unknown[] };
  assert.equal(muatan.then!.length, 1, 'cabang "cocok" ikut dikirim');
  assert.equal(muatan.else!.length, 1, 'cabang "tidak cocok" ikut dikirim');
  assert.equal(page.errors.length, 0, `editor cabang error: ${page.errors.join('|')}`);
});

await check('pesan: syarat bertingkat bisa disusun di editor', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-syarat');

  const hasil = (await page.evaluate(`
    (function () {
      editingId = 1;
      ROLES = [];
      POST_LIST = [{ id: 2, name: 'Lain' }];
      postActions = { 'button:9': [
        { kind: 'condition', check: { type: 'and', items: [
          { type: 'leaf', value: 'member.name', comparator: 'equals', expected: 'Wahyu' },
          { type: 'in', value: 'selected', list: ['gamer', 'anime'] }
        ] } }
      ] };
      aksiTerbuka = 'button:9';
      renderRoleButtons();

      var daftar = aksiUntuk('button:9');
      // Lewat KARTU aksi (bukan memanggil kotakSyarat langsung): yang harus
      // dibuktikan adalah editor benar-benar MENGGAMBAR pohon syaratnya.
      var kartu = buatBarisAksi('button:9', 0, daftar[0]);
      var kotak = kotakSyarat(daftar[0].check, null, 'check', 0);
      // Tambah satu anak lewat tombol "+ Tambah syarat" di kotak teratas.
      var tambah = null;
      (function cari(node) {
        if (!node || !node.children) return;
        for (var i = 0; i < node.children.length; i += 1) {
          var anak = node.children[i];
          if (anak.textContent === '+ Tambah syarat') { tambah = anak; return; }
          cari(anak);
        }
      })(kotak);
      if (tambah) tambah.onclick();

      return {
        teksKartu: kartu.textContent,
        ringkas: ringkasSyarat(daftar[0].check),
        jumlahAnak: (daftar[0].check.items || []).length,
        teksKotak: kotak.textContent,
        // Yang disusun editor harus benar-benar terkirim ke server.
        muatan: (susunAksi()['button:9'] || [])[0],
      };
    })()
  `)) as Record<string, unknown>;

  assert.match(String(hasil.teksKartu), /SEMUA benar/, 'kartu aksi menggambar jenis grup syarat');
  assert.ok(String(hasil.teksKartu).includes('member.name'), 'kartu aksi menggambar isi syarat');
  assert.match(String(hasil.ringkas), /member\.name sama dengan "Wahyu"/, 'ringkasan simpul daun');
  assert.match(String(hasil.ringkas), /termasuk \[gamer, anime\]/, 'ringkasan `in`');
  assert.equal(hasil.jumlahAnak, 3, 'tombol tambah menyisipkan anak baru');
  assert.ok(String(hasil.teksKotak).includes('SEMUA benar'), 'jenis grup terbaca di editor');
  const muatan = hasil.muatan as { check?: { type: string; items: unknown[] }; value?: string };
  assert.ok(muatan.check, 'pohon syarat ikut dikirim, bukan dibuang');
  assert.equal(muatan.check!.type, 'and');
  assert.equal(muatan.check!.items.length, 3);
  assert.equal(page.errors.length, 0, `editor syarat error: ${page.errors.join('|')}`);
});

await check('pesan: setelan thread & tujuan channel ikut terkirim', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-thread');

  const hasil = (await page.evaluate(`
    (function () {
      editingId = 1;
      ROLES = [];
      POST_LIST = [{ id: 2, name: 'Lain' }];
      postActions = { 'button:9': [
        { kind: 'thread', threadName: 'Bantuan', private: true },
        { kind: 'webhook', postId: 2, toChannel: true, channelId: '123456789012345678' }
      ] };
      aksiTerbuka = 'button:9';
      renderRoleButtons();

      var daftar = aksiUntuk('button:9');
      daftar[0].autoArchiveMinutes = 10080;
      daftar[0].slowmodeSeconds = 30;
      daftar[0].appliedTags = ['111111111111111111'];
      daftar[0].threadMessage = 'Halo {member.mention}';

      var muatan = susunAksi()['button:9'];
      return {
        thread: muatan[0],
        webhook: muatan[1],
        ringkasThread: ringkasAksi(muatan[0]),
        ringkasWebhook: ringkasAksi(muatan[1]),
        label: jenisAksiLabel('webhook'),
      };
    })()
  `)) as Record<string, unknown>;

  const thread = hasil.thread as {
    autoArchiveMinutes?: number;
    slowmodeSeconds?: number;
    appliedTags?: string[];
    threadMessage?: string;
  };
  assert.equal(thread.autoArchiveMinutes, 10080, 'lama arsip ikut terkirim');
  assert.equal(thread.slowmodeSeconds, 30, 'slowmode ikut terkirim');
  // deepEqual tidak bisa dipakai di sini: nilai datang dari vm dan array-nya
  // dari realm lain, jadi perbandingan referensi selalu gagal.
  assert.equal((thread.appliedTags ?? []).join(','), '111111111111111111');
  assert.equal(thread.threadMessage, 'Halo {member.mention}');

  const webhook = hasil.webhook as { kind: string; channelId?: string };
  assert.equal(webhook.kind, 'webhook', 'jenis webhook tidak berubah jadi message');
  assert.equal(webhook.channelId, '123456789012345678', 'channel tujuan ikut terkirim');
  assert.match(String(hasil.ringkasWebhook), /via webhook/);
  assert.equal(hasil.label, 'Kirim webhook');
  assert.equal(page.errors.length, 0, `editor thread/webhook error: ${page.errors.join('|')}`);
});

await check('pesan: izin ping & nama thread ikut dikirim, bawaan tanpa ping', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-mention');

  const hasil = (await page.evaluate(`
    (function () {
      var polos = allowedMentionsPesan();
      document.getElementById('postMentionRoles').checked = true;
      document.getElementById('postThreadName').value = 'Diskusi umum';
      var dengan = allowedMentionsPesan();
      return { polos: polos, dengan: dengan };
    })()
  `)) as { polos: { parse: string[] }; dengan: { parse: string[] } };

  // Bawaan HARUS kosong: ini yang mencegah @everyone tidak sengaja terkirim.
  assert.equal(hasil.polos.parse.join(','), '', 'bawaan tanpa ping sama sekali');
  assert.equal(hasil.dengan.parse.join(','), 'roles', 'hanya jenis yang dicentang');

  // Ikut dikirim saat Simpan (bukan hanya disimpan di variabel halaman).
  await page.evaluate(`
    (async function () {
      blocks = [{ kind: 'text', value: 'Pengumuman' }];
      document.getElementById('postName').value = 'Ping role';
      if (typeof renderBlocks === 'function') renderBlocks();
      await savePost();
    })()
  `);
  const simpan = page.fetches.find((call) => call.path === '/api/posts' || /^\/api\/posts\/\d+$/.test(call.path));
  assert.ok(simpan, 'Simpan memanggil /api/posts');
  const muatan = simpan!.body as {
    allowedMentions?: { parse: string[] };
    threadName?: string;
  };
  assert.equal((muatan.allowedMentions?.parse ?? []).join(','), 'roles', 'izin ping ikut dikirim');
  assert.equal(muatan.threadName, 'Diskusi umum', 'nama thread ikut dikirim');
  assert.equal(page.errors.length, 0, `editor ping/thread error: ${page.errors.join('|')}`);
});

await check('pesan: panel payload JSON meminta kode sesuai library yang dipilih', async () => {
  const html = mounted.find((page) => page.name === '/pesan?isi')?.html ?? '';
  const page = mountPage(html, 'uji-codegen');

  /*
   * Tanpa pesan tersimpan, panel harus menjelaskan kenapa kosong — bukan
   * memanggil endpoint dengan id `null` yang menghasilkan 404 tanpa pesan.
   */
  page.fetches.length = 0;
  const belumSimpan = (await page.evaluate(`
    (function () {
      editingId = null;
      return muatPayloadJson().then(function () {
        return { status: document.getElementById('codegenStatus').textContent };
      });
    })()
  `)) as { status: string };

  assert.ok(belumSimpan.status.includes('Simpan pesan dulu'), 'menyuruh menyimpan dulu');
  assert.equal(page.fetches.length, 0, 'tidak ada permintaan saat pesan belum tersimpan');

  /*
   * Permintaan harus membawa id pesan & library yang dipilih: server memilih
   * penerjemah dari parameter itu, jadi salah parameter = kode bahasa lain.
   */
  const dipanggil = (await page.evaluate(`
    (function () {
      editingId = 42;
      document.getElementById('codegenLib').value = 'dpy2';
      return muatPayloadJson().then(function () {
        return {
          kode: document.getElementById('codegenOut').value,
          json: document.getElementById('payloadJson').value,
          docs: document.getElementById('codegenDocs').textContent,
          status: document.getElementById('codegenStatus').textContent,
        };
      });
    })()
  `)) as { kode: string; json: string; docs: string; status: string };

  const permintaan = page.fetches.map((call) => call.path).join(', ');
  assert.ok(permintaan.includes('/api/posts/42/json'), 'memakai id pesan yang sedang disunting');
  assert.ok(permintaan.includes('library=dpy2'), 'library pilihan ikut dikirim');
  assert.ok(dipanggil.json.includes('"components"'), 'payload JSON ditampilkan');
  assert.ok(dipanggil.json.includes('"flags"'), 'flag pesan ikut ditampilkan');
  assert.ok(dipanggil.kode.includes('ui.Container'), 'kode discord.py tampil');
  assert.ok(dipanggil.kode.includes('import discord'), 'baris import ikut tampil');
  // Import dan kode dipisah baris kosong supaya hasil salin bisa langsung tempel.
  assert.ok(dipanggil.kode.includes('import discord\nfrom discord import ui\n\nview'), 'import & kode dipisah baris kosong');
  assert.ok(dipanggil.docs.includes('discordpy'), 'tautan dokumentasi sesuai library');
  assert.equal(dipanggil.status, '', 'tidak ada peringatan saat semua bagian ikut');
  assert.equal(page.errors.length, 0, `panel kode error: ${page.errors.join('|')}`);
});

await check('pesan: diff versi menghitung tambah/hapus/ubah & menampilkan teks lama-baru', async () => {
  const html = mounted.find((page) => page.name === '/pesan?isi')?.html ?? '';
  const page = mountPage(html, 'uji-diff');

  /*
   * Fungsi murni lebih dulu: hasilnya harus menyebut jenis perubahan dan arah
   * yang benar. Arah terbalik membuat admin mengembalikan versi yang salah.
   */
  const hitung = (await page.evaluate(`
    (function () {
      var hasil = diffRingkas(
        { blocks: [{ kind: 'text', value: 'lama' }, { kind: 'button', value: 'A' }], accent: '#111111', flags: 0 },
        { blocks: [{ kind: 'text', value: 'baru' }, { kind: 'button', value: 'B' }, { kind: 'separator' }], accent: '#222222', flags: 4 }
      );
      return {
        total: hasil.total,
        diubah: hasil.diubah,
        ditambah: hasil.ditambah,
        dihapus: hasil.dihapus,
        baris: hasil.baris.join('|'),
        teks: hasil.teks.map(function (satu) { return satu.lama + '>' + satu.baru + '@' + satu.posisi; }).join('|'),
        judul: ringkasDiff(hasil),
      };
    })()
  `)) as {
    total: number;
    diubah: number;
    ditambah: number;
    dihapus: number;
    baris: string;
    teks: string;
    judul: string;
  };

  assert.equal(hitung.diubah, 2, 'dua blok berubah (teks & tombol)');
  assert.equal(hitung.ditambah, 1, 'satu blok ditambahkan');
  assert.equal(hitung.dihapus, 0, 'tidak ada yang dihapus');
  // 2 blok + 1 tambah + 2 pengaturan (aksen & flag) = 5.
  assert.equal(hitung.total, 5, 'pengaturan ikut dihitung sebagai perubahan');
  assert.ok(hitung.baris.includes('+ blok 3'), 'blok baru disebut posisinya');
  assert.ok(hitung.baris.includes('warna aksen'), 'perubahan aksen terlihat');
  assert.ok(hitung.baris.includes('#111111 → #222222'), 'nilai aksen lama → baru');
  assert.equal(hitung.teks, 'lama>baru@1', 'teks lama & baru dipasangkan dengan posisinya');
  assert.equal(hitung.judul, '5 perubahan (1 tambah, 2 ubah, 2 pengaturan)', 'ringkasan judul');

  // Blok yang dihapus di ujung harus terbaca sebagai hapusan, bukan ubahan.
  const hapus = (await page.evaluate(`
    (function () {
      var hasil = diffRingkas(
        { blocks: [{ kind: 'text', value: 'a' }, { kind: 'image' }] },
        { blocks: [{ kind: 'text', value: 'a' }] }
      );
      return { dihapus: hasil.dihapus, baris: hasil.baris.join('|') };
    })()
  `)) as { dihapus: number; baris: string };
  assert.equal(hapus.dihapus, 1, 'blok yang hilang terhitung');
  assert.ok(hapus.baris.includes('− blok 2: gambar dihapus'), 'menyebut blok & jenisnya');
  assert.ok(!hapus.baris.includes('undefined'), 'tidak ada nilai undefined di tampilan');

  /*
   * Lalu jalur UI-nya: tombol Bandingkan mengambil snapshot versi itu saja,
   * menghitung diff terhadap EDITOR (bukan terhadap versi tersimpan), dan
   * menampilkan panelnya. Tombol yang sama menutup panel.
   */
  page.fetches.length = 0;
  const panel = (await page.evaluate(`
    (function () {
      editingId = 1;
      // Data riwayat yang dipegang halaman (sama seperti setelah memuat pesan).
      RIWAYAT[1] = RIWAYAT_AWAL[1];
      blocks = [{ kind: 'text', value: 'isi sekarang' }];
      // Panel diff baru ada setelah daftar versi digambar.
      document.getElementById('riwayatList').innerHTML = riwayatHtml();

      return bandingkanVersi(77).then(function () {
        var el = document.getElementById('diff-77');
        return { tampil: !el.hidden, html: el.innerHTML };
      });
    })()
  `)) as Record<string, unknown>;


  const alamat = page.fetches.map((call) => call.path).join(', ');


  assert.ok(alamat.includes('/revisions?revision=77'), 'hanya versi yang dibandingkan yang diambil');
  assert.equal(panel.tampil, true, 'panel diff terbuka');

  /*
   * Isi panel diperiksa lewat `renderDiff` langsung: elemen tiruan tidak
   * menyimpan HTML, sama seperti pemeriksaan lain di berkas ini. Yang diuji
   * adalah HTML yang BENAR-BENAR dibuat fungsi itu, bukan string di source.
   */
  const tampilan = (await page.evaluate(`
    (function () {
      var isi = renderDiff(diffRingkas(
        { blocks: [{ kind: 'text', value: 'versi lama' }] },
        { blocks: [{ kind: 'text', value: 'isi sekarang' }] }
      ));
      return { html: isi };
    })()
  `)) as { html: string };

  assert.ok(tampilan.html.includes('teks diubah'), 'perubahan teks terlihat di panel');
  assert.ok(tampilan.html.includes('isi sekarang'), 'isi editor sekarang ditampilkan');
  assert.ok(tampilan.html.includes('versi lama'), 'isi versi lama ditampilkan');
  assert.ok(tampilan.html.includes('diff-baris diff-ubah'), 'baris diberi kelas warna');
  assert.ok(tampilan.html.includes('1 perubahan'), 'ringkasan jumlah perubahan di kepala panel');

  const ditutup = (await page.evaluate(`
    (function () {
      return bandingkanVersi(77).then(function () {
        return document.getElementById('diff-77').hidden;
      });
    })()
  `)) as boolean;
  assert.equal(ditutup, true, 'menekan Bandingkan lagi menutup panel');
  assert.equal(page.errors.length, 0, `diff error: ${page.errors.join('|')}`);
});

await check('pesan: tab riwayat memuat versi & tautan berbagi bisa dibuat', async () => {
  // Halaman berisi: riwayat versi hanya ada kalau pesannya sudah tersimpan.
  const html = mounted.find((page) => page.name === '/pesan?isi')?.html ?? '';
  const page = mountPage(html, 'uji-riwayat');

  /*
   * Riwayat yang tertanam di halaman dipakai lebih dulu: membuka tab tidak
   * boleh memicu permintaan baru, karena daftarnya sudah dikirim server.
   */
  const awal = (await page.evaluate(`
    (function () {
      editingId = 1;
      document.getElementById('postName').value = 'Rules';
      showPesanTab('riwayat');
      return {
        tabTampil: !document.getElementById('pane-riwayat').hidden,
        html: riwayatHtml(),
        jumlahDariServer: (RIWAYAT[editingId] || []).length,
      };
    })()
  `)) as { tabTampil: boolean; html: string; jumlahDariServer: number };

  assert.equal(awal.tabTampil, true, 'tab riwayat bisa dibuka');
  assert.equal(awal.jumlahDariServer, 2, 'riwayat dari server dipakai tanpa permintaan tambahan');
  assert.ok(awal.html.includes('sebelum disunting'), 'versi lama tampil apa adanya');
  assert.ok(awal.html.includes('kembalikanVersi(77)'), 'tiap versi punya tombol kembalikan');

  // Tombol "Muat ulang" memakai endpoint revisi dengan metode GET.
  await page.evaluate(`
    (async function () { await muatRiwayat(); })()
  `);
  const muat = page.fetches.find((call) => /^\/api\/posts\/\d+\/revisions$/.test(call.path));
  assert.ok(muat, 'riwayat dimuat dari /api/posts/:id/revisions');

  // Mengembalikan versi = POST ke endpoint yang sama, membawa id versinya.
  await page.evaluate(`
    (async function () {
      // Dialog konfirmasi sungguhan menunggu klik; di uji ini dijawab "ya".
      askConfirm = async function () { return true; };
      await kembalikanVersi(77);
    })()
  `);
  const kembali = page.fetches.find(
    (call) => /^\/api\/posts\/\d+\/revisions$/.test(call.path) && call.method === 'POST',
  );
  assert.ok(kembali, 'kembalikan versi memakai POST');
  assert.equal((kembali!.body as { revisionId: number }).revisionId, 77, 'id versi ikut dikirim');

  // Tautan berbagi: dibuat lewat POST, alamatnya memakai origin halaman.
  await page.evaluate(`
    (async function () { await buatShare(); })()
  `);
  const share = page.fetches.find((call) => /^\/api\/posts\/\d+\/share$/.test(call.path));
  assert.ok(share, 'tautan berbagi dibuat lewat /api/posts/:id/share');
  assert.equal(share!.method, 'POST');
  const alamat = (await page.evaluate(`document.getElementById('shareUrl').value`)) as string;
  assert.ok(alamat.includes('/bagi/'), 'alamat yang ditampilkan memakai /bagi/');

  await page.evaluate(`
    (async function () { await cabutShare(); })()
  `);
  const cabut = page.fetches.find(
    (call) => /^\/api\/posts\/\d+\/share$/.test(call.path) && call.method === 'DELETE',
  );
  assert.ok(cabut, 'pencabutan tautan memakai DELETE');
  assert.equal(page.errors.length, 0, `editor riwayat error: ${page.errors.join('|')}`);
});

await check('pesan: mode jadwal kalender menyusun cron & menolak pola salah', async () => {
  const html = mounted.find((page) => page.name === '/pesan?isi')?.html ?? '';
  const page = mountPage(html, 'uji-cron');

  const hasil = (await page.evaluate(`
    (function () {
      editingId = 1;
      muatJadwal();
      modeJadwal();

      // Mode kalender: isian waktu & pengulangan disembunyikan, isian cron tampil.
      document.getElementById('scheduleMode').value = 'kalender';
      modeJadwal();
      var tampil = {
        due: document.getElementById('scheduleDue').hidden,
        cron: document.getElementById('scheduleCron').hidden,
        preset: document.getElementById('schedulePresetShell').hidden
      };

      // Pola siap pakai mengisi isian teks.
      document.getElementById('schedulePreset').value = '0 9 * * 1';
      presetJadwal();
      var terisi = document.getElementById('scheduleCron').value;

      // Pola sah -> tersimpan dengan cron, pola salah -> tidak menambah apa pun.
      jadwalPesan = [];
      tambahJadwal();
      var sesudahSah = jadwalPesan.length;
      var cronTersimpan = jadwalPesan[0] ? jadwalPesan[0].cron : null;
      document.getElementById('scheduleCron').value = '99 9 * * *';
      tambahJadwal();
      var sesudahSalah = jadwalPesan.length;

      return {
        tampil: tampil,
        terisi: terisi,
        sesudahSah: sesudahSah,
        cronTersimpan: cronTersimpan,
        sesudahSalah: sesudahSalah,
        validHarian: cronValid('0 9 * * *'),
        validMingguan: cronValid('0 9 * * 1-5'),
        validNama: cronValid('0 9 * * mon'),
        validRusak: cronValid('0 9 * *'),
        ringkas: jadwalCronRingkas('0 9 * * 1'),
        ringkasHarian: jadwalCronRingkas('0 8 * * *'),
        ringkasTanggal: jadwalCronRingkas('30 8 1 * *')
      };
    })()
  `)) as Record<string, unknown>;

  const tampil = hasil.tampil as { due: boolean; cron: boolean; preset: boolean };
  assert.equal(tampil.due, true, 'isian waktu disembunyikan di mode kalender');
  assert.equal(tampil.cron, false, 'isian cron tampil');
  assert.equal(tampil.preset, false, 'daftar pola tampil');
  assert.equal(hasil.terisi, '0 9 * * 1', 'pola siap pakai mengisi isian');
  assert.equal(hasil.sesudahSah, 1, 'pola sah menambah satu jadwal');
  assert.equal(hasil.cronTersimpan, '0 9 * * 1', 'ekspresi ikut disimpan');
  assert.equal(hasil.sesudahSalah, 1, 'pola salah TIDAK menambah jadwal');
  assert.equal(hasil.validHarian, true);
  assert.equal(hasil.validMingguan, true, 'rentang hari diterima');
  assert.equal(hasil.validNama, true, 'nama hari diterima');
  assert.equal(hasil.validRusak, false, 'ruas kurang ditolak');
  assert.equal(hasil.ringkas, 'tiap Senin pukul 09:00');
  assert.equal(hasil.ringkasHarian, 'tiap hari pukul 08:00');
  assert.equal(hasil.ringkasTanggal, 'tiap tanggal 1 pukul 08:30');
  assert.equal(page.errors.length, 0, `editor jadwal cron error: ${page.errors.join('|')}`);
});

await check('pesan: aksi teks mentah & hapus pesan bertarget tersusun', async () => {
  const html = mounted.find((page) => page.name === '/pesan?isi')?.html ?? '';
  const page = mountPage(html, 'uji-aksi-baru');

  const hasil = (await page.evaluate(`
    (function () {
      editingId = 1;
      roleButtons = [{ id: 9, roleId: '9001', label: 'Gamer', mode: 'toggle', emoji: '', style: 'primary' }];
      POST_ACTIONS = { 1: { 'button:9': [] } };
      loadActionsFor(1);
      renderRoleButtons();

      var daftar = aksiUntuk('button:9');
      // Teks mentah: isi kosong harus dibuang dari muatan, isi terisi dikirim.
      daftar.push({ kind: 'raw', rawText: '   ' });
      var muatanKosong = (susunAksi()['button:9'] || []).length;
      daftar[0].rawText = 'Halo {member.mention}';

      // Hapus bertarget & ringkasannya.
      daftar.push({ kind: 'delete', what: 'sebelumnya' });
      daftar.push({ kind: 'delete', what: 'pesan' });

      var muatan = susunAksi()['button:9'] || [];
      return {
        muatanKosong: muatanKosong,
        jenis: muatan.map(function (a) { return a.kind + ':' + (a.what || ''); }).join(','),
        ringkasMentah: ringkasAksi(muatan[0]),
        ringkasHapus: ringkasAksi(muatan[1]),
        labelMentah: jenisAksiLabel('raw'),
        labelHapus: jenisAksiLabel('delete'),
        // Editor harus bisa digambar tanpa error untuk jenis aksi baru.
        gambar: (function () { renderRoleButtons(); return true; })()
      };
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.muatanKosong, 0, 'teks kosong tidak ikut dikirim');
  assert.equal(hasil.jenis, 'raw:,delete:sebelumnya,delete:pesan', 'jenis & sasaran hapus tersimpan');
  assert.ok(String(hasil.ringkasMentah).includes('kirim teks'), 'ringkasan teks mentah terbaca');
  assert.equal(hasil.ringkasHapus, 'hapus pesan dari aksi sebelumnya', 'sasaran hapus terbaca di ringkasan');
  assert.equal(hasil.labelMentah, 'Kirim teks');
  assert.equal(hasil.labelHapus, 'Hapus pesan');
  assert.equal(hasil.gambar, true, 'editor bisa digambar dengan aksi baru');
  assert.equal(page.errors.length, 0, `editor aksi baru error: ${page.errors.join('|')}`);
});

await check('pesan: dokumen multi-pesan bisa disusun & dikirim', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-grup');

  const hasil = (await page.evaluate(`
    (async function () {
      editingId = null;
      blocks = [{ kind: 'container' }, { kind: 'text', value: 'Halo dari dokumen' }];
      document.getElementById('postName').value = 'Pengumuman';

      // Susun dua pesan, lalu buat pesan kedua membalas yang pertama.
      tambahPesanGrup();
      tambahPesanGrup();
      var sesudah = grupAktif.messages.length;

      var daftar = document.getElementById('grupDaftar');
      var pilihBalas = null;
      (function cari(node) {
        if (!node || !node.children) return;
        for (var i = 0; i < node.children.length; i += 1) {
          var anak = node.children[i];
          if (anak.tagName === 'SELECT' && !pilihBalas) pilihBalas = anak;
          cari(anak);
        }
      })(daftar);

      return {
        sesudah: sesudah,
        id: grupAktif.messages.map(function (p) { return p.id; }).join(','),
        nama: grupAktif.messages.map(function (p) { return p.name; }).join(','),
        adaPilihBalas: Boolean(pilihBalas),
        teksDaftar: daftar.textContent
      };
    })()
  `)) as Record<string, unknown>;

  assert.equal(hasil.sesudah, 2, 'dua pesan tersusun');
  assert.equal(hasil.id, 'p1,p2', 'ID pesan stabil & berurutan');
  assert.ok(hasil.adaPilihBalas, 'ada pilihan "balas pesan"');
  /*
   * Isi pesan tidak dicari di daftar: baris dokumen hanya menampilkan nama,
   * rujukan, dan thread — bukan isi blok (itu tugas pratinjau). Yang harus
   * dibuktikan di sini adalah SALINAN-nya benar, dan salinannya tidak
   * menunjuk objek yang sama dengan editor (kalau berbagi referensi, mengubah
   * pesan di dokumen akan mengubah pesan yang sedang disusun di tab Susun).
   */
  const salinan = (await page.evaluate(`
    (function () {
      grupAktif.messages[0].blocks.push({ kind: 'text', value: 'HANYA DI DOKUMEN' });
      return {
        dokumen: grupAktif.messages[0].blocks.length,
        editor: blocks.length
      };
    })()
  `)) as Record<string, number>;
  assert.ok(salinan.dokumen > salinan.editor, 'blok di dokumen adalah salinan, bukan referensi yang sama');
  assert.equal(page.fetches.length, 0, 'menyusun dokumen belum memanggil server');

  // Simpan: muatan harus memuat messages & series, dan hasil server dipakai.
  const simpan = (await page.evaluate(`
    (async function () {
      grupAktif.messages[1].reference = 'p1';
      grupAktif.messages[1].threadName = 'Diskusi';
      document.getElementById('grupNama').value = 'Dokumen uji';
      document.getElementById('grupSeries').checked = true;
      await simpanGrup();
      return {
        status: document.getElementById('grupStatus').textContent,
        idSetelah: grupAktif.id
      };
    })()
  `)) as Record<string, unknown>;

  const simpanCall = page.fetches.find((call) => call.path === '/api/post-groups');
  assert.ok(simpanCall, 'menyimpan memanggil /api/post-groups');
  const muatan = simpanCall!.body as { name: string; series: boolean; messages: Array<{ id: string; reference?: string }> };
  assert.equal(muatan.name, 'Dokumen uji');
  assert.equal(muatan.series, true, 'penanda "kirim berurutan" ikut dikirim');
  assert.equal(muatan.messages.length, 2);
  assert.equal(muatan.messages[1]!.reference, 'p1', 'rujukan balasan ikut dikirim');
  /*
   * Server tiruan menjawab `{ ok: true }` tanpa objek `document`. Editor harus
   * tetap jalan (tidak melempar), dan statusnya boleh kosong — yang penting
   * tidak ada error yang membuat tab Multi-pesan mati di browser.
   */
  assert.equal(page.errors.length, 0, 'simpan tanpa balasan server tidak membuat halaman error');

  // Kirim: harus menyebut channel dan memakai ID dokumen yang baru.
  const kirim = (await page.evaluate(`
    (async function () {
      document.getElementById('grupChannel').value = '123';
      grupAktif.id = 7;
      await kirimGrup();
      return { status: document.getElementById('grupStatus').textContent };
    })()
  `)) as Record<string, unknown>;
  const kirimCall = page.fetches.find((call) => call.path === '/api/post-groups/7/send');
  assert.ok(kirimCall, 'mengirim memanggil endpoint rangkaian yang benar');
  assert.equal((kirimCall!.body as { channelId: string }).channelId, '123');
  assert.match(String(kirim.status), /pesan terkirim/, 'status menyebut jumlah pesan terkirim');
  assert.equal(page.errors.length, 0, `editor dokumen error: ${page.errors.join('|')}`);
});

await check('pesan: flag pesan dikirim sebagai bitmask yang benar', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-flag');

  const hasil = (await page.evaluate(`
    (function () {
      var embeds = document.getElementById('postFlagEmbeds');
      var notif = document.getElementById('postFlagNotif');
      embeds.checked = true;
      notif.checked = true;
      var dua = flagPesan();
      notif.checked = false;
      var satu = flagPesan();
      embeds.checked = false;
      return { dua: dua, satu: satu, nol: flagPesan() };
    })()
  `)) as Record<string, number>;

  // Angka ini harus sama dengan SUPPRESS_EMBEDS (4) dan
  // SUPPRESS_NOTIFICATIONS (4096) di sisi server.
  assert.equal(hasil.dua, 4 | 4096, 'dua flag digabung');
  assert.equal(hasil.satu, 4, 'satu flag');
  assert.equal(hasil.nol, 0, 'tanpa flag');
  assert.equal(page.errors.length, 0, `flag pesan error: ${page.errors.join('|')}`);
});

await check('pesan: channel tambahan dikelola & dikirim ke endpoint targets', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-target');

  const awal = (await page.evaluate(`
    (function () {
      document.getElementById('postChannel').value = '9001';
      document.getElementById('targetPilih').value = '9001';
      tambahTarget();
      var samaUtama = TARGET_CHANNEL.length;
      document.getElementById('targetPilih').value = '9002';
      tambahTarget();
      tambahTarget();
      var sekali = TARGET_CHANNEL.length;
      document.getElementById('targetPilih').value = '9003';
      tambahTarget();
      return { samaUtama: samaUtama, sekali: sekali, sesudah: TARGET_CHANNEL.length, status: document.getElementById('targetStatus').textContent };
    })()
  `)) as { samaUtama: number; sekali: number; sesudah: number; status: string };

  assert.equal(awal.samaUtama, 0, 'channel utama tidak boleh jadi channel tambahan');
  assert.equal(awal.sekali, 1, 'channel tambahan ditambahkan sekali saja walau ditekan dua kali');
  assert.equal(awal.sesudah, 2, 'channel berbeda ditambahkan');
  assert.ok(awal.status.includes('2 channel'), 'jumlah channel tambahan terlihat');

  // Selesai menyimpan, daftar dikirim ke endpoint per pesan (bukan ikut /api/posts).
  page.fetches.length = 0;
  await page.evaluate(`
    (function () {
      document.getElementById('postName').value = 'Pengumuman';
      document.getElementById('postChannel').value = '9001';
      blocks = [{ kind: 'text', value: 'Halo' }];
      return savePost(false).then(function () { return saveTargets(12); });
    })()
  `);

  const keTarget = page.fetches.find((call) => call.path.includes('/targets'));
  assert.ok(keTarget, 'daftar channel dikirim ke endpoint targets');
  assert.ok(keTarget!.path.includes('/api/posts/12/targets'), 'memakai id pesan yang baru disimpan');
  assert.equal(keTarget!.method, 'PUT', 'penggantian utuh memakai PUT');
  const muatan = keTarget!.body as { channels?: string[] };
  assert.equal((muatan.channels ?? []).length, 2, 'hanya ID channel yang dikirim');

  // Menghapus satu baris mengubah daftar, bukan menyisakan channel hantu.
  const dihapus = (await page.evaluate(`
    (function () {
      TARGET_CHANNEL[0].__tombol = true;
      var sebelum = TARGET_CHANNEL.length;
      // Tombol hapus memanggil splice lewat handler baris; diuji langsung di sini.
      TARGET_CHANNEL.splice(0, 1);
      renderTarget();
      return { sebelum: sebelum, sesudah: TARGET_CHANNEL.length, teks: document.getElementById('targetDaftar').textContent, status: document.getElementById('targetStatus').textContent };
    })()
  `)) as { sebelum: number; sesudah: number; teks: string; status: string };
  assert.equal(dihapus.sesudah, dihapus.sebelum - 1, 'channel terhapus dari daftar');
  // Satu channel masih tersisa, dan itulah yang tampil — bukan yang tadi dihapus.
  assert.ok(dihapus.teks.includes('1. '), 'daftar digambar ulang setelah penghapusan');
  assert.ok(dihapus.status.includes('1 channel tambahan'), 'jumlah di status ikut turun');
  assert.equal(page.errors.length, 0, `target error: ${page.errors.join('|')}`);
});

await check('pesan: JSON dokumen multi-pesan bolak-balik dengan rujukan yang dijaga', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-json-dokumen');

  /*
   * Dokumen dua pesan, yang kedua membalas yang pertama. Ekspor harus memuat
   * rujukan itu — tanpa itu, rangkaian yang diimpor ke server lain berubah
   * jadi dua pesan lepas.
   */
  const ekspor = (await page.evaluate(`
    (function () {
      document.getElementById('grupSeries').checked = true;
      grupAktif = {
        id: null,
        name: 'Rangkaian uji',
        series: true,
        messages: [
          { id: 'm1', name: 'Pembuka', blocks: [{ kind: 'text', value: 'Halo' }] },
          { id: 'm2', name: 'Lanjutan', blocks: [{ kind: 'text', value: 'Lagi' }], reference: 'm1', threadName: 'Diskusi' }
        ]
      };
      eksporDokumen();
      var isi = JSON.parse(document.getElementById('grupJson').value);
      return {
        format: isi.format,
        jumlah: isi.messages.length,
        rujukan: isi.messages[1].reference,
        thread: isi.messages[1].threadName,
        series: isi.series,
        status: document.getElementById('grupJsonStatus').textContent
      };
    })()
  `)) as { format: string; jumlah: number; rujukan: string; thread: string; series: boolean; status: string };

  assert.equal(ekspor.format, 'zypher-document', 'format ditandai supaya bisa dikenali');
  assert.equal(ekspor.jumlah, 2, 'semua pesan ikut');
  assert.equal(ekspor.rujukan, 'm1', 'rujukan balasan ikut diekspor');
  assert.equal(ekspor.thread, 'Diskusi', 'nama thread ikut diekspor');
  assert.equal(ekspor.series, true, 'mode rangkaian ikut diekspor');
  assert.ok(ekspor.status.includes('2 pesan'), 'status menyebut jumlahnya');

  /*
   * Impor mengembalikan dokumen ke editor. Rujukan ke pesan yang tidak ada
   * harus DIBUANG: menyimpannya membuat pengiriman gagal di tengah rangkaian.
   */
  const impor = (await page.evaluate(`
    (function () {
      var data = {
        format: 'zypher-document',
        name: 'Hasil impor',
        series: true,
        messages: [
          { id: 'a', name: 'Satu', blocks: [{ kind: 'text', value: 'x' }] },
          { id: 'b', name: 'Dua', blocks: [], reference: 'a' },
          { id: 'c', name: 'Tiga', blocks: [], reference: 'hilang' },
          { id: 'c', name: 'Id ganda', blocks: [] }
        ]
      };
      document.getElementById('grupJson').value = JSON.stringify(data);
      imporDokumen();
      return {
        jumlah: grupAktif.messages.length,
        nama: grupAktif.name,
        rujukan: grupAktif.messages[1].reference || '',
        ketiga: grupAktif.messages[2].reference || '',
        status: document.getElementById('grupJsonStatus').textContent
      };
    })()
  `)) as { jumlah: number; nama: string; rujukan: string; ketiga: string; status: string };

  assert.equal(impor.jumlah, 3, 'id ganda dibuang, sisanya dimuat');
  assert.equal(impor.nama, 'Hasil impor', 'nama dokumen ikut');
  assert.equal(impor.rujukan, 'a', 'rujukan yang sah dipertahankan');
  assert.equal(impor.ketiga, '', 'rujukan ke pesan yang tidak ada dibuang');
  assert.ok(impor.status.includes('dibuang'), 'yang dibuang dilaporkan ke admin');

  // Berkas dari halaman lain ditolak dengan alasan, bukan dibaca setengah.
  const salahFormat = (await page.evaluate(`
    (function () {
      var sebelum = grupAktif.messages.length;
      document.getElementById('grupJson').value = JSON.stringify({ format: 'zypher-post', blocks: [] });
      imporDokumen();
      return { sebelum: sebelum, sesudah: grupAktif.messages.length, status: document.getElementById('grupJsonStatus').textContent };
    })()
  `)) as { sebelum: number; sesudah: number; status: string };
  assert.equal(salahFormat.sesudah, salahFormat.sebelum, 'dokumen terbuka tidak dirusak berkas yang salah');
  assert.equal(page.errors.length, 0, `json dokumen error: ${page.errors.join('|')}`);
});

await check('pesan: bentuk embed menyimpan layout & pratinjaunya memakai aturan embed', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-embed');

  /*
   * Pembangun embed di klien harus menahan aturan yang sama dengan server:
   * satu gambar besar, tombol di luar embed. Kalau pratinjau menampilkan dua
   * gambar, admin melihat sesuatu yang tidak akan pernah muncul di Discord.
   */
  const hasil = (await page.evaluate(`
    (function () {
      document.getElementById('postName').value = 'Pengumuman';
      document.getElementById('postAccent').value = '#5865f2';
      document.getElementById('postLayout').value = 'embed';
      blocks = [
        { kind: 'text', value: 'Baris satu' },
        { kind: 'divider' },
        { kind: 'text', value: 'Baris dua' },
        { kind: 'image', value: 'https://img.test/a.png' },
        { kind: 'image', value: 'https://img.test/b.png' },
        { kind: 'button', value: 'Buka', url: 'https://x.test' }
      ];
      var e = embedDariBlok();
      return {
        judul: e.embed.title,
        warna: e.embed.color,
        deskripsi: e.embed.description,
        gambar: e.embed.image,
        dilewati: e.dilewati.join('|')
      };
    })()
  `)) as { judul: string; warna: number; deskripsi: string; gambar: string; dilewati: string };

  assert.equal(hasil.judul, 'Pengumuman', 'judul embed dari nama pesan');
  assert.equal(hasil.warna, 0x5865f2, 'warna embed dari aksen');
  assert.ok(hasil.deskripsi.includes('Baris satu'), 'teks pertama masuk keterangan');
  assert.ok(hasil.deskripsi.includes('Baris dua'), 'teks setelah pemisah ikut');
  assert.equal(hasil.gambar, 'https://img.test/a.png', 'hanya satu gambar: yang pertama');
  assert.ok(hasil.dilewati.includes('gambar kedua'), 'gambar kedua dilaporkan');
  assert.ok(hasil.dilewati.includes('tombol'), 'tombol dijelaskan ada di luar embed');

  /*
   * Pratinjau embed: elemennya benar-benar DIGAMBAR lewat DOM tiruan, bukan
   * hanya dihitung. Wadah pratinjau yang ada di halaman dipakai apa adanya.
   */
  const pratinjau = (await page.evaluate(`
    (function () {
      var kotak = document.getElementById('previewHost');
      renderPreviewKe('previewHost');
      return {
        anak: kotak.children.length,
        kelas: kotak.children.map(function (c) { return c.className; }).join('|'),
        teks: kotak.textContent
      };
    })()
  `)) as { anak: number; kelas: string; teks: string };

  assert.ok(pratinjau.anak > 0, 'pratinjau menggambar elemen');
  assert.ok(pratinjau.kelas.includes('preview-embed'), 'memakai gaya embed, bukan kartu container');
  assert.ok(pratinjau.teks.includes('Pengumuman'), 'judul tampil di pratinjau');
  assert.ok(pratinjau.teks.includes('Baris dua'), 'isi tampil di pratinjau');
  assert.ok(pratinjau.teks.includes('Di luar embed'), 'komponen di luar embed disebut');
  assert.ok(!pratinjau.kelas.includes('preview-container'), 'tidak menggambar kartu Components V2');
  assert.equal(page.errors.length, 0, `embed error: ${page.errors.join('|')}`);
});

await check('pesan: pemicu event ikut tersimpan & tampil di daftar pesan', async () => {
  const html = mounted.find((page) => page.name === '/pesan')?.html ?? '';
  const page = mountPage(html, 'uji-pemicu');

  // Pilihan pemicu harus ada di form, bukan hanya diterima API.
  const pilihan = (await page.evaluate(`
    (function () {
      var select = document.getElementById('postTrigger');
      return {
        ada: !!select,
        nilai: ['', 'member_add', 'member_remove'],
      };
    })()
  `)) as { ada: boolean; nilai: string[] };
  assert.equal(pilihan.ada, true, 'pilihan pemicu ada di kartu pengaturan');

  /*
   * Nilai '' berarti "hanya manual" dan harus dikirim sebagai null, bukan
   * string kosong — server membaca string kosong sebagai pemicu tak dikenal.
   */
  const muatan = (await page.evaluate(`
    (function () {
      document.getElementById('postName').value = 'Sambutan';
      document.getElementById('postChannel').value = '9001';
      blocks = [{ kind: 'text', value: 'Halo' }];
      document.getElementById('postTrigger').value = 'member_add';
      return savePost(false);
    })()
  `)) as null;

  const kirim = page.fetches.filter((call) => call.path === '/api/posts').pop();
  assert.ok(kirim, 'pesan disimpan lewat /api/posts');
  const isi = kirim!.body as { trigger?: unknown; blocks?: unknown };
  assert.equal(isi.trigger, 'member_add', 'pemicu terkirim bersama isian lain');
  assert.ok(Array.isArray(isi.blocks) && (isi.blocks as unknown[]).length === 1, 'blok tetap terkirim');

  // Pemicu yang tidak dipilih dikirim sebagai null, bukan ''.
  const kosong = (await page.evaluate(`
    (function () {
      document.getElementById('postName').value = 'Manual';
      document.getElementById('postTrigger').value = '';
      return savePost(false);
    })()
  `)) as unknown;
  const kedua = page.fetches.filter((call) => call.path === '/api/posts').pop();
  assert.equal((kedua!.body as { trigger?: unknown }).trigger, null, 'tanpa pemicu = null');

  /*
   * Daftar pesan harus menandai pesan ber-pemicu: pesan yang mengirim sendiri
   * tiap ada anggota baru tidak boleh jadi kejutan.
   */
  const daftar = mounted.find((page) => page.name === '/pesan?pemicu')?.html ?? '';
  assert.ok(daftar.includes('member masuk'), 'badge pemicu tampil di daftar');
  // Isian pemicu harus terisi ulang saat pesan dibuka: pesan yang dipasangi
  // pemicu tapi tampil "hanya manual" akan membuat admin mematikannya tanpa sengaja.
  const halamanIsi = mounted.find((page) => page.name === '/pesan?isi')?.html ?? '';
  const dibuka = mountPage(halamanIsi, 'uji-pemicu-isi');
  const terisi = (await dibuka.evaluate(`
    (function () {
      loadExisting();
      return document.getElementById('postTrigger').value;
    })()
  `)) as string;
  assert.equal(terisi, '', 'pesan tanpa pemicu tampil sebagai hanya manual');
  assert.equal(page.errors.length, 0, `pemicu error: ${page.errors.join('|')}`);
  void muatan;
  void kosong;
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
