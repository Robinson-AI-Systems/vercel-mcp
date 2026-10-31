// Default-deny MCP boundary: only explicitly read-only handlers may run before Batch B.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpToken } from './mcp-auth.js';
import { SERVICE_TECHNICAL_NAME, SERVICE_DISPLAY_NAME, SERVICE_VERSION } from '../service-identity.js';
import { visibleToProfile, listProfileTools, profileToolCounts as countByProfile } from './profiles.js';
import { FRONT_DOOR_TOOLS } from '../data/front-door.js';

// Explicit local owner operations are the only writes permitted before the general gateway.
const LOCAL_OWNER_TOOLS = ['vercel_enable_production', 'vercel_disable_production',
  'vercel_set_default_account', 'vercel_set_spend_limit', 'vercel_revoke_connection', 'vercel_create_pass',
  'vercel_set_working_box', 'vercel_remove_account', 'vercel_apply_owner_approval',
  'vercel_set_read_only'];
const COMPACT_TOOLS = ['vercel_whoami','vercel_search_tools','vercel_describe_tool',
  'vercel_get_result','vercel_call','vercel_batch','vercel_api_search'];
const FRONT_DOOR_SET = new Set(FRONT_DOOR_TOOLS);
// AUD-AQ gate 1 (listing) and gate 2 (dispatch) share one predicate: while
// a connection's own read-only switch is on, every write is closed to it —
// except the switch itself, the one write whose subject is the switch, so
// the user can always flip back. Pass connections never carry the flag
// (the RTC door mints them without it), so passes are untouched here.
const READ_ONLY_SWITCH_TOOL = 'vercel_set_read_only';
const switchAllows = (tool, connection) =>
  connection?.readOnly !== true || tool?.writes === false ||
  tool?.name === READ_ONLY_SWITCH_TOOL;
export const listMcpTools = (registry, connection) => {
  // Listing entries are public shapes: the registry's `writes` field is
  // internal and stripped from them, so gate 1 resolves each listed
  // name back to its definition before judging it.
  const definitions = new Map((registry?.tools || []).map(tool => [tool.name, tool]));
  return listProfileTools(registry, connection?.profile, { localOwnerTools: LOCAL_OWNER_TOOLS })
    .filter(tool=>switchAllows(definitions.get(tool.name), connection))
    .filter(tool=>{
      // While the switch is on, the switch itself stays listed under every
      // listing: a read-only connection must see its own way back.
      if (connection?.readOnly === true && tool.name === READ_ONLY_SWITCH_TOOL) return true;
      // front_door (OP-1/D-C): the versioned membership in src/data/front-door.json
      // intersected with this connection's profile-permitted tools; compound
      // workflow tools join the front door as they are built (BATCH-C D-C).
      if (connection?.listing==='front_door')
        return FRONT_DOOR_SET.has(tool.name) || tool.name.startsWith('vercel_workflow_');
      if (connection?.listing!=='compact') return true;
      return COMPACT_TOOLS.includes(tool.name) || tool.name.startsWith('vercel_workflow_');
    })
    .map(tool=>{
      // Public descriptors have writes stripped; use authenticated metadata.
      const read=registry.tools.find(item=>item.name===tool.name)?.writes===false;
      const annotations={
        readOnlyHint:read,destructiveHint:false,idempotentHint:read,
        openWorldHint:true,...tool.annotations
      };
      if(!read || tool.name==='vercel_get_result')return {...tool,annotations};
      return {...tool,annotations,inputSchema:{
        ...tool.inputSchema,properties:{...tool.inputSchema?.properties,
          fields:{type:'string',maxLength:800,description:'Comma-separated safe dotted result fields'},
          detail:{type:'string',enum:['summary','full'],description:'Small summary or full read view'}
        }
      }};
    });
};
export const profileToolCounts = registry =>
  countByProfile(registry, { localOwnerTools: LOCAL_OWNER_TOOLS });
function mayUse(tool, connection) {
  // AUD-AQ gate 2 (dispatch): the switch refuses by name, before the
  // profile predicate — a full-profile connection with its switch on
  // cannot invoke any write except the switch itself.
  if (!switchAllows(tool, connection)) return false;
  return visibleToProfile(tool, connection?.profile, { localOwnerTools: LOCAL_OWNER_TOOLS });
}
export async function dispatchReadOnlyTool({ registry, name, args, connection, db, env, fetchImpl, formatError, shapeResult }) {
  const item = registry.tools.find((tool) => tool.name === name);
  if (!mayUse(item, connection)) {
    return { isError: true, content: [{ type: 'text', text: 'Tool unavailable for this connection' }] };
  }
  const handler = registry.handlers[name];
  if (typeof handler !== 'function') {
    return { isError: true, content: [{ type: 'text', text: 'Tool unavailable' }] };
  }
  try {
    const view={};
    let handlerArgs=args || {};
    if(item.writes===false && name!=='vercel_get_result'){
      if(handlerArgs && typeof handlerArgs==='object' && !Array.isArray(handlerArgs)){
        view.fields=handlerArgs.fields;
        view.detail=handlerArgs.detail;
        if(view.detail!==undefined && !['summary','full'].includes(view.detail))
          return {isError:true,content:[{type:'text',text:'Invalid detail selection'}]};
        if(view.fields!==undefined && (typeof view.fields!=='string' || view.fields.length>800))
          return {isError:true,content:[{type:'text',text:'Invalid fields selection'}]};
        handlerArgs={...handlerArgs};
        delete handlerArgs.fields;delete handlerArgs.detail;
      }
    }
    const dispatchTool=(innerName,innerArgs)=>dispatchReadOnlyTool({
      registry,name:innerName,args:innerArgs,connection,db,env,fetchImpl,
      formatError,shapeResult
    });
    const result=await handler(handlerArgs,{connection,db,env,fetchImpl,registry,dispatchTool});
    if(name==='vercel_call' && result?.__delegated===true)return result.response;
    return typeof shapeResult==='function' ? await shapeResult(result,{
      connection,tool:name,args:view,db,readOnly:item.writes===false
    }) : result;
  } catch (caught) {
    if (typeof formatError === 'function') {
      try {
        const retry = caught?.retryAfterMs;
        return formatError(caught, {
          team: connection?.account, operation: name,
          projectScoped: connection?.projectScoped === true,
          project: connection?.projectName,
          resetAtMs: Number.isFinite(retry) && retry >= 0 ? Date.now() + retry : undefined
        });
      } catch { /* safe default below */ }
    }
    return { isError: true, content: [{ type: 'text', text: 'Could not read account details; check server setup' }] };
  }
}

export function createMcpHandler({ db, registry, env = process.env, formatError, shapeResult }) {
  return async function mcp(req, res) {
    const connection = await requireMcpToken(req, res, db, env);
    if (!connection) return;
    const server = new Server({ name: SERVICE_TECHNICAL_NAME, title: SERVICE_DISPLAY_NAME, version: SERVICE_VERSION }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: listMcpTools(registry, connection)
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      dispatchReadOnlyTool({
        registry,
        name: request.params?.name,
        args: request.params?.arguments,
        connection,
        db, env, formatError, shapeResult
      })
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on?.('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  };
}
