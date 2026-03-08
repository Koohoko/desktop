import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('mcp-server registers agentify_* tools only', async () => {
  const src = await fs.readFile(path.join(__dirname, '..', 'mcp-server.mjs'), 'utf8');

  assert.ok(src.includes("'agentify_query'"), 'expected agentify_query tool');
  assert.ok(src.includes("'agentify_download_images'"), 'expected agentify_download_images tool');

  assert.ok(!src.includes('browser_'), 'should not contain browser_* tools/aliases');
  assert.ok(!src.includes('registerToolWithAliases'), 'should not contain alias helper');
});

test('mcp-server documents model label in agentify_status', async () => {
  const src = await fs.readFile(path.join(__dirname, '..', 'mcp-server.mjs'), 'utf8');
  assert.match(src, /model label/i);
});

test('mcp-server forwards MCP cancellation signal to local HTTP requests', async () => {
  const src = await fs.readFile(path.join(__dirname, '..', 'mcp-server.mjs'), 'utf8');
  assert.match(src, /async \(\{ model, tabId, key, prompt, attachments, timeoutMs \}, extra\) =>/);
  assert.match(src, /signal:\s*extra\.signal/);
});
