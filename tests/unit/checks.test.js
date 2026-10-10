import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWrites } from '../../scripts/check-writes.mjs';
import { checkBudgets } from '../../scripts/check-budgets.mjs';
import { checkCoreImports } from '../../scripts/check-core-imports.mjs';
import { checkCatalog, parseCatalog } from '../../scripts/check-catalog.mjs';
import { missingDocs } from '../../scripts/check-docs-updated.mjs';

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('check-writes (starting form)', () => {
  const read = { name: 'vercel_project_get', writes: false };
  const write = { name: 'vercel_project_update', writes: true, writeContract: {},
    inputSchema: { properties: { dryRun: {}, confirm: {} } } };
  it('passes well-declared read and write tools', () => expect(checkWrites([read, write])).toEqual([]));
  it('fails a write tool without dryRun/confirm or a write contract', () => {
    expect(checkWrites([{ ...write, inputSchema: { properties: {} }, writeContract: undefined }]))
      .toEqual(['vercel_project_update: write tool missing dryRun/confirm inputs',
        'vercel_project_update: write tool missing its declared write contract (defineWrite)']);
  });
  it('fails a tool that does not declare writes or lacks the vercel_ prefix', () => {
    expect(checkWrites([{ name: 'project_get' }])).toEqual(['project_get: name must start with vercel_',
      'project_get: must declare writes: true or false']);
  });
});

describe('check-budgets (starting form)', () => {
  it('fails a description over 160 characters or missing', () => {
    expect(checkBudgets([{ name: 'vercel_a', description: 'x'.repeat(161) }, { name: 'vercel_b' }]))
      .toEqual(['vercel_a: description 161 characters (max 160)', 'vercel_b: missing description']);
  });
  it('fails a listing over 20,000 estimated tokens', () => {
    const tools = Array.from({ length: 50 }, (_, i) => ({ name: `vercel_t${i}`, description: 'ok',
      inputSchema: { properties: { blob: { description: 'y'.repeat(2000) } } } }));
    expect(checkBudgets(tools).at(-1)).toMatch(/tool listing ~\d+ tokens \(max 20000\)/);
    expect(checkBudgets(tools.slice(0, 5))).toEqual([]);
  });
});

describe('check-core-imports', () => {
  function repo(files) {
    const root = mkdtempSync(join(tmpdir(), 'vercel-mcp-core-'));
    dirs.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  }
  it('passes generic core code', () => {
    const root = repo({ 'src/core/a.js': "import crypto from 'node:crypto';\nimport { b } from './b.js';\n",
      'src/core/b.js': 'export const b = 1;\n' });
    expect(checkCoreImports(root)).toEqual({ files: 2, failures: [] });
  });
  it('fails imports from src/vercel or src/tools, Vercel packages, and api.vercel.com', () => {
    const root = repo({
      'src/core/x.js': "import { c } from '../vercel/client.js';\nexport { r } from '../tools/index.js';\n",
      'src/core/deep/y.js': "const m = await import('../../vercel/ops.js');\nimport { put } from '@vercel/blob';\n",
      'src/core/z.js': "const u = 'https://api.vercel.com/v2/user';\n"
    });
    expect(checkCoreImports(root).failures.sort()).toEqual([
      'src/core/deep/y.js: imports ../../vercel/ops.js (Vercel-specific code)',
      'src/core/deep/y.js: imports package @vercel/blob',
      'src/core/x.js: imports ../tools/index.js (Vercel-specific code)',
      'src/core/x.js: imports ../vercel/client.js (Vercel-specific code)',
      'src/core/z.js: mentions api.vercel.com'
    ]);
  });
  it('passes the real repository', () => {
    expect(checkCoreImports(process.cwd()).failures).toEqual([]);
  });
});

describe('check-catalog', () => {
  const sample = (n = 2) => `# Tool catalog\n\n## Area (\`vercel_a_*\`) — ${n}\n\n| Tool | What |\n|---|---|\n` +
    '| `vercel_a_get` | x |\n| `vercel_a_set` | y |\n\n## Everything else: the universal tools — 1\n\n' +
    '| `vercel_api_read` | z |\n\n## Totals\n\n| **Hand-built total** | **2** | |\n| **All tools** | **3** | |\n';
  it('passes a consistent catalog', () => expect(checkCatalog(sample())).toEqual([]));
  it('fails a wrong section count, totals and an unlisted registered tool', () => {
    expect(checkCatalog(sample(3), ['vercel_a_get', 'vercel_ghost'])).toEqual([
      '"Area (`vercel_a_*`) — 3" says 3 tools but lists 2', 'vercel_ghost: registered in src/tools but missing from docs/TOOL-CATALOG.md']);
    expect(checkCatalog(sample().replace('**3**', '**4**'))).toEqual(['Totals: All tools says 4 but the tables list 3']);
  });
  it('fails a tool name without the vercel_ prefix or listed twice', () => {
    const text = sample().replace('vercel_a_set', 'project_set').replace('vercel_api_read', 'vercel_a_get');
    expect(checkCatalog(text)).toEqual(expect.arrayContaining(['project_set: tool names must start with vercel_ (snake case)',
      'vercel_a_get: listed twice']));
  });
  it('the real catalog lists 236 tools and is consistent', () => {
    const text = readFileSync('docs/TOOL-CATALOG.md', 'utf8');
    expect(parseCatalog(text).sections.reduce((n, s) => n + s.tools.length, 0)).toBe(236);
    expect(checkCatalog(text)).toEqual([]);
  });
});

describe('check-docs-updated (DRIFT-PROTOCOL checklist B)', () => {
  it('passes docs-only changes', () => expect(missingDocs(['docs/PLAN.md'])).toEqual([]));
  it('requires STATUS and a card when code changes', () => {
    expect(missingDocs(['src/core/registry.js'])).toEqual(['docs/STATUS.md', 'a PR card or docs/pr-cards/work-index.json']);
    expect(missingDocs(['scripts/x.mjs', 'docs/STATUS.md', 'docs/pr-cards/work-index.json'])).toEqual([]);
    expect(missingDocs(['api/mcp.js', 'docs/STATUS.md', 'docs/pr-cards/README.md'])).toEqual(['a PR card or docs/pr-cards/work-index.json']);
  });
  it('requires TOOL-CATALOG when a tool module changes', () => {
    expect(missingDocs(['src/tools/projects.js', 'docs/STATUS.md', 'docs/pr-cards/D-1.md'])).toEqual(['docs/TOOL-CATALOG.md']);
  });
  it('accepts a reasoned exception in the PR body', () => {
    expect(missingDocs(['src/core/registry.js'], 'Docs-update: not needed — comment-only change')).toEqual([]);
    expect(missingDocs(['src/core/registry.js'], 'Docs-update: not needed — ')).not.toEqual([]);
  });
});
