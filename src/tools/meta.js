// Meta reads only see tools already authorized through the MCP profile guard.
import {listMcpTools} from '../core/mcp-server.js';
import {searchVisibleTools,describeVisibleTool} from '../core/meta.js';
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
    {name:'vercel_describe_tool',writes:false,profiles:PROFILES,
      description:'Describe the exact schema and safety of one tool available to this connection.',
      inputSchema:{type:'object',properties:{
        name:{type:'string',pattern:'^vercel_[a-z0-9_]+$'}
      },required:['name'],additionalProperties:false},
      annotations:{readOnlyHint:true}
    }
  ],
  handlers:{
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
