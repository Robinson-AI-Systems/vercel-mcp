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
