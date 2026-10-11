// Explicit provider object summaries; never return full env or token records here.
const FIELDS={
  project:['id','name','framework','productionUrl','lastProductionAt','gitRepo',
    'productionBranch','paused','nodeVersion'],
  deployment:['id','url','target','state','branch','commitSha','commitMessage',
    'createdAt','errorSummary'],
  env:['key','targets','kind','gitBranch','updatedAt'],
  domain:['name','verified','expiresAt','renewalPriceCents','nameservers'],
  project_domain:['name','projectId','gitBranch','verified','redirect'],
  dns_record:['id','type','name','valueDisplay','ttl','priority'],
  certificate:['id','cn','validFrom','validTo','status'],
  alias:['alias','deploymentId','target','createdAt'],
  member:['id','email','role','joinedAt'],
  token:['name','scope','expiresAt','lastUsedAt'],
  firewall_rule:['id','name','action','conditionSummary','enabled'],
  drain:['id','name','status','deliveryHost'],
  webhook:['id','name','events','host'],
  charge:['project','service','startAt','endAt','amountCents']
};
export const SUMMARY_FIELDS=Object.freeze(Object.fromEntries(
  Object.entries(FIELDS).map(([name,fields])=>[name,Object.freeze(fields)])));
const BLOCKED=/^(?:value|decryptedValue|token|secret|password|accessToken|refreshToken|authorization|connectionString|privateKey|credential)$/i;
function summaryOne(kind,item){
  if(!item || typeof item!=='object' || Array.isArray(item))return item;
  const fields=SUMMARY_FIELDS[kind];
  if(!fields)return item;
  const row={};
  for(const field of fields){
    if(BLOCKED.test(field))continue;
    if(Object.hasOwn(item,field))row[field]=item[field];
  }
  if(kind==='deployment'){
    if(typeof row.commitSha==='string')row.commitSha=row.commitSha.slice(0,7);
    if(typeof row.commitMessage==='string')row.commitMessage=row.commitMessage.split('\n')[0].slice(0,160);
  }
  if(kind==='webhook' && typeof row.host==='string') {
    try {row.host=new URL(row.host).hostname;}catch{delete row.host;}
  }
  return row;
}
export function summarizeObject(kind,input){
  if(Array.isArray(input))return input.map(value=>summaryOne(kind,value));
  return summaryOne(kind,input);
}
