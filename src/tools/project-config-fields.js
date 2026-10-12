// Strict reusable project build configuration; pinned OpenAPI validates whole body.
export const COMMAND_SETTINGS=Object.freeze(['buildCommand','installCommand','devCommand','commandForIgnoringBuildStep']);
export const DIRECTORY_SETTINGS=Object.freeze(['rootDirectory','outputDirectory']);
export const CONFIG_SETTINGS=Object.freeze([...COMMAND_SETTINGS,...DIRECTORY_SETTINGS]);
export const configFields=Object.freeze(Object.fromEntries(CONFIG_SETTINGS.map(key=>[key,{
  type:'string',minLength:1,maxLength:COMMAND_SETTINGS.includes(key)?2048:500
}])));
export function invalidProjectConfiguration(args){
  return COMMAND_SETTINGS.some(key=>args[key]!==undefined&&(
    typeof args[key]!=='string'||args[key].length<1||args[key].length>2048||
    /[\u0000-\u001f\u007f]/.test(args[key])))||
    DIRECTORY_SETTINGS.some(key=>args[key]!==undefined&&(
      typeof args[key]!=='string'||args[key].length<1||args[key].length>500||
      args[key].startsWith('/')||args[key].includes('\\')||
      args[key].split('/').some(part=>!part||part==='..')||
      /[\u0000-\u001f\u007f]/.test(args[key])));
}
export function providerConfigBody(args){
  return Object.fromEntries(CONFIG_SETTINGS.filter(key=>args[key]!==undefined)
    .map(key=>[key,args[key]]));
}
