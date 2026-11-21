import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSnapshots, markdownChangelog } from '../src/changelog.js';
test('token and rule-only changes are deterministic major changes', () => {
  const before = { tokens: { color: { $value: '#000' } }, rules: [{ id: 'alpha.rule', reason: 'old' }] };
  const result = compareSnapshots(before, { ...before, rules: [{ id: 'alpha.rule', reason: 'new' }] });
  assert.deepEqual(result, { version: 'major', changes: [{ kind: 'rule', path: 'alpha.rule', change: 'changed' }] });
  assert.equal(compareSnapshots(before, { ...before, tokens: { color: { $value: '#fff' } } }).version, 'major');
  assert.match(markdownChangelog('0.1.0', before, { ...before, rules: [{ id: 'alpha.rule', reason: 'new' }] }), /## 1\.0\.0[\s\S]*rule changed/);
  assert.match(markdownChangelog('0.1.0', before, before), /## 0\.1\.0/);
});
