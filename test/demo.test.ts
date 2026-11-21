import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contrastRatio, createDispatcher } from '../src/demo.js';

const config = JSON.stringify(['alpha', 'beta', 'gamma'].map(brand => ({ key: `synthetic-${brand}-key`, brands: [brand] })));
test('dispatcher uses Style Dictionary server artifacts and rejects cross-brand access', async () => {
  const d = await createDispatcher(config);
  const tokens = d.dispatch('get_tokens', { brand: 'alpha', mode: 'dark', path: 'semantic.color.background' }, 'synthetic-alpha-key');
  assert.equal(tokens.ok, true); if (tokens.ok) assert.equal(tokens.data.mode, 'dark');
  const result = d.dispatch('get_rule', { brand: 'beta', rule_id: 'beta.canary.unique' }, 'synthetic-alpha-key');
  assert.deepEqual(result, { ok: false, error: { code: 'BRAND_NOT_ALLOWED', message: 'Brand access denied.' } });
  const group = d.dispatch('get_tokens', { brand: 'alpha', mode: 'dark', path: 'semantic.color' }, 'synthetic-alpha-key');
  assert.equal(group.ok, true); if (group.ok) assert.equal(group.data.mode, 'dark');
  const unavailable = d.dispatch('get_tokens', { brand: 'alpha', mode: 'unsupported' }, 'synthetic-alpha-key'); assert.equal(unavailable.ok, false); if (!unavailable.ok) assert.equal(unavailable.error.code, 'MODE_NOT_FOUND');
  const betaDark = d.dispatch('get_tokens', { brand: 'beta', mode: 'dark' }, 'synthetic-beta-key'); assert.equal(betaDark.ok, false); if (!betaDark.ok) assert.equal(betaDark.error.code, 'MODE_NOT_FOUND');
  const canaries = { alpha: 'alpha-orbit-71', beta: 'beta-ember-42', gamma: 'gamma-lattice-93' };
  for (const brand of ['alpha', 'beta', 'gamma'] as const) { const own = d.dispatch('get_rule', { brand, topic: 'canary' }, `synthetic-${brand}-key`); assert.equal(own.ok, true); if (own.ok) { const serialized = JSON.stringify(own); assert.match(serialized, new RegExp(canaries[brand])); for (const foreign of ['alpha', 'beta', 'gamma'].filter(item => item !== brand) as (keyof typeof canaries)[]) { assert.doesNotMatch(serialized, new RegExp(`${foreign}\\.canary\\.unique|${canaries[foreign]}`)); const canary = d.dispatch('get_rule', { brand, rule_id: `${foreign}.canary.unique` }, `synthetic-${brand}-key`); assert.equal(canary.ok, false); if (!canary.ok) assert.equal(canary.error.code, 'RULE_NOT_FOUND'); } } }
  const bad = d.dispatch('get_tokens', { brand: 'alpha' }, 'malformed-key');
  assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.error.code, 'UNAUTHORIZED');
});
test('WCAG fixture colors retain normal and large verdicts', async () => {
  const d = await createDispatcher(config);
  const pass = d.dispatch('check_color_pair', { brand: 'alpha', fg: 'semantic.color.text', bg: 'semantic.color.background', text_size: 'normal' }, 'synthetic-alpha-key');
  assert.equal(pass.ok, true); if (pass.ok) assert.equal(pass.data.pass, true);
});

test('production WCAG math matches every documented vector', () => {
  const vectors = JSON.parse(readFileSync('fixtures/wcag-contrast-vectors.json', 'utf8')).vectors as { foreground: string; background: string; ratio: number; expected: { normal: string; large: string } }[];
  const rgb = (hex: string) => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  for (const vector of vectors) { const ratio = contrastRatio(rgb(vector.foreground), rgb(vector.background)); assert.ok(Math.abs(ratio - vector.ratio) < 1e-12); assert.equal(ratio >= 4.5 ? 'pass' : 'fail', vector.expected.normal); assert.equal(ratio >= 3 ? 'pass' : 'fail', vector.expected.large); }
});
