import eslintComments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import eslint from "@eslint/js";
import vitestPlugin from "@vitest/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import deMorgan from "eslint-plugin-de-morgan";
import nodePlugin from "eslint-plugin-n";
import onlyError from "eslint-plugin-only-error";
import promisePlugin from "eslint-plugin-promise";
import regexpPlugin from "eslint-plugin-regexp";
import securityPlugin from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

// eslint-disable-next-line @typescript-eslint/no-deprecated
export default tseslint.config(
	// ============================================================
	// 🚫 GLOBAL IGNORES
	// ============================================================
	{
		ignores: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/coverage/**",
			".*/**",
		],
	},

	// ============================================================
	// ⛔ TREAT ALL WARNINGS AS ERRORS
	// ============================================================
	{
		plugins: {
			"only-error": onlyError,
		},
	},

	// ============================================================
	// ✅ CORE: Language & Code Quality
	// ============================================================
	eslint.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	deMorgan.configs.recommended,
	unicorn.configs.recommended,
	promisePlugin.configs["flat/recommended"],
	securityPlugin.configs.recommended,
	sonarjs.configs.recommended,
	regexpPlugin.configs["flat/recommended"],
	eslintComments.recommended,

	// ============================================================
	// ✅ CORE: TypeScript Type-Aware Linting
	// ============================================================
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						"eslint.config.mjs",
						"vitest.config.*",
					],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},

	// ============================================================
	// 🖥️ NODE.JS — applies to all src/ and spikes/
	// ============================================================
	{
		files: ["src/**/*.ts", "spikes/**/*.ts", "scripts/**/*.ts"],
		plugins: {
			n: nodePlugin,
		},
		settings: {
			n: {
				version: ">=22.0.0",
			},
		},
		rules: {
			...nodePlugin.configs["flat/recommended"].rules,
			// Handled by TypeScript / bundler resolution
			"n/no-missing-import": "off",
			// Not published as a package
			"n/no-unpublished-import": "off",
			"n/no-unsupported-features/node-builtins": [
				"error",
				{
					ignores: ["crypto"],
				},
			],
		},
	},

	// ============================================================
	// ✅ CORE: Global Settings
	// ============================================================
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},

	// ============================================================
	// ✅ CORE: Rule Customizations
	// ============================================================
	{
		rules: {
			// Too verbose — TypeScript handles immutability where needed
			"sonarjs/prefer-read-only-props": "off",

			// Too many false positives for legitimate object lookups
			"security/detect-object-injection": "off",

			// null is used throughout (SDK responses, optional chaining)
			"unicorn/no-null": "off",

			// Use typescript-eslint's faster deprecation check
			"sonarjs/deprecation": "off",
			"@typescript-eslint/no-deprecated": "error",

			// Common abbreviations are universally understood
			"unicorn/prevent-abbreviations": "off",

			// Named function references work fine in .map/.filter
			"unicorn/no-array-callback-reference": "off",

			// Ternaries aren't always more readable than if/else
			"unicorn/prefer-ternary": "off",

			// Strict TypeScript rules
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/consistent-type-imports": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
			"@typescript-eslint/consistent-type-definitions": ["error", "interface"],

			// Code style
			"curly": ["error", "all"],
			"eqeqeq": ["error", "always"],

			// Cap file length to encourage splitting
			"max-lines": [
				"error",
				{ max: 300, skipBlankLines: true, skipComments: true },
			],
		},
	},

	// ============================================================
	// 🦄 UNICORN: Filename conventions
	// ============================================================
	{
		rules: {
			"unicorn/filename-case": [
				"error",
				{
					cases: {
						kebabCase: true,
					},
					ignore: [
						// Numbered spike files: 01-spike.ts, 2a-experiment.ts
						String.raw`^\d+[a-z]?-`,
						// CLAUDE.md, MEMORY.md, etc.
						String.raw`^[A-Z]+\.md$`,
					],
				},
			],
		},
	},

	// ============================================================
	// 🚫 CORE: no-console in pure core (src/core/ only)
	// ============================================================
	{
		files: ["src/core/**/*.ts"],
		rules: {
			"no-console": "error",
			"no-restricted-imports": ["error", {
				patterns: [{
					group: ["../shell/*", "node:fs*", "node:child_process"],
					message: "Core must not import shell or Node I/O modules"
				}]
			}]
		},
	},

	// ============================================================
	// 🧪 VITEST: Unit / integration tests
	// ============================================================
	{
		files: ["**/*.test.ts", "**/*.spec.ts"],
		plugins: {
			vitest: vitestPlugin,
		},
		rules: {
			...vitestPlugin.configs.recommended.rules,
			// Tests reuse strings for readability
			"sonarjs/no-duplicate-string": "off",
			 
			// Test fixtures use fake credentials intentionally
			// eslint-disable-next-line sonarjs/no-hardcoded-passwords
			"sonarjs/no-hardcoded-passwords": "off",
			// Tests often need `any` for mocking
			"@typescript-eslint/no-explicit-any": "off",
			// Mocking patterns trigger unsafe type errors
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			// Dynamic require is common in test setup
			"@typescript-eslint/no-require-imports": "off",
			"unicorn/prefer-module": "off",
			// Tests often have long setup/assertion blocks
			"max-lines": "off",
			// Tests use dynamic paths for temp dirs and fixtures
			"security/detect-non-literal-fs-filename": "off",
			// Tests use os.tmpdir() / /tmp intentionally
			"sonarjs/publicly-writable-directories": "off",
			// Mock method references (vi.fn()) trigger false positives
			"@typescript-eslint/unbound-method": "off",
			// Mock implementations satisfy async interfaces without awaiting
			"@typescript-eslint/require-await": "off",
		},
		languageOptions: {
			globals: {
				...vitestPlugin.environments.env.globals,
			},
		},
	},

	// ============================================================
	// 📄 SPIKES: Exploratory scripts — relax strict rules
	// ============================================================
	{
		files: ["spikes/**/*.ts"],
		rules: {
			"max-lines": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"sonarjs/no-duplicate-string": "off",
			"no-console": "off",
		},
	},

	// ============================================================
	// ⚙️ CONFIG FILES: CommonJS / untyped APIs
	// ============================================================
	{
		files: ["*.config.js", "*.config.mjs", "*.config.ts"],
		rules: {
			"unicorn/prefer-module": "off",
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"unicorn/no-anonymous-default-export": "off",
		},
	},

	// ============================================================
	// 💅 PRETTIER (must be LAST)
	// ============================================================
	prettierConfig,
);
