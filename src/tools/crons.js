// D-1d: view existing Vercel project cron definitions only; never invoke URLs.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';
const PROFILES=['read_only','everyday','full'];
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const json=x=>({content:[{type:'text',text:JSON.stringify(x)}]});
const unsafe=value=>/[\x00-\x1f\x7f\\]/.test(value)||credentialLike(value);
const barePath=value=>{
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||
    value.length>2048||/[\x00-\x1f\x7f\\]/.test(value))return null;
  try{
    // Strip query and fragment before filtering; private cron URL arguments
    // must not poison an otherwise legitimate path. Also inspect decoding:
    // escaped provider token shapes must not appear in MCP output as paths.
    const pathname=new URL(value,'https://invalid.example').pathname;
    // Percent encoding can hide credentials, including double-encoded tokens
    // that a downstream consumer decodes again. Do not project encoded paths.
    if(pathname.includes('%')||unsafe(pathname))return null;
    return pathname.slice(0,500);
  }catch{return null;}
};
const sourceName=value=>typeof value==='string'&&/^[a-z][a-z_-]{0,30}$/.test(value)?value:null;
function dateView(utc){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Denver',day:'numeric',hour:'2-digit',minute:'2-digit',
    hourCycle:'h23',timeZoneName:'short'
  }).formatToParts(utc);
  const p=key=>parts.find(x=>x.type===key)?.value;
  return {time:`${p('hour')}:${p('minute')} ${p('timeZoneName')}`,
    dayOffset:Number(p('day'))-15};
}
// A sampled illustration, NOT a next-run calculation. Vercel schedules in UTC.
// Complex CRON syntax must not be converted by a misleading fixed-hour shortcut.
export function denverCronPreview(expression){
  if(typeof expression!=='string')return null;
  const m=/^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/.exec(expression.trim());
  if(!m)return null;
  const [,minute,hour]=m;
  return {
    winter:dateView(new Date(Date.UTC(2026,0,15,Number(hour),Number(minute)))),
    summer:dateView(new Date(Date.UTC(2026,6,15,Number(hour),Number(minute)))),
    note:'Daily UTC schedule; Colorado local clock changes with daylight saving time. These are sample dates, not next executions.'
  };
}
function validTimestamp(value){
  if(value===undefined||value===null||value==='')return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
function enabledState(crons){
  const on=validTimestamp(crons.enabledAt),off=validTimestamp(crons.disabledAt);
  if(on===null&&off===null)return null;
  return on!==null&&(off===null||on>off);
}
function definition(row){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new TypeError('Invalid cron definition');
  const schedule=typeof row.schedule==='string'&&row.schedule.length<=160&&
    !row.schedule.includes('%')&&!unsafe(row.schedule)?
    row.schedule:null;
  return {path:barePath(row.path),scheduleUtc:schedule,source:sourceName(row.source),
    denverExample:denverCronPreview(schedule)};
}
export const cronsTools={
  tools:[{
    name:'vercel_cron_list',writes:false,profiles:PROFILES,area:'projects',
    description:'Read configured project cron jobs and UTC schedules with DST-aware Denver examples.',
    inputSchema:{type:'object',properties:{project:{type:'string',minLength:1,maxLength:128}},
      required:['project'],additionalProperties:false},
    annotations:{readOnlyHint:true}
  }],
  handlers:{
    async vercel_cron_list(args,ctx){
      if(!args||typeof args!=='object'||Array.isArray(args)||
        Object.keys(args).some(key=>key!=='project')||
        typeof args.project!=='string'||!idPattern.test(args.project))
        throw new TypeError('A valid project identifier is required');
      const {client,account}=await readProvider(ctx);
      if(account.scope==='project'&&args.project!==account.project_id)
        throw new TypeError('Project-scoped credential cannot read another project');
      const project=await client.request('projects_get',{path:{idOrName:args.project}});
      if(!project||typeof project.id!=='string'||!idPattern.test(project.id)||
        credentialLike(project.id)||
        (account.scope==='project'&&project.id!==account.project_id))
        throw new TypeError('Cron project scope not confirmed');
      const configured=project.crons;
      if(!configured||!Array.isArray(configured.definitions))
        return json({project:project.id,available:false,count:null,jobs:[],
          reason:'Vercel did not return cron definitions; cannot distinguish an empty schedule from unavailable metadata.'});
      return json({project:project.id,available:true,count:configured.definitions.length,
        returned:Math.min(configured.definitions.length,100),
        capped:configured.definitions.length>100,
        enabled:enabledState(configured),
        deploymentId:typeof configured.deploymentId==='string' &&
          /^dpl_[a-zA-Z0-9_-]{1,100}$/.test(configured.deploymentId)?
          configured.deploymentId:null,
        updatedAt:validTimestamp(configured.updatedAt),
        jobs:configured.definitions.slice(0,100).map(definition)});
    }
  }
};
