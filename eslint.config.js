// Deliberately lightweight Node/ESM lint; correctness is exercised by tests.
// Copied from Robinson-AI-Systems/stripe-mcp eslint.config.js @ e2f90e8.
export default [{
  files: ['**/*.{js,mjs}'],
  ignores: ['node_modules/**', 'coverage/**', 'vendor/**', '.cache/**'],
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-constant-condition': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-dupe-keys': 'error',
    'no-redeclare': 'error'
  }
}];
