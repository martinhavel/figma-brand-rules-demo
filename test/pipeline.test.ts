import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBrandArtifacts, convertFigmaToDtcg, PipelineError, type FigmaExport } from '../src/pipeline.js';

const fixture = (brand: string) => JSON.parse(readFileSync(join(process.cwd(), 'fixtures', brand, 'figma-variables-local.json'), 'utf8')) as FigmaExport;

function aseColorRecordCount(ase: Buffer) {
  assert.equal(ase.subarray(0, 4).toString('ascii'), 'ASEF');
  const declared = ase.readUInt32BE(8);
  let offset = 12;
  let colors = 0;
  for (let index = 0; index < declared; index += 1) {
    assert.equal(ase.readUInt16BE(offset), 1);
    const size = ase.readUInt32BE(offset + 2);
    const nameLength = ase.readUInt16BE(offset + 6);
    const colorModelOffset = offset + 8 + nameLength * 2;
    assert.equal(ase.subarray(colorModelOffset, colorModelOffset + 4).toString('ascii'), 'RGB ');
    colors += 1;
    offset += 6 + size;
  }
  assert.equal(offset, ase.length);
  return colors;
}

test('actual Style Dictionary v5 formats DTCG for every brand and mode', async () => {
  const alphaLight = await buildBrandArtifacts('alpha', 'light');
  const alphaDark = await buildBrandArtifacts('alpha', 'dark');
  const beta = await buildBrandArtifacts('beta');
  const gamma = await buildBrandArtifacts('gamma');
  for (const artifact of [alphaLight, alphaDark, beta, gamma]) {
    assert.match(artifact.css, /:root\[data-brand=/);
    assert.match(artifact.css, /--primitive-color-background:/);
    assert.doesNotMatch(artifact.css, /\[object Object\]/);
    assert.match(artifact.css, /--semantic-typography-body: 400 16px\/1\.5 Inter;/);
    assert.equal(aseColorRecordCount(artifact.ase), 4);
    assert.equal(artifact.serverJson.version, '0.1.0');
    assert.ok(artifact.serverJson.rules.length > 0);
  }
  assert.notEqual(alphaLight.css, alphaDark.css);
  assert.deepEqual((alphaLight.dtcg.semantic as Record<string, unknown>).typography, JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'dtcg-typography.expected.json'), 'utf8')).semantic.typography);
  const semantic = alphaDark.serverJson.tokens.semantic as Record<string, Record<string, { $value: unknown }>>;
  assert.deepEqual(semantic.color.background.$value, { colorSpace: 'srgb', components: [0.0470588235, 0.0705882353, 0.1176470588], alpha: 1 });
  assert.deepEqual(semantic.typography.body.$value, { fontFamily: 'Inter', fontSize: { value: 16, unit: 'px' }, fontWeight: 400, letterSpacing: { value: 0, unit: 'px' }, lineHeight: 1.5 });
});

test('converter rejects a broken alias, an alias cycle, and a missing selected-mode value', () => {
  assert.throws(() => convertFigmaToDtcg(fixture('alpha'), 'unsupported'), (error: unknown) => error instanceof PipelineError && error.code === 'MODE_NOT_FOUND');
  const broken = fixture('alpha');
  broken.meta.variables['alpha-semantic-bg'].valuesByMode['alpha-semantic-light'] = { type: 'VARIABLE_ALIAS', id: 'no-such-variable' };
  assert.throws(() => convertFigmaToDtcg(broken, 'light'), (error: unknown) => error instanceof PipelineError && error.code === 'BROKEN_ALIAS');

  const cycle = fixture('alpha');
  cycle.meta.variables['alpha-bg'].valuesByMode['alpha-light'] = { type: 'VARIABLE_ALIAS', id: 'alpha-semantic-bg' };
  assert.throws(() => convertFigmaToDtcg(cycle, 'light'), (error: unknown) => error instanceof PipelineError && error.code === 'ALIAS_CYCLE');

  const missing = fixture('alpha');
  delete missing.meta.variables['alpha-bg'].valuesByMode['alpha-dark'];
  assert.throws(() => convertFigmaToDtcg(missing, 'dark'), (error: unknown) => error instanceof PipelineError && error.code === 'MISSING_MODE_VALUE');
});

test('imported variable paths cannot traverse shared prototypes', () => {
  for (const name of ['__proto__/mar285Polluted', 'constructor/prototype/mar285Polluted', 'primitive/__proto__/mar285Polluted', 'toString/mar285Polluted']) {
    const input = fixture('alpha');
    input.meta.variables['alpha-bg'].name = name;
    assert.throws(() => convertFigmaToDtcg(input, 'light'),
      (error: unknown) => error instanceof PipelineError && error.code === 'INVALID_VALUE');
    assert.equal(Object.hasOwn(Object.prototype, 'mar285Polluted'), false);
  }
});
