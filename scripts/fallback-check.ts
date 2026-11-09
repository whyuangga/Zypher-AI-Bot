/**
 * Uji end-to-end rantai fallback provider TANPA API key asli.
 *
 * Cara kerja: menyalakan dua server HTTP tiruan yang meniru API OpenAI-compatible.
 *   - Server "utama" (port 4101) selalu menjawab 429 rate limit.
 *   - Server "fallback" (port 11434, dikenali sebagai `ollama`) menjawab normal.
 * Lalu memastikan bot benar-benar pindah ke provider kedua.
 *
 * Jalankan: npm run test:fallback
 */
process.env.DISCORD_TOKEN = 'fallback-check-token-0000000000';
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

type Mode = 'ok' | 'context-too-long';

interface FakeServer {
  server: Server;
  state: { mode: Mode; requests: number; lastBody: unknown };
}

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => resolve(data));
  });

function startFakeServer(port: number, handler: (state: FakeServer['state']) => { status: number; body: unknown }): Promise<FakeServer> {
  const state: FakeServer['state'] = { mode: 'ok', requests: 0, lastBody: null };

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    state.requests += 1;
    const raw = await readBody(request);
    try {
      state.lastBody = raw ? JSON.parse(raw) : null;
    } catch {
      state.lastBody = raw;
    }

    const { status, body } = handler(state);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
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
  console.log('\n🔁 Uji fallback provider (server tiruan)\n');

  const primary = await startFakeServer(PRIMARY_PORT, () => ({ status: 429, body: rateLimited }));
  const fallback = await startFakeServer(FALLBACK_PORT, (state) =>
    state.mode === 'context-too-long'
      ? { status: 400, body: contextTooLong }
      : { status: 200, body: completion('llama3.1', 'Halo! Aku menjawab dari provider fallback.') },
  );

  const { chat, AiError } = await import('../src/lib/llm.js');

  try {
    // ---------- Skenario 1: provider utama 429 -> fallback menjawab ----------
    const result = await chat({ messages: [{ role: 'user', content: 'Halo, kamu siapa?' }] });

    check('provider utama dicoba lebih dulu (dan gagal)', () => {
      assert.equal(primary.state.requests, 3, 'harus retry 3x di provider utama sebelum menyerah');
    });
    check('jawaban berasal dari provider fallback', () => {
      assert.equal(result.provider, 'ollama');
      assert.equal(result.model, 'llama3.1');
      assert.match(result.message.content ?? '', /fallback/);
    });
    check('payload diteruskan utuh ke fallback', () => {
      const body = fallback.state.lastBody as { messages?: Array<{ content: string }>; model?: string };
      assert.equal(body.model, 'llama3.1');
      assert.equal(body.messages?.[0]?.content, 'Halo, kamu siapa?');
    });

    // ---------- Skenario 2: error fatal tidak boleh dicoba ke provider lain ----------
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
  } finally {
    primary.server.close();
    fallback.server.close();
  }

  console.log(`\n${process.exitCode ? '❌ Ada skenario gagal' : '🎉 Fallback bekerja'} — ${passed} pemeriksaan.\n`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
