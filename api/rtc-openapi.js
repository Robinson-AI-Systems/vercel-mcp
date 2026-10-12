import {rtcOpenApi} from '../src/core/rtc-contract.js';
import {send,only} from '../src/core/http.js';
export default function handler(req,res){
  if(!only(res,req,['GET']))return;
  return send(res,200,rtcOpenApi());
}
