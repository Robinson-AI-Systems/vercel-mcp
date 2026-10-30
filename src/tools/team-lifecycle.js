// AUD-AB: the account-layer team lifecycle — create and delete as guarded
// writes (VMCP-026 A-13). Team create/delete are account-layer acts (IN-16):
// they run on the selected team/full seat, never on a project seat, and the
// tool never pre-judges Vercel's plan, billing or state verdicts (IN-18) —
// it attempts, classifies and names the remedy. The one refusal the product
// owns is its own data integrity: a team with live enrollments seated on it
// cannot be deleted until those enrollments are removed as their own named
// act (AUD-AA), because the rows are derived credentials that would strand.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const REQUEST_KEY=/^[a-zA-Z0-9_-]{8,128}$/;
const control=/[\x00-\x1f\x7f]/;
const secretShape=/(?:password|secret|access.?token|private.?key)\s*[:=]/i;
// The write preflight genericizes every before() throw into one refusal
// text; only the guard channels surface their reason verbatim. The one
// refusal whose remedy the caller must act on — the enrollment guard —
// therefore rides guardProtected (composed after the owner-protection
// check, never replacing it), and is re-checked pre-dispatch in apply.
function ctxFor({db,connection,env,fetchImpl},guardExtra){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:async targets=>{
      const base=await checkProtected(targets,{db,connection,env});
      if(base?.blocked||typeof guardExtra!=='function')return base;
      return (await guardExtra(targets,db))??base;
    },
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const resultMapper=result=>({
  isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]
});
async function seat(ctx){
  if(ctx.connection?.profile!=='full')throw new TypeError('Full owner profile required');
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope)||!ID.test(account.team_id))
    throw new TypeError('Team lifecycle is an account-layer action; this seat cannot reach it — connect a team or Full Account token');
  return {client,account};
}
function safeText(value,max){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    !control.test(value)&&!credentialLike(value)&&!secretShape.test(value);
}
function keyCheck(args){
  if(args.requestKey!==undefined&&
    (typeof args.requestKey!=='string'||!REQUEST_KEY.test(args.requestKey)))
    throw new TypeError('Invalid team lifecycle request key');
}
function flagsCheck(args){
  return args.confirm!==undefined&&typeof args.confirm!=='boolean'||
    args.dryRun!==undefined&&typeof args.dryRun!=='boolean';
}

/* ------------------------------ create ------------------------------ */
const createProps={
  slug:{type:'string',minLength:1,maxLength:48,pattern:SLUG.source},
  name:{type:'string',minLength:1,maxLength:256},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST_KEY.source}
};
function validateCreate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!Object.hasOwn(createProps,key))||flagsCheck(args))
    throw new TypeError('Invalid team create request');
  if(typeof args.slug!=='string'||args.slug.length>48||!SLUG.test(args.slug)||
    !safeText(args.slug,48))
    throw new TypeError('Unsafe team slug');
  if(args.name!==undefined&&!safeText(args.name,256))
    throw new TypeError('Unsafe team name');
  keyCheck(args);
}
const create=defineWrite({
  name:'vercel_team_create',
  async before(args,ctx){
    validateCreate(args);
    const {client,account}=await seat(ctx);
    const body={slug:args.slug,...(args.name!==undefined?{name:args.name}:{})};
    validateRequest('teams_create',{body});
    let slugVisible=null;
    if(account.scope==='full'){
      try{
        const page=await client.request('teams_list_unscoped',{query:{limit:100}});
        if(Array.isArray(page?.teams))
          slugVisible=page.teams.some(row=>row?.slug===args.slug);
      }catch{ slugVisible=null; }
    }
    return {slug:args.slug,name:args.name??null,accountScope:account.scope,
      accountTeamId:account.team_id,slugVisible};
  },
  async preview(_args,_ctx,before){
    return 'Create a new Vercel team with slug "'+before.slug+'"'+
      (before.name?' and name "'+before.name+'"':'')+
      '; a new team starts on Vercel\'s current plan terms — if this account has no plan or billing arrangement for another team, Vercel refuses and asks for payment details in the dashboard (this tool never collects payment)'+
      (before.accountScope==='team'?
        '; this connection\'s recorded reach is one team and team creation is an account-layer act — Vercel may refuse it for this credential; a Full Account connection is the remedy':'')+
      (before.slugVisible?
        '; a team with this slug is already visible on this account — Vercel will refuse a duplicate slug':'')+
      '; PRODUCTION owner confirmation required';
  },
  async production(){
    return {production:true,
      why:'Creating a team changes the structure of a live owner account and starts plan terms'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.accountTeamId,name:before.slug}];
  },
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(!['team','full'].includes(provider.account.scope)||
        provider.account.team_id!==before.accountTeamId||
        ctx.connection?.profile!=='full'||ctx.connection?.mode!=='production')
        throw new TypeError('Team authority changed');
    });
    const body={slug:before.slug,...(before.name!==null?{name:before.name}:{})};
    return provider.write('teams_create',{body},{
      requestKey,tool:'vercel_team_create',shapeResult:row=>{
        if(!row||typeof row.id!=='string'||!ID.test(row.id)||row.slug!==before.slug)
          throw new TypeError('Provider did not confirm the new team identity');
        return {teamId:row.id,slug:row.slug};
      }
    });
  },
  async verify(_args,ctx,_before,applied){
    const {client}=await readProvider(ctx);
    try{
      const row=await client.request('teams_get',{path:{teamId:applied.teamId}});
      return {confirmed:row?.id===applied.teamId&&row?.slug===applied.slug,
        teamId:applied.teamId};
    }catch{
      // A seat that cannot see the team it just created confirms unknown,
      // never false: creation was provider-confirmed at apply.
      return {confirmed:null,teamId:applied.teamId};
    }
  },
  async publicReceipt(_args,_before,applied){
    return {teamId:applied.teamId,slug:applied.slug};
  }
});

/* ------------------------------ delete ------------------------------ */
const deleteProps={
  teamId:{type:'string'},newDefaultTeamId:{type:'string'},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST_KEY.source}
};
function validateDelete(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!Object.hasOwn(deleteProps,key))||flagsCheck(args))
    throw new TypeError('Invalid team delete request');
  if(typeof args.teamId!=='string'||!ID.test(args.teamId))
    throw new TypeError('Invalid team identifier');
  if(args.newDefaultTeamId!==undefined&&
    (typeof args.newDefaultTeamId!=='string'||!ID.test(args.newDefaultTeamId)))
    throw new TypeError('Invalid replacement default team identifier');
  if(args.newDefaultTeamId!==undefined&&args.newDefaultTeamId===args.teamId)
    throw new TypeError('The replacement default team must differ from the team being deleted');
  keyCheck(args);
}
async function enrolledOn(db,teamId){
  const rows=await db.listVercelAccounts();
  if(!Array.isArray(rows))throw new TypeError('Account inventory unavailable');
  return rows.filter(row=>row?.team_id===teamId);
}
function guardClear(seated){
  if(seated.length)
    throw new TypeError(seated.length+
      ' enrolled account(s) are seated on this team; remove the enrollment first (vercel_remove_account), then delete the team');
}
async function enrollmentGuard(targets,db){
  const target=targets?.[0];
  if(!target||target.kind!=='account'||typeof target.id!=='string')return null;
  const seated=await enrolledOn(db,target.id);
  if(!seated.length)return null;
  return {blocked:true,reason:seated.length+
    ' enrolled account(s) are seated on this team; remove the enrollment first (vercel_remove_account), then delete the team'};
}
const remove=defineWrite({
  name:'vercel_team_delete',
  async before(args,ctx){
    validateDelete(args);
    const {client,account}=await seat(ctx);
    let row;
    try{
      row=await client.request('teams_get',{path:{teamId:args.teamId}});
    }catch(error){
      if(error?.status===404)
        throw new TypeError('Target team was not found; it may already be deleted, or this credential cannot see it');
      if(error?.status===403)
        throw new TypeError('This credential cannot access the target team');
      throw error;
    }
    if(!row||row.id!==args.teamId||!ID.test(row.id))
      throw new TypeError('Target team identity could not be verified');
    let isDefault=null;
    try{
      const user=await client.request('user_get_unscoped');
      if(typeof user?.defaultTeamId==='string')
        isDefault=user.defaultTeamId===args.teamId;
    }catch{ isDefault=null; }
    validateRequest('teams_delete',{path:{teamId:args.teamId},
      query:args.newDefaultTeamId?{newDefaultTeamId:args.newDefaultTeamId}:{},
      body:{}});
    return {teamId:args.teamId,
      slug:typeof row.slug==='string'?row.slug:null,
      isDefault,newDefaultTeamId:args.newDefaultTeamId??null,
      accountScope:account.scope,accountTeamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Delete Vercel team '+before.teamId+
      (before.slug?' ('+before.slug+')':'')+
      ' PERMANENTLY — the team and everything in it (projects, deployments, domains, settings) go with it under Vercel\'s rules and cannot be restored'+
      (before.isDefault===true?
        '; this is the account default team'+(before.newDefaultTeamId?
          '; '+before.newDefaultTeamId+' becomes the default instead':
          '; Vercel chooses the new default unless newDefaultTeamId names one'):
        before.newDefaultTeamId?
          '; '+before.newDefaultTeamId+' becomes the account default team':'')+
      '; Vercel may still refuse for billing, team state or organization linkage — that verdict is Vercel\'s and is reported as returned'+
      '; PRODUCTION owner confirmation required';
  },
  async production(){
    return {production:true,
      why:'Deleting a team is irreversible and removes everything in it'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.slug??before.teamId}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(!['team','full'].includes(provider.account.scope)||
        provider.account.team_id!==before.accountTeamId||
        ctx.connection?.profile!=='full'||ctx.connection?.mode!=='production')
        throw new TypeError('Team authority changed');
      guardClear(await enrolledOn(ctx.db,before.teamId));
      const current=await provider.read('teams_get',{path:{teamId:before.teamId}});
      if(current?.id!==before.teamId)
        throw new TypeError('Target team changed after preview');
    });
    return provider.write('teams_delete',{
      path:{teamId:before.teamId},
      query:before.newDefaultTeamId?{newDefaultTeamId:before.newDefaultTeamId}:{},
      body:{}
    },{requestKey,tool:'vercel_team_delete',shapeResult:row=>{
      if(!row||row.id!==before.teamId)
        throw new TypeError('Provider did not confirm the deleted team identity');
      return {teamId:before.teamId,
        newDefaultTeamIdError:typeof row.newDefaultTeamIdError==='boolean'?
          row.newDefaultTeamIdError:null};
    }});
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    try{
      const row=await client.request('teams_get',{path:{teamId:before.teamId}});
      return {confirmed:!(row&&row.id===before.teamId),teamId:before.teamId};
    }catch(error){
      return {confirmed:error?.status===404?true:null,teamId:before.teamId};
    }
  },
  async publicReceipt(_args,before,applied){
    return {teamId:before.teamId,
      newDefaultTeamIdError:applied.newDefaultTeamIdError};
  }
});

export const teamLifecycleTools={
  tools:[
    {name:'vercel_team_create',writes:true,guardedWrite:true,
      area:'teams',profiles:['full'],
      description:'Create a new Vercel team from the account layer with guarded preview; plan terms and refusals are disclosed, never pre-judged.',
      inputSchema:{type:'object',properties:createProps,additionalProperties:false},
      writeContract:create.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_team_delete',writes:true,guardedWrite:true,
      area:'teams',profiles:['full'],
      description:'Delete a Vercel team permanently from the account layer; enrolled seats on the target refuse until removed, platform verdicts classify.',
      inputSchema:{type:'object',properties:deleteProps,additionalProperties:false},
      writeContract:remove.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}}
  ],
  handlers:{
    vercel_team_create:bindGuardedWrite(create,ctxFor,resultMapper),
    vercel_team_delete:bindGuardedWrite(remove,
      ctx=>ctxFor(ctx,enrollmentGuard),resultMapper)
  }
};
