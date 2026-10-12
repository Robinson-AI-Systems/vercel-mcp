import {handleRtcApi} from '../../src/rtc/api.js';
export default (req,res)=>handleRtcApi(req,res,req.method==='GET'?'describe':'invoke');
