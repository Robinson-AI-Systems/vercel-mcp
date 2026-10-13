// Curated reads keep their own scope, bounds, secret handling and result contracts.
export const handBuiltReads=Object.freeze({
  getProject:'vercel_project_get',getDeployment:'vercel_deploy_get',getDeployments:'vercel_deploy_list',
  getDeploymentEvents:'vercel_deploy_get_build_logs',listDeploymentFiles:'vercel_deploy_list_files',
  getDeploymentFileContents:'vercel_deploy_get_file',getTeam:'vercel_team_get',getTeams:'vercel_team_list'
});
