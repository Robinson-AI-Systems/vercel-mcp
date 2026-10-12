// Provider-neutral profile access checks: one predicate for discovery and direct invocation.
import { isGuardedWrite } from './write.js';

export const PROFILES = Object.freeze(['read_only', 'everyday', 'full']);
const INTERNAL_FIELDS = new Set(['writes', 'profiles', 'localAdmin', 'writeContract', 'guardedWrite']);

export function visibleToProfile(tool, profile, { localOwnerTools = [] } = {}) {
  if (!PROFILES.includes(profile) || !tool || !Array.isArray(tool.profiles) ||
    !tool.profiles.includes(profile)) return false;
  // Every read is allowed only when explicitly declared. Unknown/missing writes fail closed.
  // Explicitly safe reads cannot carry conflicting privileged declarations.
  // This guards both MCP discovery and direct named invocation.
  if (tool.writes === false) {
    // The existing MCP meta delegate is an intentional special case: it
    // always re-enters dispatchReadOnlyTool and never calls a raw handler.
    // RTC separately marks this exact operation write-capable and excludes it.
    const guardedDelegate=tool.name==='vercel_call'&&
      tool.annotations?.readOnlyHint===false;
    return tool.localAdmin!==true&&tool.guardedWrite!==true&&
      tool.writeContract===undefined&&tool.secretIn!==true&&
      tool.secretOut!==true&&
      (tool.annotations?.readOnlyHint!==false||guardedDelegate)&&
      tool.annotations?.destructiveHint!==true;
  }
  if (tool.writes !== true || profile === 'read_only') return false;
  // Owner-only administration is never promoted to a routine write.
  if (tool.localAdmin === true) return profile === 'full' &&
    localOwnerTools.includes(tool.name);
  // Ordinary provider writes must opt in individually, prove defineWrite's
  // mandatory safety declarations and be permitted by the connection profile.
  // An unannotated future write stays invisible and uncallable.
  return isGuardedWrite(tool) && ['everyday','full'].includes(profile);
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
