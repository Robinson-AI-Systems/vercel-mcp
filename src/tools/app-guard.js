// Batch P supplies known-app profiles. Until then no profiles exist,
// but the hook's API is stable for the shared write preflight.
export async function checkApp(_targets, _ctx) {
  return { blocked: false, reason: 'No app profile is configured' };
}
