/**
 * Uji end-to-end streaming + rantai fallback TANPA API key asli.
 *
 * Menyalakan dua server HTTP tiruan yang meniru API OpenAI-compatible:
 *   - Server "utama" (port 4101) selalu menjawab 429 rate limit.
 *   - Server "fallback" (port 11434, dikenali sebagai `ollama`) menjawab normal,
 *     baik mode JSON biasa maupun mode streaming (SSE).
 *
 * Jalankan: npm run test:fallback
 */
process.env.DISCORD_TOKEN = 'fallback-check-token-0000000000';
// GUILD_ID wajib sejak bot jadi single-server.
process.env.GUILD_ID = '123456789012345678';
process.env.DASHBOARD_TOKEN = 'fallback-check-dashboard-000';
process.env.CLIENT_ID = '123456789012345678';
process.env.AI_API_KEY = 'fake-primary-key-123456';
process.env.AI_BASE_URL = 'http://127.0.0.1:4101/v1';
process.env.AI_MODEL = 'primary-model';
process.env.AI_FALLBACKS = 'ollama:llama3.1';
process.env.DATABASE_PATH = ':memory:';

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

const PRIMARY_PORT = 4101;
const FALLBACK_PORT = 11434;

type Mode = 'ok' | 'context-too-long' | 'stream' | 'stream-tool' | 'token-cap' | 'empty';

interface ServerState {
  mode: Mode;
  requests: number;
  lastBody: { stream?: boolean; messages?: Array<{ content: string }>; model?: string; max_tokens?: number } | null;
}

interface FakeServer {
  server: Server;
  state: ServerState;
}

interface StreamChunk {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
  finish?: string | null;
}

type FakeReply = { status: number; body: unknown } | { stream: StreamChunk[] };

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => resolve(data));
  });

const sseChunk = (chunk: StreamChunk): string => {
  const payload = {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'llama3.1',
    choices: [
      {
        index: 0,
        delta: {
          ...(chunk.content ? { content: chunk.content } : {}),
          ...(chunk.tool_calls ? { tool_calls: chunk.tool_calls } : {}),
        },
        finish_reason: chunk.finish ?? null,
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
};

function startFakeServer(port: number, handler: (state: ServerState) => FakeReply): Promise<FakeServer> {
  const state: ServerState = { mode: 'ok', requests: 0, lastBody: null };

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    state.requests += 1;
    const raw = await readBody(request);
    try {
      state.lastBody = raw ? JSON.parse(raw) : null;
    } catch {
      state.lastBody = null;
    }

    const reply = handler(state);

    if ('stream' in reply) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      for (const chunk of reply.stream) response.write(sseChunk(chunk));
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }

    response.writeHead(reply.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply.body));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, state }));
  });
}

const completion = (model: string, content: string) => ({
  id: 'chatcmpl-fake',
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 },
});

const rateLimited = { error: { message: 'Rate limit reached for model', type: 'rate_limit_error' } };
const contextTooLong = {
  error: {
    message: "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.",
    type: 'invalid_request_error',
  },
};

function fallbackReply(state: ServerState): FakeReply {
  switch (state.mode) {
    case 'context-too-long':
      return { status: 400, body: contextTooLong };
    case 'empty':
      // Model reasoning bisa menghabiskan jatah token untuk berpikir lalu
      // mengembalikan isi kosong dengan status 200.
      return { status: 200, body: completion('llama3.1', '') };
    case 'stream':
      return {
        stream: [
          { content: 'Halo' },
          { content: ' dari' },
          { content: ' provider' },
          { content: ' fallback' },
          { content: ' (stream).' },
          { finish: 'stop' },
        ],
      };
    case 'stream-tool':
      return {
        stream: [
          {
            tool_calls: [
              { index: 0, id: 'call_abc', function: { name: 'simpan_memori', arguments: '{"fakta":"' } },
            ],
          },
          { tool_calls: [{ index: 0, function: { arguments: 'Namanya Bagas."}' } }] },
          { finish: 'tool_calls' },
        ],
      };
    default:
      return { status: 200, body: completion('llama3.1', 'Halo! Aku menjawab dari provider fallback.') };
  }
}

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    console.error(`  ❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log('\n🔁 Uji fallback + streaming (server tiruan)\n');

  // Server utama bisa berganti perilaku per skenario.
  const primary = await startFakeServer(PRIMARY_PORT, (state) => {
    switch (state.mode) {
      case 'token-cap':
        // Provider hanya menolak kalau kita meminta lebih dari 1024 token.
        if ((state.lastBody?.max_tokens ?? 0) > 1024) {
          return {
            status: 400,
            body: { error: { message: 'max_tokens must be less than or equal to 1024', type: 'invalid_request_error' } },
          };
        }
        return { status: 200, body: completion('primary-model', 'Jawaban dari provider utama.') };
      case 'empty':
        return { status: 200, body: completion('primary-model', '') };
      default:
        return { status: 429, body: rateLimited };
    }
  });
  const fallback = await startFakeServer(FALLBACK_PORT, fallbackReply);

  const { chat, streamChat, AiError, resetTokenCaps } = await import('../src/lib/llm.js');

  try {
    /* ---------- 1. Non-streaming: 429 di utama -> fallback ---------- */
    console.log('Non-streaming');
    const result = await chat({ messages: [{ role: 'user', content: 'Halo, kamu siapa?' }] });

    check('provider utama dicoba lebih dulu (dan gagal)', () => {
      // Rate limit tidak sembuh dalam milidetik: kalau ada provider cadangan,
      // langsung pindah. Sebelumnya bot menunggu 400ms + 800ms sia-sia.
      assert.equal(primary.state.requests, 1, 'tidak menunggu backoff saat masih ada fallback');
    });
    check('jawaban berasal dari provider fallback', () => {
      assert.equal(result.provider, 'ollama');
      assert.equal(result.model, 'llama3.1');
      assert.match(result.message.content ?? '', /fallback/);
    });
    check('payload diteruskan utuh ke fallback', () => {
      assert.equal(fallback.state.lastBody?.model, 'llama3.1');
      assert.equal(fallback.state.lastBody?.messages?.[0]?.content, 'Halo, kamu siapa?');
    });

    /* ---------- 2. Error fatal: jangan retry sia-sia ---------- */
    console.log('\nError fatal');
    fallback.state.mode = 'context-too-long';
    const requestsBefore = fallback.state.requests;

    let caught: unknown = null;
    try {
      await chat({ messages: [{ role: 'user', content: 'A' }] });
    } catch (error) {
      caught = error;
    }

    check('prompt kepanjangan -> berhenti & minta /reset', () => {
      assert.ok(caught instanceof AiError, 'harus melempar AiError');
      assert.match((caught as Error).message, /terlalu panjang/i);
      assert.match((caught as Error).message, /reset/i);
      assert.equal((caught as Error & { fatal?: boolean }).fatal, true);
    });
    check('tidak retry sia-sia setelah error fatal', () => {
      assert.equal(fallback.state.requests - requestsBefore, 1, 'hanya satu request, tanpa retry');
    });

    /* ---------- 3. Streaming: delta diterima bertahap, tetap fallback ---------- */
    console.log('\nStreaming');
    fallback.state.mode = 'stream';
    const deltas: string[] = [];
    const streamed = await streamChat(
      { messages: [{ role: 'user', content: 'Ceritakan sesuatu' }] },
      { onDelta: (delta) => deltas.push(delta) },
    );

    check('stream memakai provider fallback', () => {
      assert.equal(streamed.provider, 'ollama');
    });
    check('delta diterima bertahap (bukan sekali kirim)', () => {
      assert.equal(deltas.length, 5, `harus 5 potongan, dapat ${deltas.length}`);
      assert.equal(deltas.join(''), 'Halo dari provider fallback (stream).');
      assert.equal((streamed.message.content ?? '').trim(), 'Halo dari provider fallback (stream).');
    });
    check('permintaan streaming benar-benar memakai stream: true', () => {
      assert.equal(fallback.state.lastBody?.stream, true);
    });

    /* ---------- 4. Tool call yang datang sebagai delta ---------- */
    console.log('\nTool calling saat streaming');
    fallback.state.mode = 'stream-tool';
    const toolResult = await streamChat(
      {
        messages: [{ role: 'user', content: 'Namaku Bagas' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'simpan_memori',
              description: 'simpan fakta',
              parameters: { type: 'object', properties: { fakta: { type: 'string' } }, required: ['fakta'] },
            },
          },
        ],
      },
      { onDelta: () => undefined },
    );

    check('tool_calls hasil streaming terangkai utuh', () => {
      const calls = toolResult.message.tool_calls;
      assert.ok(calls && calls.length === 1, 'harus ada satu tool call');
      assert.equal(calls[0]?.function.name, 'simpan_memori');
      assert.equal(calls[0]?.function.arguments, '{"fakta":"Namanya Bagas."}');
      assert.equal(calls[0]?.id, 'call_abc');
    });
    check('argumen tool valid sebagai JSON', () => {
      const parsed = JSON.parse(toolResult.message.tool_calls?.[0]?.function.arguments ?? '{}') as { fakta?: string };
      assert.equal(parsed.fakta, 'Namanya Bagas.');
    });
    /* ---------- 5. Provider menolak max_tokens -> ulang di provider yang sama ---------- */
    console.log('\nPlafon max_tokens');
    fallback.state.mode = 'ok';
    primary.state.mode = 'token-cap';
    primary.state.requests = 0;
    resetTokenCaps();

    const capped = await chat({ messages: [{ role: 'user', content: 'Halo' }], maxTokens: 8192 });

    check('plafon token diulang di provider yang sama, bukan lompat fallback', () => {
      assert.equal(capped.provider, 'custom', 'tetap dijawab provider utama');
      assert.equal(capped.message.content, 'Jawaban dari provider utama.');
      assert.equal(primary.state.requests, 2, 'sekali ditolak, sekali dengan angka aman');
    });
    check('angka yang dikirim sudah turun ke plafon provider', () => {
      assert.equal(primary.state.lastBody?.max_tokens, 1024);
    });

    // Permintaan berikutnya harus langsung memakai angka aman — jangan membuat
    // user menunggu penolakan yang sama berulang kali.
    primary.state.requests = 0;
    await chat({ messages: [{ role: 'user', content: 'Halo lagi' }], maxTokens: 8192 });
    check('plafon diingat untuk permintaan berikutnya', () => {
      assert.equal(primary.state.requests, 1, 'tidak ditolak lagi');
      assert.equal(primary.state.lastBody?.max_tokens, 1024);
    });

    /* ---------- 6. Balasan kosong -> provider berikutnya, bukan teks kosong ---------- */
    console.log('\nBalasan kosong');
    resetTokenCaps();
    primary.state.mode = 'empty';
    fallback.state.mode = 'ok';
    fallback.state.requests = 0;

    const rescued = await chat({ messages: [{ role: 'user', content: 'Halo' }], maxTokens: 700 });
    check('provider kosong dilewati, fallback menjawab', () => {
      assert.equal(rescued.provider, 'ollama');
      assert.match(rescued.message.content ?? '', /fallback/);
      assert.equal(fallback.state.requests, 1);
    });

    // Kalau semua provider kosong, user harus menerima error yang menjelaskan —
    // bukan jawaban kosong yang membingungkan.
    fallback.state.mode = 'empty';
    let emptyError: unknown = null;
    try {
      await chat({ messages: [{ role: 'user', content: 'Halo' }] });
    } catch (error) {
      emptyError = error;
    }
    check('semua provider kosong -> error jelas, bukan jawaban kosong', () => {
      assert.ok(emptyError instanceof AiError, 'harus melempar AiError');
      assert.match((emptyError as Error).message, /tidak tersedia/i);
      assert.match((emptyError as Error).message, /2 dicoba/i);
    });
  } finally {
    primary.server.close();
    fallback.server.close();
  }

  console.log(`\n${process.exitCode ? '❌ Ada skenario gagal' : '🎉 Fallback & streaming bekerja'} — ${passed} pemeriksaan.\n`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
