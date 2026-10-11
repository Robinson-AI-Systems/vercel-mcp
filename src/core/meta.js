// Provider-neutral discovery of a pre-filtered, profile-authorized catalog.
const safe=(v,max=160)=>typeof v==='string'&&v.length>0&&v.length<=max;
const cap=20;
export function searchVisibleTools(catalog,{query,area,audience,limit=10}={}){
  if(!Array.isArray(catalog) || !safe(query,120) ||
    (area!==undefined && !safe(area,48)) ||
    (audience!==undefined && !safe(audience,48)) ||
    !Number.isInteger(limit) || limit<1 || limit>cap)
    throw new TypeError('Invalid tool search');
  const tokens=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!tokens.length || tokens.length>10)throw new TypeError('Invalid tool search');
  const rows=catalog.filter(x=>(area===undefined || x.area===area) &&
      (audience===undefined || x.audience?.includes(audience)))
    .map(tool=>{
      const hay=(tool.name+' '+(tool.description||'')).toLowerCase();
      const score=tokens.reduce((n,word)=>n+(hay.includes(word)?1:0),0);
      return {name:tool.name,description:tool.description,score,
        safety:tool.name.startsWith('vercel_') && tool.annotations?.readOnlyHint===false?
          'write (confirmation and applicable owner approval required)':'read-only'};
    }).filter(x=>x.score===tokens.length)
    .sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name));
  return {count:rows.length,tools:rows.slice(0,limit).map(({score,...row})=>row),
    hasMore:rows.length>limit};
}
export function describeVisibleTool(catalog,name){
  if(!Array.isArray(catalog) || !safe(name,100) || !/^vercel_[a-z0-9_]+$/.test(name))
    throw new TypeError('Invalid tool name');
  const tool=catalog.find(x=>x.name===name);
  if(!tool)return null;
  return {name:tool.name,description:tool.description,inputSchema:tool.inputSchema,
    annotations:tool.annotations,area:tool.area||'server',
    safety:tool.annotations?.readOnlyHint===false?'guarded write':'read-only'};
}
