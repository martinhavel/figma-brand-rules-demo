import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createRestServer } from '../src/demo.js';

const config = JSON.stringify([{ key: 'synthetic-alpha-key', brands: ['alpha'] }]);
const calls = [
  ['get_tokens', { brand: 'alpha', mode: 'dark', path: 'semantic.color' }],
  ['get_rule', { brand: 'alpha', rule_id: 'alpha.contrast.aa' }],
  ['check_color_pair', { brand: 'alpha', fg: 'semantic.color.text', bg: 'semantic.color.background', text_size: 'normal' }],
] as const;

test('raw stdio MCP and loopback REST return identical envelopes', async () => {
  const server = await createRestServer(config); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const child = spawn(process.execPath, ['dist/src/main.js'], { cwd: process.cwd(), env: { ...process.env, BRAND_API_KEYS: config, BRAND_API_KEY: 'synthetic-alpha-key' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout }); let next = 1; const pending = new Map<number, (value: Record<string, unknown>) => void>();
  lines.on('line', line => { const message = JSON.parse(line) as { id?: number }; if (typeof message.id === 'number') pending.get(message.id)?.(message as Record<string, unknown>); });
  const request = (method: string, params: unknown) => new Promise<Record<string, unknown>>((resolve, reject) => { const id = next++; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 5000); pending.set(id, value => { clearTimeout(timer); pending.delete(id); resolve(value); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'node-test', version: '1' } }); assert.ok(initialized.result);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const listed = await request('tools/list', {}); assert.deepEqual((listed.result as { tools: { name: string }[] }).tools.map(tool => tool.name).sort(), ['check_color_pair', 'get_rule', 'get_tokens']);
    for (const [name, input] of calls) {
      const rest = await fetch(`http://127.0.0.1:${port}/tools/${name}`, { method: 'POST', headers: { authorization: 'Bearer synthetic-alpha-key', 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const mcp = await request('tools/call', { name, arguments: input });
      const body = await rest.json() as { ok: boolean; data?: Record<string, unknown> }; assert.equal(rest.status, 200); assert.equal(body.ok, true); assert.equal((mcp.result as { isError?: boolean }).isError, false); assert.deepEqual((mcp.result as { structuredContent: unknown }).structuredContent, body);
      if (name === 'get_tokens') assert.deepEqual(body.data?.token, { background: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.0470588235, 0.0705882353, 0.1176470588], alpha: 1 } }, text: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1 } } });
      if (name === 'get_rule') assert.equal((body.data?.rules as { id: string; reason: string; source: string }[])[0].id, 'alpha.contrast.aa');
      if (name === 'check_color_pair') { assert.equal(body.data?.pass, true); assert.equal(body.data?.rule_id, 'alpha.contrast.aa'); assert.equal(body.data?.evidence && (body.data.evidence as { ratio: number }).ratio, 21); }
    }
    const denied = { brand: 'beta', rule_id: 'beta.canary.unique' }; const rest = await fetch(`http://127.0.0.1:${port}/tools/get_rule`, { method: 'POST', headers: { authorization: 'Bearer synthetic-alpha-key', 'content-type': 'application/json' }, body: JSON.stringify(denied) }); const mcp = await request('tools/call', { name: 'get_rule', arguments: denied }); const deniedBody = await rest.json(); assert.equal(rest.status, 403); assert.deepEqual(deniedBody, { ok: false, error: { code: 'BRAND_NOT_ALLOWED', message: 'Brand access denied.' } }); assert.equal((mcp.result as { isError?: boolean }).isError, true); assert.deepEqual((mcp.result as { structuredContent: unknown }).structuredContent, deniedBody);
    const extra = { brand: 'alpha', rule_id: 'alpha.contrast.aa', extra: true }; const strictRest = await fetch(`http://127.0.0.1:${port}/tools/get_rule`, { method: 'POST', headers: { authorization: 'Bearer synthetic-alpha-key', 'content-type': 'application/json' }, body: JSON.stringify(extra) }); assert.equal(strictRest.status, 400); assert.deepEqual(await strictRest.json(), { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid arguments.' } }); const strictMcp = await request('tools/call', { name: 'get_rule', arguments: extra }); assert.equal((strictMcp.result as { isError?: boolean }).isError, true);
    const unknown = await fetch(`http://127.0.0.1:${port}/tools/nope`, { method: 'POST', headers: { authorization: 'Bearer synthetic-alpha-key' } }); assert.equal(unknown.status, 404); assert.deepEqual(await unknown.json(), { ok: false, error: { code: 'TOOL_NOT_FOUND', message: 'Tool not found.' } });
    const duplicate = await new Promise<{ status: number; body: unknown }>((resolve, reject) => { const req = httpRequest(`http://127.0.0.1:${port}/tools/get_rule`, { method: 'POST', headers: ['Host', `127.0.0.1:${port}`, 'Authorization', 'Bearer synthetic-alpha-key', 'Authorization', 'Bearer malformed-key', 'Content-Type', 'application/json'] }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) })); }); req.on('error', reject); req.end(JSON.stringify({ brand: 'alpha', rule_id: 'alpha.contrast.aa' })); }); assert.equal(duplicate.status, 401); assert.deepEqual(duplicate.body, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
  } finally { lines.close(); child.kill(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
