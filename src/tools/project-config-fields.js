// Strict reusable project build configuration; pinned OpenAPI validates whole body.
export const COMMAND_SETTINGS=Object.freeze(['buildCommand','installCommand','devCommand','commandForIgnoringBuildStep']);
export const DIRECTORY_SETTINGS=Object.freeze(['rootDirectory','outputDirectory']);
export const CONFIG_SETTINGS=Object.freeze([...COMMAND_SETTINGS,...DIRECTORY_SETTINGS]);
export const CONFIG_MAX_LENGTH=256;
// PATCH supports explicit null to clear overrides. POST create accepts only concrete values.
const valueSchema=Object.freeze({type:'string',minLength:1,maxLength:CONFIG_MAX_LENGTH});
export const createConfigFields=Object.freeze(Object.fromEntries(CONFIG_SETTINGS.map(key=>[key,valueSchema])));
export const configFields=Object.freeze(Object.fromEntries(CONFIG_SETTINGS.map(key=>[key,{
  anyOf:[valueSchema,{type:'null'}],
  description:'Set an override, or use null to reset it to Vercel defaults'
}])));
export function invalidProjectConfiguration(args,{nullable=false}={}){
  return COMMAND_SETTINGS.some(key=>args[key]!==undefined&&!(nullable&&args[key]===null)&&(
    typeof args[key]!=='string'||args[key].length<1||args[key].length>CONFIG_MAX_LENGTH||
    /[\u0000-\u001f\u007f]/.test(args[key])))||
    DIRECTORY_SETTINGS.some(key=>args[key]!==undefined&&!(nullable&&args[key]===null)&&(
      typeof args[key]!=='string'||args[key].length<1||args[key].length>CONFIG_MAX_LENGTH||
      args[key].startsWith('/')||args[key].includes('\\')||
      args[key].split('/').some(part=>!part||part==='..')||
      /[\u0000-\u001f\u007f]/.test(args[key])));
}
export function providerConfigBody(args){
  return Object.fromEntries(CONFIG_SETTINGS.filter(key=>args[key]!==undefined)
    .map(key=>[key,args[key]]));
}
// The provider may omit a cleared override instead of returning an explicit null.
export function sameProjectConfiguration(expected,observed){
  return expected===null?(observed===null||observed===undefined):expected===observed;
}
