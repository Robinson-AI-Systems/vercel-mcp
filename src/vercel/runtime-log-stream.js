// Read a potentially unending runtime log stream without buffering or revealing
// raw log text beyond a strict private, short-lived parsing budget.
const MAX_BYTES=32768;
const MAX_ROWS=50;

export async function readBoundedRuntimeLogs(response,signal){
  const reader=response.body?.getReader?.();
  if(!reader)throw new TypeError('Provider did not supply a readable log stream');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let pending='',bytesRead=0,cutoff='stream_end',ended=false;
  const records=[];
  const add=value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw new TypeError('Invalid provider runtime log entry');
    records.push(value);
  };
  const parseLine=text=>{
    if(!text.trim())return;
    let item;
    try{item=JSON.parse(text);}
    catch{throw new TypeError('Invalid provider runtime log framing');}
    if(Array.isArray(item)){
      const remaining=MAX_ROWS-records.length;
      if(item.length>remaining)cutoff='row_limit';
      for(const row of item.slice(0,remaining))add(row);
    }else add(item);
  };
  const flushLines=()=>{
    let index;
    while(records.length<MAX_ROWS && (index=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,index);
      pending=pending.slice(index+1);
      parseLine(line);
    }
  };
  let cancelTimeout;
  const timeout=new Promise((_,reject)=>{
    if(signal.aborted)reject(new TypeError('Log stream deadline'));
    else{
      cancelTimeout=()=>reject(new TypeError('Log stream deadline'));
      signal.addEventListener('abort',cancelTimeout,{once:true});
    }
  });
  try{
    while(records.length<MAX_ROWS){
      let part;
      try{part=await Promise.race([reader.read(),timeout]);}
      catch(e){
        if(!signal.aborted)throw e;
        cutoff='time_limit';break;
      }
      if(part.done){ended=true;break;}
      if(!(part.value instanceof Uint8Array))throw new TypeError('Invalid log bytes');
      if(bytesRead+part.value.byteLength>MAX_BYTES){cutoff='byte_limit';break;}
      bytesRead+=part.value.byteLength;
      pending+=decoder.decode(part.value,{stream:true});
      if(Buffer.byteLength(pending,'utf8')>MAX_BYTES){cutoff='byte_limit';break;}
      flushLines();
    }
    if(records.length>=MAX_ROWS)cutoff='row_limit';
    if(ended && records.length<MAX_ROWS){
      pending+=decoder.decode();
      if(pending.trim())parseLine(pending);
    }
  }finally{
    if(cancelTimeout)signal.removeEventListener('abort',cancelTimeout);
    // End a live stream immediately instead of keeping a Vercel invocation open.
    Promise.resolve(reader.cancel()).catch(()=>{});
  }
  return {records,stream:{bytesRead,received:records.length,cutoff,
    complete:false,reason:'Provider live stream cannot establish full window completeness'}};
}
