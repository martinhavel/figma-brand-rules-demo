import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccessError, bearerCredential, createAuthorizer } from '../src/auth.js';

test('a synthetic key grants only its configured brands', () => {
  const auth = createAuthorizer(JSON.stringify([{ key: 'synthetic-test-key-alpha', brands: ['alpha'] }]), ['alpha', 'beta']);
  const principal = auth.authenticate('synthetic-test-key-alpha');
  assert.doesNotThrow(() => auth.authorize(principal, 'alpha'));
  for (const brand of ['beta', 'unknown', '../alpha']) {
    assert.throws(() => auth.authorize(principal, brand),
      (error: unknown) => error instanceof AccessError && error.code === 'BRAND_NOT_ALLOWED' && error.message === 'Brand access denied.');
  }
  for (const key of [undefined, '', 'synthetic-wrong-key']) {
    assert.throws(() => auth.authenticate(key),
      (error: unknown) => error instanceof AccessError && error.code === 'UNAUTHORIZED');
  }
});

test('invalid key configuration fails startup without echoing its contents', () => {
  for (const config of [undefined, 'not-json', '[]', '{}',
    JSON.stringify([{ key: '', brands: ['alpha'] }]),
    JSON.stringify([{ key: 'synthetic-config-marker', brands: ['missing'] }]),
    JSON.stringify([{ key: 'synthetic-config-marker', brands: ['*'] }]),
    JSON.stringify([{ key: 'synthetic-config-marker', brands: ['alpha'] }, { key: 'synthetic-config-marker', brands: ['alpha'] }])]) {
    assert.throws(() => createAuthorizer(config, ['alpha']),
      (error: unknown) => error instanceof Error && error.message === 'Invalid BRAND_API_KEYS configuration.');
  }
});

test('HTTP credentials require exactly one Authorization header', () => {
  assert.equal(bearerCredential(['Authorization', 'Bearer synthetic-alpha-key']), 'synthetic-alpha-key');
  assert.equal(bearerCredential([]), undefined);
  assert.equal(bearerCredential(['Authorization', 'Bearer synthetic-alpha-key', 'authorization', 'Bearer synthetic-other-key']), undefined);
  assert.equal(bearerCredential(['Authorization', 'Bearer synthetic-alpha-key', 'Authorization', 'Bearer synthetic-alpha-key']), undefined);
});
