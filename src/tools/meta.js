// Meta reads only see tools already authorized through the MCP profile guard.
import {listMcpTools} from '../core/mcp-server.js';
import {searchVisibleTools,describeVisibleTool} from '../core/meta.js';
import {visibleToProfile} from '../core/profiles.js';
const PROFILES=['read_only','everyday','full'];
const out=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function denied(){return {isError:true,content:[{type:'text',text:'Invalid or unavailable tool request'}]};}
export const metaTools={
  tools:[
    {name:'vercel_search_tools',writes:false,profiles:PROFILES,
      description:'Search the tools available to this connection without exposing other profiles or owner resources.',
      inputSchema:{type:'object',properties:{
        query:{type:'string',minLength:1,maxLength:120},
        area:{type:'string',maxLength:48},audience:{type:'string',maxLength:48},
        limit:{type:'integer',minimum:1,maximum:20}
      },required:['query'],additionalProperties:false},
      annotations:{readOnlyHint:true}
    },
    {name:'vercel_call',writes:false,profiles:PROFILES,
      description:'Invoke an eligible tool by name through the exact MCP authorization, safety and owner-approval gates.',
      inputSchema:{type:'object',properties:{
        name:{type:'string',pattern:'^vercel_[a-z0-9_]+$'},
        args:{type:'object'}
      },required:['name'],additionalProperties:false},
      annotations:{readOnlyHint:false}
    },
    {name:'vercel_batch',writes:false,profiles:PROFILES,
      description:'Execute at most ten already-authorized read tools; refuse all writes before any call.',
      inputSchema:{type:'object',properties:{
        calls:{type:'array',minItems:1,maxItems:10,items:{
          type:'object',properties:{name:{type:'string'},args:{type:'object'}},
          required:['name'],additionalProperties:false
        }}
      },required:['calls'],additionalProperties:false},
      annotations:{readOnlyHint:true}
    },
    {name:'vercel_describe_tool',writes:false,profiles:PROFILES,
      description:'Describe the exact schema and safety of one tool available to this connection.',
      inputSchema:{type:'object',properties:{
        name:{type:'string',pattern:'^vercel_[a-z0-9_]+$'}
      },required:['name'],additionalProperties:false},
      annotations:{readOnlyHint:true}
    }
  ],
  handlers:{
    async vercel_call(params,{dispatchTool}){
      if(!params || typeof params!=='object' || Array.isArray(params) ||
        Object.keys(params).some(k=>!['name','args'].includes(k)) ||
        typeof params.name!=='string' || !/^vercel_[a-z0-9_]+$/.test(params.name) ||
        ['vercel_call','vercel_batch'].includes(params.name) ||
        (params.args!==undefined && (!params.args || typeof params.args!=='object' ||
          Array.isArray(params.args))) || typeof dispatchTool!=='function')return denied();
      // Dispatch the named operation through exactly the same wrapped pipeline
      // as the direct MCP CallTool door. Never call a raw registry handler.
      return {__delegated:true,response:await dispatchTool(params.name,params.args||{})};
    },
    async vercel_batch(params,{registry,connection,dispatchTool}){
      if(!params || typeof params!=='object' || Array.isArray(params) ||
        Object.keys(params).some(k=>k!=='calls') ||
        !Array.isArray(params.calls) || params.calls.length<1 ||
        params.calls.length>10 || typeof dispatchTool!=='function')return denied();
      for(const call of params.calls){
        if(!call || typeof call!=='object' || Array.isArray(call) ||
          Object.keys(call).some(k=>!['name','args'].includes(k)) ||
          typeof call.name!=='string' ||
          (call.args!==undefined && (!call.args || typeof call.args!=='object' ||
            Array.isArray(call.args))))return denied();
        const def=registry?.tools.find(t=>t.name===call.name);
        // A delegate may not be batched: vercel_call is declared a read but
        // can dispatch a write, so batches contain direct read tools only.
        if(!def || call.name==='vercel_call' || def.writes!==false ||
          !visibleToProfile(def,connection?.profile))
          return denied();
      }
      const results=[];
      for(const call of params.calls){
        const result=await dispatchTool(call.name,call.args||{});
        results.push({name:call.name,result});
      }
      return out({count:results.length,results});
    },
    async vercel_search_tools(args,{registry,connection}){
      if(!args || typeof args!=='object' || Array.isArray(args) ||
        Object.keys(args).some(k=>!['query','area','audience','limit'].includes(k)))return denied();
      try{return out(searchVisibleTools(listMcpTools(registry,{...connection,listing:'catalog'}),args));}
      catch{return denied();}
    },
    async vercel_describe_tool(args,{registry,connection}){
      if(!args || typeof args!=='object' || Array.isArray(args) ||
        Object.keys(args).some(k=>k!=='name'))return denied();
      try{
        const result=describeVisibleTool(listMcpTools(registry,{...connection,listing:'catalog'}),args.name);
        return result?out(result):denied();
      }catch{return denied();}
    }
  }
};
