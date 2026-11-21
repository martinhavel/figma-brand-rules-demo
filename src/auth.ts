import { createHash, timingSafeEqual } from 'node:crypto';

export class AccessError extends Error {
  constructor(public readonly code: 'UNAUTHORIZED' | 'BRAND_NOT_ALLOWED') {
    super(code === 'UNAUTHORIZED' ? 'Authentication required.' : 'Brand access denied.');
    this.name = 'AccessError';
  }
}

export interface Principal {
  readonly allowedBrands: ReadonlySet<string>;
}

const digest = (key: string): Buffer => createHash('sha256').update(key).digest();

/** Inspect raw headers because Node normalizes away duplicate Authorization fields. */
export function bearerCredential(rawHeaders: readonly string[]): string | undefined {
  let count = 0;
  let value: string | undefined;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === 'authorization') {
      count += 1;
      value = rawHeaders[index + 1];
    }
  }
  return count === 1 && value?.startsWith('Bearer ') ? value.slice(7) : undefined;
}

/** Configuration is process-local; callers must never log its contents. */
export function createAuthorizer(configJson: string | undefined, knownBrands: readonly string[]) {
  const invalid = () => new Error('Invalid BRAND_API_KEYS configuration.');
  let config: unknown;
  try {
    config = JSON.parse(configJson ?? '');
  } catch {
    throw invalid();
  }
  if (!Array.isArray(config) || config.length === 0) throw invalid();
  const known = new Set(knownBrands);
  const seen = new Set<string>();
  const entries = config.map((item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw invalid();
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).some(key => key !== 'key' && key !== 'brands')) throw invalid();
    if (typeof entry.key !== 'string' || entry.key.trim().length === 0 || seen.has(entry.key)) throw invalid();
    if (!Array.isArray(entry.brands) || entry.brands.length === 0 ||
        entry.brands.some((brand: unknown) => typeof brand !== 'string' || !known.has(brand))) throw invalid();
    seen.add(entry.key);
    return { hash: digest(entry.key), allowedBrands: new Set<string>(entry.brands as string[]) };
  });

  return {
    authenticate(credential: string | undefined): Principal {
      if (typeof credential !== 'string' || credential.length === 0) throw new AccessError('UNAUTHORIZED');
      const supplied = digest(credential);
      let match: Principal | undefined;
      for (const entry of entries) {
        if (timingSafeEqual(supplied, entry.hash)) match = { allowedBrands: entry.allowedBrands };
      }
      if (!match) throw new AccessError('UNAUTHORIZED');
      return match;
    },
    authorize(principal: Principal, brand: string): void {
      if (!known.has(brand) || !principal.allowedBrands.has(brand)) throw new AccessError('BRAND_NOT_ALLOWED');
    },
  };
}
