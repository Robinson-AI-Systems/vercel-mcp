// Provider-neutral profile access checks: one predicate for discovery and direct invocation.
export const PROFILES = Object.freeze(['read_only', 'everyday', 'full']);
const INTERNAL_FIELDS = new Set(['writes', 'profiles', 'localAdmin', 'writeContract']);

export function visibleToProfile(tool, profile, { localOwnerTools = [] } = {}) {
  if (!PROFILES.includes(profile) || !tool || !Array.isArray(tool.profiles) ||
    !tool.profiles.includes(profile)) return false;
  // Every read is allowed only when explicitly declared. Unknown/missing writes fail closed.
  if (tool.writes === false) return true;
  if (tool.writes !== true || profile === 'read_only') return false;
  // Until the generic guarded write gateway is implemented, only local owner
  // switches in an explicit allowlist can be called; never arbitrary writes.
  return profile === 'full' && tool.localAdmin === true &&
    localOwnerTools.includes(tool.name);
}

export function listProfileTools(registry, profile, options = {}) {
  return (registry?.tools || []).filter(tool => visibleToProfile(tool, profile, options))
    .map(tool => Object.fromEntries(Object.entries(tool)
      .filter(([key]) => !INTERNAL_FIELDS.has(key))));
}

export function profileToolCounts(registry, options = {}) {
  return Object.fromEntries(PROFILES.map(profile =>
    [profile, listProfileTools(registry, profile, options).length]));
}
