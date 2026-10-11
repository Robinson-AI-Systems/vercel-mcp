// Canonical, version-pinned Vercel REST operations. Add entries only after checking
// the exact method and path in vendor/vercel-openapi/openapi-2026-10-11.json.
export const OPS = Object.freeze({
  user_get: Object.freeze({ method: 'GET', path: '/v2/user' }),
  projects_list: Object.freeze({ method: 'GET', path: '/v10/projects' }),
  projects_create: Object.freeze({ method: 'POST', path: '/v11/projects' })
});

export function operation(id) {
  if (!Object.hasOwn(OPS, id)) throw new TypeError('Unknown Vercel operation');
  return OPS[id];
}
