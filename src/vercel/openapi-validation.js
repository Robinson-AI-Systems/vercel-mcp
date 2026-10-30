// A-4: fail-closed request validation against the exact vendored official API.
// The full snapshot is parsed lazily and only schemas used by OPS are compiled.
import fs from 'node:fs';
import Ajv from 'ajv';
import { operation } from './operations.js';

const SNAPSHOT = new URL('../../vendor/vercel-openapi/openapi-2026-10-11.json', import.meta.url);
let spec;
const validators = new Map();
const HTTP_METHODS = ['get', 'head', 'delete', 'post', 'put', 'patch'];
// Some pinned OpenAPI 3.0 parameters declare nullable without type. AJV forbids
// that invalid combination. Remove ONLY the unsupported annotation, never enum,
// pattern, reference or composition constraints; an ambiguous null fails closed.
export function normalizeNullableDeclarations(value){
  if(Array.isArray(value))return value.map(normalizeNullableDeclarations);
  if(!value || typeof value!=='object')return value;
  const fixed=Object.fromEntries(Object.entries(value)
    .filter(([key])=>!(key==='nullable' && !Object.hasOwn(value,'type')))
    .map(([key,child])=>[key,normalizeNullableDeclarations(child)]));
  // Exact duplicate oneOf alternatives in the pinned snapshot make every
  // matching value invalid (Vercel Git namespaceId repeats string/number twice).
  // Collapse IDENTICAL schemas only, preserving unrelated oneOf exclusions.
  if(Array.isArray(fixed.oneOf))fixed.oneOf=[...new Map(
    fixed.oneOf.map(option=>[JSON.stringify(option),option])
  ).values()];
  return fixed;
}
let normalizedComponents;


export function readOpenApi() {
  if (!spec) spec = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  return spec;
}

function findDocumented(op){
  if(typeof op!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(op))
    throw new TypeError('Invalid documented operation');
  const matches=[];
  for(const [path,pathItem] of Object.entries(readOpenApi().paths))
    for(const method of HTTP_METHODS){
      const specOperation=pathItem[method];
      if(specOperation?.operationId===op)matches.push({path,method:method.toUpperCase(),pathItem,specOperation});
    }
  return matches;
}
function documentedRow(matches){
  const row=matches[0];
  // Team query is injected only where declared. A path-bound team is
  // independently checked by the transport against the stored account.
  row.teamScoped=[...(row.pathItem.parameters||[]),...(row.specOperation.parameters||[])]
    .some(p=>p.in==='query'&&p.name==='teamId');
  return row;
}
export function documentedRead(op){
  const matches=findDocumented(op);
  if(matches.length!==1||!['GET','HEAD'].includes(matches[0].method))
    throw new TypeError('Only an unambiguous documented GET or HEAD is allowed');
  return documentedRow(matches);
}
// Batch U (U-1 write side): the guarded write path resolves documented
// write operations through the same unique-operation rule. Callers still
// validate the full request against the snapshot before any I/O; this
// resolver only establishes that the operation exists exactly once and
// mutates.
export function documentedWrite(op){
  const matches=findDocumented(op);
  if(matches.length!==1||!['POST','PUT','PATCH','DELETE'].includes(matches[0].method))
    throw new TypeError('Only an unambiguous documented POST, PUT, PATCH or DELETE is allowed');
  return documentedRow(matches);
}
export function documentedOperation(op){
  const matches=findDocumented(op);
  if(matches.length!==1)
    throw new TypeError('Unknown or ambiguous documented operation');
  return documentedRow(matches);
}
export function openApiOperation(id) {
  if(typeof id==='string'&&id.startsWith('api:'))return documentedOperation(id.slice(4));
  const { path, method } = operation(id);
  const doc = readOpenApi();
  const pathItem = doc.paths?.[path];
  const specOperation = pathItem?.[method.toLowerCase()];
  if (!HTTP_METHODS.includes(method.toLowerCase()) || !specOperation) {
    throw new TypeError('Operation missing from official OpenAPI snapshot');
  }
  return { method, path, pathItem, specOperation };
}

function compile(schema, id) {
  if (validators.has(id)) return validators.get(id);
  // Pinned Git namespaceId declares the union as malformed duplicated oneOf.
  // Under normal query-string coercion both numeric and string arms match.
  // This exact API parameter is a union-of-types; do not loosen other oneOf.
  let normalized=normalizeNullableDeclarations(schema);
  if(id==='git_repos_search:query:namespaceId' && Array.isArray(normalized.oneOf)){
    const {oneOf,...rest}=normalized;
    normalized={...rest,anyOf:oneOf};
  }
  // Root-wrapper lets component $refs resolve at #/components/schemas/*.
  const root = { type: 'object', required: ['value'],
    properties: { value: normalized },
    components: normalizedComponents ??= normalizeNullableDeclarations(readOpenApi().components || {}) };
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, coerceTypes: true, allowUnionTypes: true });
  const validator = ajv.compile(root);
  validators.set(id, validator);
  return validator;
}

function validateSchema(schema, value, key) {
  if (!schema) return;
  const ok = compile(schema, key)({ value });
  if (!ok) throw new TypeError('Invalid Vercel API parameter schema: ' + key);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate path/query/body for one published operation, before any network call.
 * Unknown path/query keys fail. Never interpolate or log caller-supplied values.
 */
export function validateRequest(id, { path = {}, query = {}, body } = {}) {
  const { path: template, method, pathItem, specOperation } = openApiOperation(id);
  if (!plainObject(path) || !plainObject(query)) throw new TypeError('Path and query must be objects');
  const placeholders = [...template.matchAll(/\{([^}]+)\}/g)].map(x => x[1]);
  for (const name of placeholders) {
    if (!Object.hasOwn(path, name) || path[name] === '' || path[name] == null) {
      throw new TypeError('Missing required API path parameter: ' + name);
    }
  }
  for (const key of Object.keys(path)) {
    if (!placeholders.includes(key)) throw new TypeError('Unknown API path parameter');
  }
  const parameters = [...(pathItem.parameters || []), ...(specOperation.parameters || [])];
  const byKey = new Map();
  for (let param of parameters) {
    if (param.$ref) {
      const name = param.$ref.split('/').at(-1);
      param = readOpenApi().components?.parameters?.[name];
      if (!param) throw new TypeError('Unresolved API parameter reference');
    }
    byKey.set(param.in + ':' + param.name, param);
  }
  // Vercel uses teamId across endpoints (including user reads); do not permit
  // caller-supplied teamId to override the selected account's scope.
  for (const key of Object.keys(query)) {
    if (!byKey.has('query:' + key) && (key !== 'teamId'||id.startsWith('api:'))) {
      throw new TypeError('Unknown API query parameter: ' + key);
    }
  }
  for (const param of byKey.values()) {
    // Official 2026-10-11 snapshot mistakenly declares a required cmdId
    // QUERY parameter for POST /v2/.../cmd (runSessionCommand).
    // The published SDK and provider both take only sessionId and JSON body;
    // cmdId is a response field, impossible to know before POST. Strictly
    // exempt only this single demonstrably impossible parameter; do not relax
    // body/path/query validation or any other operation.
    if(id==='sandbox_command_run'&&param.in==='query'&&param.name==='cmdId')
      continue;
    const input = param.in === 'path' ? path : param.in === 'query' ? query : null;
    if (!input) continue;
    if (param.required && (input[param.name] == null || input[param.name] === '')) {
      throw new TypeError('Missing required API parameter: ' + param.name);
    }
    if (input[param.name] !== undefined) {
      validateSchema(param.schema, input[param.name], id + ':' + param.in + ':' + param.name);
    }
  }
  const requestBody = specOperation.requestBody?.$ref
    ? readOpenApi().components?.requestBodies?.[specOperation.requestBody.$ref.split('/').at(-1)]
    : specOperation.requestBody;
  if (body === undefined) {
    if (requestBody?.required) throw new TypeError('Missing required API body');
  } else {
    if (!requestBody) throw new TypeError('API operation does not accept a body');
    const schema = requestBody.content?.['application/json']?.schema;
    if (!schema) throw new TypeError('API body is not declared as JSON in the snapshot');
    validateSchema(schema, body, id + ':body');
  }
  if (['GET', 'HEAD'].includes(method) && body !== undefined) {
    throw new TypeError('Read operation cannot send a body');
  }
  return true;
}
