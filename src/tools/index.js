// The tool registry: every tool module is listed here (PLAYBOOK 4c). Empty until A-5 adds src/tools/server.js.
import { mergeNamespaces } from '../core/registry.js';
import { serverTools } from './server.js';
import { productionTools } from './production.js';
import { protectedTools } from './protected.js';
import { observabilityTools } from './observability.js';
import { ownerTools } from './owner.js';
import {metaTools} from './meta.js';
import {projectsTools} from './projects.js';
import {gitTools} from './git.js';
import {cronsTools} from './crons.js';
import {projectCreateTools} from './project-create.js';
import {projectSettingsTools} from './project-settings.js';
import {projectMemberTools} from './project-members.js';

export const registry = mergeNamespaces([serverTools, productionTools, protectedTools, observabilityTools, ownerTools, metaTools, projectsTools, gitTools, cronsTools, projectCreateTools, projectSettingsTools, projectMemberTools]);
