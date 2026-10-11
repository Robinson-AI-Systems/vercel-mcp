import { describe, expect, it } from 'vitest';
import { validateRequest, openApiOperation } from '../../test/helpers/openapi-validate.js';

describe('strict official Vercel request validation', () => {
  it('accepts published read operations and selected team scope', () => {
    expect(openApiOperation('user_get').path).toBe('/v2/user');
    expect(validateRequest('user_get', { query: { teamId: 'team_FAKE' } })).toBe(true);
    expect(validateRequest('projects_list', { query: { teamId: 'team_FAKE', limit: 1 } })).toBe(true);
  });
  it('rejects unknown operations, path and query keys, and bodies on GET', () => {
    expect(() => validateRequest('made_up')).toThrow(/Unknown Vercel operation/);
    expect(() => validateRequest('user_get', { path: { x: 'y' } })).toThrow(/Unknown API path/);
    expect(() => validateRequest('user_get', { query: { evil: 1 } })).toThrow(/Unknown API query/);
    expect(() => validateRequest('user_get', { body: { anything: 1 } })).toThrow(/does not accept a body|Read operation/);
    expect(() => validateRequest('user_get', { path: [] })).toThrow(/must be objects/);
  });
  it('rejects invalid parameter types before any HTTP call', () => {
    expect(() => validateRequest('projects_list', { query: { limit: { arbitrary: true } } }))
      .toThrow(/Invalid Vercel API parameter schema/);
  });
});
