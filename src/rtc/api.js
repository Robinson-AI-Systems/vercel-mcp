import {createDb} from '../db.js';
import {registry} from '../tools/index.js';
import {rtcDoor} from './door.js';
import {send} from '../core/http.js';
export async function handleRtcApi(req,res,route){
  try{
    const db=createDb();
    await db.initSchema();
    return rtcDoor({db,registry})(req,res,route);
  }catch{
    return send(res,503,{ok:false,error:{
      code:'service_error',what:'RTC service temporarily unavailable',
      cause:'Account service unavailable',todo:'Retry a read later',technical:''}});
  }
}
