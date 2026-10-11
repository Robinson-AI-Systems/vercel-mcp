// Server-only Vercel provider binding: never trust caller credentials or scope.
import {createHash} from 'node:crypto';
import {loadToken} from './tokens.js';
import {makeVercelClient} from './client.js';
import {operation} from './operations.js';

async function bind({db,connection,env,fetchImpl},writable){
  if(!connection || typeof connection.account!=='string' || !connection.account ||
     typeof db?.getAccountCredential!=='function')
    throw new TypeError('A stored, authenticated Vercel account is required');
  if(writable && (!['everyday','full'].includes(connection.profile) ||
    !['preview','production'].includes(connection.mode)))
    throw new TypeError('A write-capable connection is required');
  const {token,account}=await loadToken({db,accountId:connection.account,env});
  if(account.id!==connection.account || !['team','project','full'].includes(account.scope) ||
    typeof account.team_id!=='string' || !account.team_id ||
    (account.scope==='project' && !account.project_id))
    throw new TypeError('Stored account scope is invalid');
  const replayStore=writable?db.requestReplayStore?.():null;
  if(writable && (typeof replayStore?.claim!=='function' ||
    typeof replayStore?.complete!=='function'))
    throw new TypeError('Durable transport replay protection is required');
  const client=makeVercelClient({token,account,
    ...(fetchImpl?{fetchImpl}:{}),replayStore});
  return {client,account};
}
export async function readProvider(ctx){
  return bind(ctx,false);
}
// Separate transport and logical write keys: each has an independent durable
// claim, so the nested provider call never collides with defineWrite's claim.
export function transportReplayKey(logicalKey){
  if(typeof logicalKey!=='string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(logicalKey))
    throw new TypeError('Invalid logical replay key');
  return 'transport_' + createHash('sha256').update(logicalKey).digest('hex');
}
export async function writeProvider(ctx){
  const {client,account}=await bind(ctx,true);
  return {
    account,
    read(id,params){
      if(!['GET','HEAD'].includes(operation(id).method))
        throw new TypeError('Read-back cannot mutate resources');
      return client.request(id,params);
    },
    write(id,params,{requestKey,tool,shapeResult}={}){
      if(['GET','HEAD'].includes(operation(id).method) ||
        typeof tool!=='string' || !/^vercel_[a-z0-9_]+$/.test(tool) ||
        typeof shapeResult!=='function')
        throw new TypeError('Guarded mutation must declare tool and safe shape');
      return client.request(id,params,{
        requestKey:transportReplayKey(requestKey),tool,mode:ctx.connection.mode,
        shapeResult
      });
    }
  };
}
