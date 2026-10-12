// Owner-designated project exclusions are removable; project identity alone is not a write ban.
// Reads are never blocked. Missing ownership metadata fails closed for writes.
const KINDS = new Set(['account','project','domain','dns_record','env','store','token','deployment','alias','certificate']);
const CHILDREN = new Set(['domain','dns_record','env','store','deployment','alias','certificate']);
const DENY = reason => ({ blocked: true, reason });
function value(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
function protectedMatch(resource, target) {
  const term = value(resource.match);
  const candidates = [target.id,target.name,target.projectId,target.projectName,
    target.parentProjectId,target.parentProjectName,target.tokenId].map(value);
  return term && candidates.includes(term);
}
export function checkTargets(targets, rules, { selfTokenId = '' } = {}) {
  if (!Array.isArray(targets) || !targets.length) return DENY('The write targets were not identified');
  if (!Array.isArray(rules)) return DENY('Protected resource rules are unavailable');
  for (const target of targets) {
    if (!target || !KINDS.has(target.kind)) return DENY('Unrecognized write target');
    if (target.kind === 'token' && (target.isServerToken === true ||
      (selfTokenId && value(target.id) === value(selfTokenId)))) {
      return DENY('The credential used by this server is protected');
    }
    if (CHILDREN.has(target.kind) &&
      !target.projectId && !target.parentProjectId && !target.projectName && !target.parentProjectName) {
      return DENY('Resource ownership is unknown; cannot prove it is unprotected');
    }
    if (!target.id && !target.name) return DENY('Target identity is missing');
    const protectedRule = rules.find(rule => protectedMatch(rule,target));
    if (protectedRule) return DENY('Protected resource: ' + (protectedRule.note || protectedRule.match));
  }
  return { blocked: false };
}
export async function checkProtected(targets, { db, connection, env = process.env } = {}) {
  if (!db?.listProtectedResources || !connection?.account) {
    return DENY('Protected resource data is unavailable');
  }
  try {
    const rules = await db.listProtectedResources(connection.account);
    return checkTargets(targets,rules,{
      selfTokenId: env.VERCEL_TOKEN_ID || ''
    });
  } catch {
    return DENY('Protected resource rules could not be verified');
  }
}
