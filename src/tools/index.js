// The tool registry: every tool module is listed here (PLAYBOOK 4c). Empty until A-5 adds src/tools/server.js.
import { mergeNamespaces } from '../core/registry.js';
import { serverTools } from './server.js';

export const registry = mergeNamespaces([serverTools]);
