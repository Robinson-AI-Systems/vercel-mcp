// Server-only Vercel provider binding: never trust caller credentials or scope.
import {createHash} from 'node:crypto';
import {loadToken} from './tokens.js';
import {makeVercelClient} from './client.js';
import {operation} from './operations.js';
import {documentedWrite} from './openapi-validation.js';

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
export function transportReplayKey(logicalKey, operationId = 'unspecified', params = {}, mutationId) {
  if(typeof logicalKey!=='string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(logicalKey))
    throw new TypeError('Invalid logical replay key');
  if(typeof operationId !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(operationId) ||
    (mutationId !== undefined && (typeof mutationId !== 'string' ||
      !/^[a-zA-Z0-9_:-]{1,100}$/.test(mutationId))))
    throw new TypeError('Invalid transport mutation identity');
  const canonical = value => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>[k,canonical(v)])) : value;
  const identity = JSON.stringify([logicalKey,operationId,canonical(params),mutationId??null]);
  return 'transport_' + createHash('sha256').update(identity).digest('hex');
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
    async sandboxFile(params,{requestKey,tool}={}){
      if(tool!=='vercel_dev_sandbox_write_files'||
        typeof requestKey!=='string'||!requestKey||params?.kind!=='write')
        throw new TypeError('Native Sandbox file upload requires guarded write identity');
      // The outer defineWrite claim and durable dev-run intent protect the
      // full POST; this transport has no unguarded general-purpose exposure.
      return client.sandboxFilesystem(ctx,params);
    },
    uploadFile({sha,bytes},{requestKey,tool}={}){
      if(!['vercel_deploy_create_from_files','vercel_dev_seed'].includes(tool)||
        typeof requestKey!=='string'||
        !Buffer.isBuffer(bytes)||bytes.length>2097152)
        throw new TypeError('Guarded deployment file upload requires a stable owner transaction');
      return client.uploadFile({sha,bytes},{
        requestKey:transportReplayKey(requestKey,'deployments_file_upload',
          {sha,size:bytes.length}),tool,mode:ctx.connection.mode
      });
    },
    write(id,params,{requestKey,tool,shapeResult,mutationId}={}){
      if(['GET','HEAD'].includes(operation(id).method) ||
        typeof tool!=='string' || !/^vercel_[a-z0-9_]+$/.test(tool) ||
        typeof shapeResult!=='function')
        throw new TypeError('Guarded mutation must declare tool and safe shape');
      return client.request(id,params,{
        requestKey:transportReplayKey(requestKey,id,params,mutationId),tool,mode:ctx.connection.mode,
        shapeResult
      });
    },
    // Batch U: the universal write dispatches a documented operation that
    // has no OPS-table entry. Same guarded contract as write(): a named
    // tool, a safe result shape, and a transport key bound to the logical
    // request key, the operation and the exact mutation parameters.
    writeApi(op,params,{requestKey,tool,shapeResult,mutationId}={}){
      documentedWrite(op);
      if(typeof tool!=='string' || !/^vercel_[a-z0-9_]+$/.test(tool) ||
        typeof shapeResult!=='function')
        throw new TypeError('Guarded mutation must declare tool and safe shape');
      return client.request('api:'+op,params,{
        documentedWrite:true,
        requestKey:transportReplayKey(requestKey,'api:'+op,params,mutationId),tool,mode:ctx.connection.mode,
        shapeResult
      });
    }
  };
}
