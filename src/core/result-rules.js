// C-1 bounded view: redact before projection, storage, audit or presentation.
import {compact} from './util.js';
import {summarizeObject} from '../tools/summaries.js';
const SECRET=/^(?:value|decryptedValue|token|accessToken|refreshToken|secret|secretValue|password|passphrase|privateKey|credential|authorization|connectionString)$/i;
const MAX_STORAGE=1048576,MAX_PATHS=20;
function stripSecrets(input,depth=0){
  if(depth>20)throw new TypeError('Result too deeply nested');
  if(Array.isArray(input))return input.map(x=>stripSecrets(x,depth+1));
  if(!input || typeof input!=='object')return input;
  if(input instanceof Date)return input;
  const out={};
  for(const [key,value] of Object.entries(input)){
    if(SECRET.test(key) || ['__proto__','constructor','prototype'].includes(key))continue;
    out[key]=stripSecrets(value,depth+1);
  }
  return out;
}
export function fieldPaths(fields){
  if(fields===undefined || fields===null || fields==='')return [];
  if(typeof fields!=='string' || fields.length>800)throw new TypeError('Invalid fields selection');
  const paths=fields.split(',').map(x=>x.trim());
  if(paths.length>MAX_PATHS || paths.some(x=>!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*){0,5}$/.test(x) ||
    x.split('.').some(k=>['__proto__','constructor','prototype'].includes(k))))
    throw new TypeError('Invalid fields path');
  return [...new Set(paths)];
}
function getPath(item,path){
  let value=item;
  for(const part of path.split('.')){
    if(!value || typeof value!=='object' || !Object.hasOwn(value,part))return {found:false};
    value=value[part];
  }
  return {found:true,value};
}
function setPath(out,path,value){
  const keys=path.split('.');let target=out;
  for(const key of keys.slice(0,-1))target=target[key]??={};
  target[keys.at(-1)]=value;
}
export function projectFields(value,fields){
  const paths=fieldPaths(fields);
  if(!paths.length)return {result:value,unknownFields:[]};
  const apply=item=>{
    if(!item || typeof item!=='object' || Array.isArray(item))return {result:{},unknownFields:paths};
    const result={},unknown=[];
    for(const path of paths){
      const found=getPath(item,path);
      if(found.found)setPath(result,path,found.value);else unknown.push(path);
    }
    return {result,unknownFields:unknown};
  };
  if(Array.isArray(value)){
    const rows=value.map(apply);
    return {result:rows.map(x=>x.result),unknownFields:[...new Set(rows.flatMap(x=>x.unknownFields))]};
  }
  return apply(value);
}
export function prepareResult(value,{detail='summary',fields,kind}={}){
  if(!['summary','full'].includes(detail))throw new TypeError('Invalid detail; use summary or full');
  // JSON deep copy and credential-like content masking before any projection.
  const safe=compact(stripSecrets(value),MAX_STORAGE);
  const view=detail==='summary' && kind ? summarizeObject(kind,safe):safe;
  const projected=projectFields(view,fields);
  return {result:compact(projected.result,MAX_STORAGE),unknownFields:projected.unknownFields};
}
