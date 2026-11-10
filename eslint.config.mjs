import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.nx/**',
      'docs/**',
      '**/*.d.ts',
      '**/temp-boundary-*.ts'
    ]
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      curly: ['error', 'all']
    }
  },
  {
    files: ['apps/{mcp-server,orchestrator}/src/{domain,application}/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/adapters/**',
                '**/transport/**',
                '**/http/**',
                '../adapters/**',
                '../transport/**',
                '../http/**',
                '../../adapters/**',
                '../../transport/**',
                '../../http/**'
              ],
              message:
                'Hexagonal boundary violation: domain and application layers must not import adapters, transport, or http layers.'
            },
            {
              group: ['express', 'axios', '@modelcontextprotocol/sdk'],
              message:
                'Hexagonal boundary violation: domain and application layers must not import external infrastructure libraries directly.'
            }
          ]
        }
      ]
    }
  }
);
