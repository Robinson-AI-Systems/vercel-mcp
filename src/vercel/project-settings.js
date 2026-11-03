// The createDeployment `projectSettings` shape, stated once.
// The vendored OpenAPI description for the field: "Project settings that
// will be applied to the deployment. It is required for the first
// deployment of a project and will be saved for any following deployments."
// A deployment create that omits it against a project with no saved
// settings is refused by the provider: 400 `missing_project_settings`
// (VMCP-023, live probe 2026-10-28 — the seed's deployments are always
// first deployments, so the seed always hit it).
// Every field is nullable; null means the provider auto-detects the value
// (for `framework`, null means no framework is selected). Callers pass the
// values they can prove — a seed scenario's declared framework, or a
// project record's own stored fields echoed back unchanged — and the
// rest stay null.
export function deploymentProjectSettings(source = {}) {
  return {
    buildCommand: source.buildCommand ?? null,
    devCommand: source.devCommand ?? null,
    framework: source.framework ?? null,
    installCommand: source.installCommand ?? null,
    outputDirectory: source.outputDirectory ?? null,
    rootDirectory: source.rootDirectory ?? null
  };
}

// AUD-BZ: is this create the project's FIRST deployment? The project
// record's documented hasDeployments flag answers when it is present
// (AUD-AD/AUD-BS keyed on it alone) — but the live record does not
// always carry it: Vercel Unleashed's own project read-back shapes it
// null ("the project body may omit these fields"), and the retained
// branch-G fixture's record omits it entirely, so AUD-BS's fix never
// fired live and the provider kept refusing 400
// missing_project_settings (live conviction, 2026-11-03). When the
// flag is absent the proof comes from the provider's own deployment
// inventory: an empty list is a first deployment, a non-empty list is
// not. An inventory that cannot be read proves nothing and throws —
// guessing either way re-creates one of the two convicted 400s.
export async function isFirstDeployment(client, projectId, row) {
  if (row?.hasDeployments === false) return true;
  if (row?.hasDeployments === true) return false;
  const page = await client.request('deployments_list', {
    query: { projectId, limit: 1 }
  });
  if (!Array.isArray(page?.deployments))
    throw new TypeError('Provider did not return deployment inventory');
  return page.deployments.length === 0;
}
