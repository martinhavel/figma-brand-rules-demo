import StyleDictionary from 'style-dictionary';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesignTokens, FormatFnArguments } from 'style-dictionary/types';

export const PACKAGE_VERSION = '0.1.0';

type FigmaAlias = { type: 'VARIABLE_ALIAS'; id: string };
type FigmaColor = { r: number; g: number; b: number; a?: number };
type FigmaValue = FigmaAlias | FigmaColor | number | string;
export type FigmaVariable = {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING';
  valuesByMode: Record<string, FigmaValue>;
  description?: string;
};
export type FigmaCollection = {
  id: string;
  modes: { modeId: string; name: string }[];
  defaultModeId: string;
  variableIds: string[];
};
export type FigmaExport = {
  meta: { variables: Record<string, FigmaVariable>; variableCollections: Record<string, FigmaCollection> };
};
type Token = { $type: string; $value: unknown; $description?: string };
export type DtcgTree = Record<string, unknown>;
export type PipelineArtifacts = {
  dtcg: DtcgTree;
  css: string;
  serverJson: { brand: string; mode: string; version: string; sourcePaths: string[]; rules: unknown[]; tokens: DtcgTree };
  ase: Buffer;
};

export class PipelineError extends Error {
  constructor(readonly code: 'UNKNOWN_BRAND' | 'MODE_NOT_FOUND' | 'MISSING_MODE_VALUE' | 'BROKEN_ALIAS' | 'ALIAS_CYCLE' | 'INVALID_VALUE', message: string) {
    super(message);
  }
}

const brands = new Set(['alpha', 'beta', 'gamma']);
const sourcePath = (brand: string) => `fixtures/${brand}/figma-variables-local.json`;
const tokenPath = (name: string) => name.split('/').join('.');
const isAlias = (value: FigmaValue): value is FigmaAlias => typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS';
const isColor = (value: FigmaValue): value is FigmaColor => typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value;

function setPath(tree: DtcgTree, path: string[], token: Token) {
  if (path.length === 0 || path.some(segment => !segment || /[.{}]/.test(segment) ||
      ['__proto__', 'constructor', 'prototype'].includes(segment) || Object.hasOwn(Object.prototype, segment))) {
    throw new PipelineError('INVALID_VALUE', 'Unsafe token path.');
  }
  let cursor: DtcgTree = tree;
  for (const segment of path.slice(0, -1)) {
    const child = Object.hasOwn(cursor, segment) ? cursor[segment] : undefined;
    if (!child || typeof child !== 'object' || Array.isArray(child)) cursor[segment] = {};
    cursor = cursor[segment] as DtcgTree;
  }
  cursor[path.at(-1)!] = token;
}

function getPath(tree: DtcgTree, path: string): Token {
  let cursor: unknown = tree;
  for (const segment of path.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !Object.hasOwn(cursor, segment)) {
      throw new PipelineError('BROKEN_ALIAS', 'Token reference does not exist.');
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor as Token;
}

function typeFor(variable: FigmaVariable): Token['$type'] {
  if (variable.resolvedType === 'COLOR') return 'color';
  if (variable.resolvedType === 'STRING') return 'fontFamily';
  if (variable.name.endsWith('/fontWeight')) return 'fontWeight';
  if (variable.name.endsWith('/lineHeight')) return 'number';
  if (variable.name.includes('/spacing/') || variable.name.includes('/radius/') || variable.name.endsWith('/fontSize') || variable.name.endsWith('/letterSpacing')) return 'dimension';
  return 'number';
}

function dtcgValue(value: FigmaValue, type: string): unknown {
  if (isColor(value)) {
    if (![value.r, value.g, value.b, value.a ?? 1].every(Number.isFinite)) throw new PipelineError('INVALID_VALUE', 'Invalid Figma color value.');
    return { colorSpace: 'srgb', components: [value.r, value.g, value.b], alpha: value.a ?? 1 };
  }
  if (typeof value === 'number') return type === 'dimension' ? { value, unit: 'px' } : value;
  if (typeof value === 'string') return value;
  throw new PipelineError('INVALID_VALUE', 'Unsupported Figma value.');
}

function selectedMode(collection: FigmaCollection, requestedMode?: string) {
  const defaultMode = collection.modes.find(mode => mode.modeId === collection.defaultModeId);
  const desired = requestedMode ?? defaultMode?.name;
  const mode = collection.modes.find(item => item.name === desired || item.modeId === desired);
  if (!mode) throw new PipelineError('MODE_NOT_FOUND', `Mode ${String(desired)} is not available in collection ${collection.id}.`);
  return mode;
}

/** Converts one selected Figma mode to a DTCG 2025.10 token tree without resolving aliases. */
export function convertFigmaToDtcg(input: FigmaExport, requestedMode?: string): { dtcg: DtcgTree; mode: string } {
  const { variables, variableCollections } = input.meta;
  const byId = variables;
  const variableMode = new Map<string, { modeId: string; name: string }>();
  for (const variable of Object.values(variables)) {
    const collection = variableCollections[variable.variableCollectionId];
    if (!collection || !collection.variableIds.includes(variable.id)) throw new PipelineError('INVALID_VALUE', `Invalid collection membership for ${variable.id}.`);
    variableMode.set(variable.id, selectedMode(collection, requestedMode));
  }

  const visit = (id: string, stack: string[] = []): void => {
    if (stack.includes(id)) throw new PipelineError('ALIAS_CYCLE', `Alias cycle: ${[...stack, id].join(' -> ')}.`);
    const variable = byId[id];
    if (!variable) throw new PipelineError('BROKEN_ALIAS', `Alias target ${id} does not exist.`);
    const mode = variableMode.get(id)!;
    const value = variable.valuesByMode[mode.modeId];
    if (value === undefined) throw new PipelineError('MISSING_MODE_VALUE', `Variable ${id} has no value for mode ${mode.name}.`);
    if (isAlias(value)) visit(value.id, [...stack, id]);
  };

  const dtcg: DtcgTree = {};
  let modeName: string | undefined;
  for (const variable of Object.values(variables)) {
    const mode = variableMode.get(variable.id)!;
    modeName ??= mode.name;
    if (mode.name !== modeName) throw new PipelineError('MODE_NOT_FOUND', 'Collections do not share the selected mode name.');
    const value = variable.valuesByMode[mode.modeId];
    if (value === undefined) throw new PipelineError('MISSING_MODE_VALUE', `Variable ${variable.id} has no value for mode ${mode.name}.`);
    visit(variable.id);
    const type = typeFor(variable);
    const token: Token = {
      $type: type,
      $value: isAlias(value) ? `{${tokenPath(byId[value.id].name)}}` : dtcgValue(value, type),
      ...(variable.description ? { $description: variable.description } : {}),
    };
    setPath(dtcg, variable.name.split('/'), token);
  }

  // Figma stores the five typography fields independently; DTCG requires one complete typography value.
  const typographyParts = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'];
  for (const part of typographyParts) getPath(dtcg, `primitive.typography.${part}`);
  setPath(dtcg, ['semantic', 'typography', 'body'], {
    $type: 'typography',
    $value: Object.fromEntries(typographyParts.map(part => [part, `{primitive.typography.${part}}`])),
  });
  return { dtcg, mode: modeName! };
}

const u16 = (value: number) => Buffer.from([value >>> 8, value & 0xff]);
const u32 = (value: number) => Buffer.from([value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
function aseColor(name: string, value: unknown) {
  const components = typeof value === 'string'
    ? (() => {
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
      if (!hex) return undefined;
      const expanded = hex.length === 3 ? [...hex].map(character => character + character).join('') : hex;
      return [0, 2, 4].map(offset => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);
    })()
    : value && typeof value === 'object' && (value as { colorSpace?: string }).colorSpace === 'srgb'
      ? (value as { components?: unknown[] }).components
      : undefined;
  if (!components || components.length !== 3 || !components.every(component => typeof component === 'number')) throw new PipelineError('INVALID_VALUE', 'ASE supports only resolved sRGB color tokens.');
  const label = Buffer.concat([...`${name}\0`].map(character => u16(character.charCodeAt(0))));
  const rgb = Buffer.alloc(12);
  components.forEach((component, index) => rgb.writeFloatBE(component as number, index * 4));
  const body = Buffer.concat([u16(name.length + 1), label, Buffer.from('RGB '), rgb, u16(0)]);
  return Buffer.concat([u16(1), u32(body.length), body]);
}

function aseFormat({ dictionary }: FormatFnArguments) {
  const records = dictionary.allTokens
    .filter(token => token.original.$type === 'color')
    // $value is Style Dictionary's resolved CSS transform, so semantic aliases become swatches too.
    .map(token => aseColor(token.name, token.$value));
  return Buffer.concat([Buffer.from('ASEF'), u16(1), u16(0), u32(records.length), ...records]);
}

function cssFormat(selector: string) {
  return ({ dictionary }: FormatFnArguments) => {
    const declarations = dictionary.allTokens.flatMap(token => {
      const name = `--${token.path.join('-')}`;
      if (token.$type === 'typography') {
        const typography = String(token.$value);
        // SD's CSS transforms resolve its component aliases into a valid font shorthand.
        return [`  ${name}: ${typography};`];
      }
      return [`  ${name}: ${String(token.$value)};`];
    });
    return `${selector} {\n${declarations.join('\n')}\n}\n`;
  };
}

function serverJsonFormat(metadata: Omit<PipelineArtifacts['serverJson'], 'tokens'>) {
  return ({ dictionary }: FormatFnArguments) => {
    const tokens: DtcgTree = {};
    for (const token of dictionary.allTokens) {
      // This is a serialization of SD's resolved token map, not an alias resolver.
      setPath(tokens, token.path, { $type: token.$type ?? '', $value: token.$value });
    }
    return JSON.stringify({ ...metadata, tokens }, null, 2);
  };
}

function loadFixture(brand: string): FigmaExport {
  if (!brands.has(brand)) throw new PipelineError('UNKNOWN_BRAND', `Unknown brand ${brand}.`);
  return JSON.parse(readFileSync(join(process.cwd(), sourcePath(brand)), 'utf8')) as FigmaExport;
}

function loadRules(brand: string): unknown[] {
  return (JSON.parse(readFileSync(join(process.cwd(), 'fixtures', brand, 'rules.json'), 'utf8')) as { rules: unknown[] }).rules;
}

/** Builds all artifact formats from the same DTCG object through Style Dictionary v5 in memory. */
export async function buildBrandArtifacts(brandId: string, requestedMode?: string): Promise<PipelineArtifacts> {
  const { dtcg, mode } = convertFigmaToDtcg(loadFixture(brandId), requestedMode);
  const metadata = { brand: brandId, mode, version: PACKAGE_VERSION, sourcePaths: [sourcePath(brandId), `fixtures/${brandId}/rules.json`], rules: loadRules(brandId) };
  const dictionary = new StyleDictionary({
    tokens: dtcg as DesignTokens,
    usesDtcg: true,
    log: { verbosity: 'silent' },
    hooks: { formats: { ase: aseFormat, css: cssFormat(`:root[data-brand="${brandId}"][data-mode="${mode}"]`), serverJson: serverJsonFormat(metadata) } },
    platforms: {
      css: {
        transformGroup: 'css',
        files: [
          { destination: 'tokens.css', format: 'css' },
          { destination: 'tokens.ase', format: 'ase' },
        ],
      },
      server: { transforms: [], files: [{ destination: 'tokens.json', format: 'serverJson' }] },
    },
  });
  await dictionary.hasInitialized;
  const cssOutputs = await dictionary.formatPlatform('css');
  const serverOutputs = await dictionary.formatPlatform('server');
  const outputFor = (outputs: Awaited<ReturnType<typeof dictionary.formatPlatform>>, destination: string) => outputs.find(item => item.destination?.endsWith(destination))?.output;
  const css = outputFor(cssOutputs, 'tokens.css');
  const ase = outputFor(cssOutputs, 'tokens.ase');
  if (typeof css !== 'string' || !Buffer.isBuffer(ase)) throw new Error('Style Dictionary did not emit the requested artifacts.');
  const serverOutput = outputFor(serverOutputs, 'tokens.json');
  if (typeof serverOutput !== 'string') throw new Error('Style Dictionary JSON format did not run.');
  const serverJson = JSON.parse(serverOutput) as PipelineArtifacts['serverJson'];
  return {
    dtcg,
    css,
    ase,
    serverJson,
  };
}
