import eslint from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	// Global ignores
	{
		ignores: ['build/', '.svelte-kit/', 'node_modules/', 'test-data/']
	},

	// Base JS/TS rules
	eslint.configs.recommended,
	...tseslint.configs.recommended,

	// Svelte recommended
	...svelte.configs.recommended,

	// Global language options
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				NotificationPermission: 'readonly'
			}
		}
	},

	// TypeScript rules
	{
		files: ['**/*.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'@typescript-eslint/consistent-type-imports': [
				'warn',
				{ prefer: 'type-imports', fixStyle: 'separate-type-imports' }
			],
			'@typescript-eslint/no-non-null-assertion': 'error'
		}
	},

	// Svelte files use TypeScript parser
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		},
		rules: {
			// Svelte template refs are invisible to TS unused-vars analysis
			'@typescript-eslint/no-unused-vars': 'off',
			'no-unused-vars': 'off',
			// Static hrefs don't need resolveRoute
			'svelte/no-navigation-without-resolve': 'off',
			// Svelte 5 runes use writable derived differently
			'svelte/prefer-writable-derived': 'off'
		}
	}
);
