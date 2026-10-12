import {createDb} from '../db.js';
import {registry} from '../tools/index.js';
import {rtcDoor} from './door.js';
import {send} from '../core/http.js';

// Reject malformed requests before initializing SQL; anonymous traffic
// should not wake the account database for schema checks.
const ROUTES=Object.freeze({whoami:'GET',list:'GET',describe:'GET',
  invoke:'POST',batch:'POST',result:'GET'});
const BEARER=/^Bearer rtc_pass_[A-Za-z0-9_-]{43}$/;
function reject(res,status,code,what){
  return send(res,status,{ok:false,error:{code,what,cause:what,
    todo:'Check the request or scoped RTC pass.',technical:''}});
}
export async function handleRtcApi(req,res,route,{
  dbFactory=createDb,toolRegistry=registry
}={}){
  if(!Object.hasOwn(ROUTES,route))
    return reject(res,404,'not_found','The requested RTC route is unavailable');
  if(req?.method!==ROUTES[route])
    return reject(res,400,'invalid_args','Invalid RTC API method');
  if(typeof req.headers?.authorization!=='string'||
    !BEARER.test(req.headers.authorization))
    return reject(res,401,'permission','A valid RTC pass is required');
  try{
    const db=dbFactory();
    await db.initSchema();
    return await rtcDoor({db,registry:toolRegistry})(req,res,route);
  }catch{
    return reject(res,503,'service_error','RTC service temporarily unavailable');
  }
}
