// Server-only Vercel provider binding: never trust a caller-supplied token or team.
import {loadToken} from './tokens.js';
import {makeVercelClient} from './client.js';
export async function readProvider({db,connection,env,fetchImpl}){
  if(!connection || typeof connection.account!=='string' || !connection.account ||
     typeof db?.getAccountCredential!=='function')
    throw new TypeError('A stored, authenticated Vercel account is required');
  const {token,account}=await loadToken({db,accountId:connection.account,env});
  if(account.id!==connection.account || !['team','project','full'].includes(account.scope) ||
    typeof account.team_id!=='string' || !account.team_id ||
    (account.scope==='project' && !account.project_id))
    throw new TypeError('Stored account scope is invalid');
  const client=makeVercelClient({token,account,
    ...(fetchImpl?{fetchImpl}:{}),replayStore:null});
  return {client,account};
}
