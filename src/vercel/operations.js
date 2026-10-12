// Canonical, version-pinned Vercel REST operations. Add entries only after checking
// the exact method and path in vendor/vercel-openapi/openapi-2026-10-11.json.
export const OPS = Object.freeze({
  user_get: Object.freeze({ method: 'GET', path: '/v2/user' }),
  teams_list: Object.freeze({ method: 'GET', path: '/v2/teams' }),
  // Exact team ID comes only from the stored account, not the caller. This
  // endpoint takes teamId in the path, not as a redundant query parameter.
  teams_members_list: Object.freeze({ method: 'GET', path: '/v3/teams/{teamId}/members', teamScoped: false }),
  projects_list: Object.freeze({ method: 'GET', path: '/v10/projects' }),
  deployments_list: Object.freeze({ method: 'GET', path: '/v7/deployments' }),
  deployments_get: Object.freeze({ method: 'GET', path: '/v13/deployments/{idOrUrl}' }),
  projects_get: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}' }),
  projects_members_list: Object.freeze({ method: 'GET', path: '/v1/projects/{idOrName}/members' }),
  projects_members_add: Object.freeze({ method: 'POST', path: '/v1/projects/{idOrName}/members' }),
  projects_members_remove: Object.freeze({ method: 'DELETE', path: '/v1/projects/{idOrName}/members/{uid}' }),
  git_namespaces: Object.freeze({ method: 'GET', path: '/v1/integrations/git-namespaces', teamScoped: false }),
  git_repos_search: Object.freeze({ method: 'GET', path: '/v1/integrations/search-repo' }),
  projects_create: Object.freeze({ method: 'POST', path: '/v11/projects' }),
  projects_update: Object.freeze({ method: 'PATCH', path: '/v9/projects/{idOrName}' }),
  projects_pause: Object.freeze({ method: 'POST', path: '/v1/projects/{projectId}/pause' }),
  projects_unpause: Object.freeze({ method: 'POST', path: '/v1/projects/{projectId}/unpause' }),
  projects_domains_list: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}/domains' }),
  projects_env_list: Object.freeze({ method: 'GET', path: '/v10/projects/{idOrName}/env' }),
  projects_transfer_request: Object.freeze({ method: 'POST', path: '/projects/{idOrName}/transfer-request' }),
  projects_delete: Object.freeze({ method: 'DELETE', path: '/v9/projects/{idOrName}' })
});

export function operation(id) {
  if (!Object.hasOwn(OPS, id)) throw new TypeError('Unknown Vercel operation');
  return OPS[id];
}
