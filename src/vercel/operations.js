// Canonical, version-pinned Vercel REST operations. Add entries only after checking
// the exact method and path in vendor/vercel-openapi/openapi-2026-10-11.json.
export const OPS = Object.freeze({
  user_get: Object.freeze({ method: 'GET', path: '/v2/user' }),
  teams_list: Object.freeze({ method: 'GET', path: '/v2/teams' }),
  projects_list: Object.freeze({ method: 'GET', path: '/v10/projects' }),
  projects_get: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}' }),
  projects_members_list: Object.freeze({ method: 'GET', path: '/v1/projects/{idOrName}/members' }),
  git_namespaces: Object.freeze({ method: 'GET', path: '/v1/integrations/git-namespaces', teamScoped: false }),
  git_repos_search: Object.freeze({ method: 'GET', path: '/v1/integrations/search-repo' }),
  projects_create: Object.freeze({ method: 'POST', path: '/v11/projects' }),
  projects_update: Object.freeze({ method: 'PATCH', path: '/v9/projects/{idOrName}' })
});

export function operation(id) {
  if (!Object.hasOwn(OPS, id)) throw new TypeError('Unknown Vercel operation');
  return OPS[id];
}
