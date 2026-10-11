import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { OPS, operation } from '../../src/vercel/operations.js';

const file = new URL('../../vendor/vercel-openapi/openapi-2026-10-11.json', import.meta.url);
const bytes = fs.readFileSync(file);
const spec = JSON.parse(bytes.toString('utf8'));

describe('official OpenAPI snapshot and pinned operations', () => {
  it('matches the exact source fingerprint and recorded count', () => {
    expect(bytes.length).toBe(11611860);
    expect(createHash('sha256').update(bytes).digest('hex'))
      .toBe('af1db6e9c95e446468f0c3974653298afe8079db03ee2872429a65cb60a72544');
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.values(spec.paths).reduce((sum, path) => sum +
      Object.keys(path).filter(method => ['get','put','post','delete','patch','head','options','trace'].includes(method)).length, 0))
      .toBe(451);
  });
  it('pins only operations that are actually published in the snapshot', () => {
    for (const [name, op] of Object.entries(OPS)) {
      expect(spec.paths[op.path]?.[op.method.toLowerCase()], name).toBeDefined();
      expect(operation(name)).toBe(op);
    }
    expect(() => operation('unknown')).toThrow(/Unknown Vercel operation/);
  });
});
