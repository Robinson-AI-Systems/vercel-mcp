// Copied from Robinson-AI-Systems/stripe-mcp src/core/registry.js @ e2f90e8 (unchanged).
import { isGuardedWrite } from './write.js';

/** Contract-generic registry: no service-specific imports. */
export function mergeNamespaces(modules) {
  const tools = [];
  const handlers = Object.create(null);
  const seen = new Set();
  for (const mod of modules) {
    for (const tool of mod.tools) {
      if (!tool?.name || seen.has(tool.name) || Object.hasOwn(handlers, tool.name)) {
        throw new Error(`Duplicate or invalid tool name registered: ${tool?.name}`);
      }
      if (typeof mod.handlers?.[tool.name] !== 'function') {
        throw new Error(`Missing handler for registered tool: ${tool.name}`);
      }
      if (tool.writes === true && tool.localAdmin !== true &&
          !isGuardedWrite(tool, mod.handlers[tool.name])) {
        throw new Error(`Untrusted guarded-write handler registered: ${tool.name}`);
      }
      seen.add(tool.name);
      tools.push(tool);
      handlers[tool.name] = mod.handlers[tool.name];
    }
  }
  return { tools, handlers };
}
