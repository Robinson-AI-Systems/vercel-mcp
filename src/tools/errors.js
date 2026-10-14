// Safe and actionable errors for Vercel MCP tools. Never display upstream
// error.message or raw response bodies: providers can echo token or env data.
const CODE = /^[a-z][a-z0-9_-]{0,79}$/;
const KNOWN_CODES = new Set([
  'unauthorized', 'invalid_token', 'token_expired', 'expired_token',
  'forbidden', 'not_found', 'rate_limited', 'price_mismatch', 'not_available',
  'conflict_aliases', 'custom_domain_needs_upgrade', 'missing_files', 'no_files',
  'runtime_log_stream_invalid'
]);
const SAFE_LABEL = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
// Scope labels are untrusted and may themselves be credentials.
const SECRET_LABEL = /(?:vcp_|vci_|vca_|vcr_|sk_live_|sk_test_|rk_|whsec_|ghp_|github_pat_|xox|AKIA|password|passphrase|secret|token)/i;
const cleanLabel = value => typeof value === 'string' && SAFE_LABEL.test(value) &&
  !SECRET_LABEL.test(value) ? value : 'the selected resource';
function denverTime(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const actual = ms < 1e11 ? ms * 1000 : ms;
  if (actual > Date.now() + 86400000 * 365) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(actual));
}
function normalized(raw) {
  const input = raw?.error && typeof raw.error === 'object' ? raw.error : raw;
  const candidate = input?.code;
  // Provider-supplied codes are not safe to echo unless recognized.
  const code = typeof candidate === 'string' && CODE.test(candidate) &&
    (KNOWN_CODES.has(candidate) || /^env_[a-z0-9_-]{1,36}$/.test(candidate)) ?
    candidate : 'unknown_error';
  const status = Number.isSafeInteger(raw?.status) && raw.status >= 100 && raw.status <= 599 ? raw.status :
    Number.isSafeInteger(input?.status) && input.status >= 100 && input.status <= 599 ? input.status : null;
  return { code, status };
}
/** For an error from the sanitized central client (no raw provider text). */
export function explainVercelError(raw, context = {}) {
  const {code,status} = normalized(raw);
  let what='Vercel could not complete the request.';
  let why='The provider did not return a recognized safe error code.';
  let next='Verify your account selection and try a read-only status check before retrying.';
  if (['unauthorized','invalid_token','token_expired','expired_token'].includes(code) || status === 401) {
    what='The Vercel account token is no longer accepted.';
    why='The token may be expired, revoked or incorrectly scoped.';
    next='Open the administrator setup page and reverify or rotate the team token.';
  } else if (code==='forbidden' || status === 403) {
    what='Vercel refused the requested permission.';
    why=context.projectScoped ? 'The credential is limited to project ' + cleanLabel(context.project) +
      ' and may not have access to this team resource.' :
      'The token owner may not hold the required Owner or project role.';
    next='Verify the intended account, project scope and owner role on the setup page.';
  } else if (code==='not_found' || status===404) {
    what='The selected Vercel resource was not found.';
    why='It may be missing or outside team ' + cleanLabel(context.team) + '.';
    next='List the available resources for that team and verify the resource identifier.';
  } else if (code==='rate_limited' || status===429) {
    what='Vercel has temporarily limited API requests.';
    const reset=denverTime(context.resetAtMs ?? context.resetAt);
    why=reset ? 'Requests may resume around ' + reset + '.' : 'The reset time was not provided.';
    next='Wait for the provider rate-limit window to reset, then retry a read-only check.';
  } else if (code==='runtime_log_stream_invalid') {
    what='Vercel runtime logs could not be safely read.';
    why='The deployment is verified, but the streamed log response was not usable.';
    next='Keep the log check pending; inspect the provider stream contract and retry only a bounded read after a checked release.';
  } else if (code==='price_mismatch') {
    what='The price changed before the request could finish.';
    why='The quoted provider price no longer matches the verified charge.';
    next='Retrieve a fresh provider quote and obtain a new owner confirmation; do not reuse an old confirmation.';
  } else if (code==='not_available') {
    what='This Vercel feature is not currently available.';
    why='It may be restricted by account plan, project scope or provider availability.';
    next='Check feature eligibility in the Vercel dashboard. Do not bypass plan restrictions.';
  } else if (code==='conflict_aliases') {
    what='The requested alias conflicts with an existing deployment assignment.';
    why='The hostname is already associated with another target.';
    next='Inspect the current alias and decide which deployment should own it before retrying.';
  } else if (code==='custom_domain_needs_upgrade') {
    what='This custom-domain operation requires a different Vercel plan.';
    why='The current plan does not permit the requested domain configuration.';
    next='Review Vercel pricing and obtain explicit approval before changing any plan.';
  } else if (code.startsWith('env_')) {
    what='Vercel rejected the environment-variable configuration.';
    why='The variable name, target or value constraints may be invalid.';
    next='Verify the variable name and intended environment in setup; never paste secrets into a tool argument.';
  } else if (['missing_files','no_files'].includes(code)) {
    what='The deployment did not include the required build files.';
    why='The submitted deployment manifest is empty or incomplete.';
    next='Review the project build inputs and preview artifact list before creating another deployment.';
  } else if ([402,426].includes(status)) {
    what='The operation is restricted by the Vercel account plan.';
    why='The requested feature may require a paid tier or team permission.';
    next='Review eligibility without purchasing; any upgrade needs separate owner approval.';
  }
  const operation = typeof context.operation === 'string' &&
    /^vercel_[a-z0-9_]{1,70}$/.test(context.operation) ? context.operation : null;
  return { what, why, next,
    technical: 'Vercel ' + code + (status === null ? '' : ' (HTTP ' + status + ')') +
      (operation ? ' | operation ' + operation : '') };
}
export function vercelErrorResult(raw, context = {}) {
  const e=explainVercelError(raw,context);
  return { isError:true, content:[{type:'text',
    text:e.what + '\nLikely cause: ' + e.why + '\nWhat to do: ' + e.next +
      '\nTechnical: ' + e.technical }] };
}
