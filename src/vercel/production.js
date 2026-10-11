// Pure, conservative Vercel production classifiers. Unknown is high risk.
export function deploymentIsProduction(deployment, liveDeploymentId = null) {
  if (!deployment || typeof deployment !== 'object') return true;
  if (deployment.target === 'production' || deployment.target === 'prod') return true;
  if (liveDeploymentId && deployment.id === liveDeploymentId) return true;
  if (deployment.target === 'preview' || deployment.target === 'development') return false;
  // No target may mean a custom environment or incomplete response; never assume preview.
  return true;
}

export function isLiveProject(project) {
  if (!project || typeof project !== 'object') return true;
  const production = project.targets?.production;
  if (production && (typeof production === 'string' || typeof production === 'object')) return true;
  if (Array.isArray(project.latestDeployments)) {
    return project.latestDeployments.some(d => d.target === 'production');
  }
  // Absence of evidence is not proof a deployed site is safe to change.
  return true;
}

export function envTouchesProduction(targets, linkedProjectLive = null) {
  if (!Array.isArray(targets) || !targets.length) return true;
  if (targets.includes('production')) return true;
  if (linkedProjectLive === true) return true;
  if (linkedProjectLive === null && targets.some(t => t !== 'preview' && t !== 'development')) return true;
  return targets.some(t => t !== 'preview' && t !== 'development');
}

export function domainIsProduction(domain = {}) {
  // A domain attached to a specific preview branch/custom environment is not
  // itself a live domain assignment, but DNS/registrar writes are always live.
  if (domain.action === 'dns' || domain.action === 'nameservers' ||
    domain.action === 'registrar' || domain.action === 'certificate') return true;
  if (domain.gitBranch || domain.customEnvironmentId) return false;
  return true;
}
