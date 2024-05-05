import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactRecommended from 'eslint-plugin-react/configs/recommended.js';
import reactJSXRuntime from 'eslint-plugin-react/configs/jsx-runtime.js';
import {FlatCompat} from '@eslint/eslintrc';

const compat = new FlatCompat();

const mergeConfig = (arr, p) =>
  arr.reduce((plugins, v) => Object.assign(plugins, p(v)), {});
const mergePlugins = (arr) => mergeConfig(arr, (v) => v.plugins);
const mergeRules = (arr) => mergeConfig(arr, (v) => v.rules);

const tsCompatConfig = compat.config({
  extends: [
    'plugin:@typescript-eslint/strict-type-checked',
    'plugin:@typescript-eslint/stylistic-type-checked',
  ],
  plugins: ['@typescript-eslint'],
});
const tsCompatPlugins = mergePlugins(tsCompatConfig);
const tsCompatRules = mergeRules(tsCompatConfig);

const reactHooksCompatConfig = compat.config({
  plugins: ['react-hooks'],
});
const reactHooksCompatPlugins = mergePlugins(reactHooksCompatConfig);

const prettierCompatConfig = compat.config({
  extends: ['prettier'],
});
const prettierCompatRules = mergeRules(prettierCompatConfig);

const importCompatConfig = compat.config({
  extends: ['plugin:import/recommended', 'plugin:import/typescript'],
});
const importCompatPlugins = mergePlugins(importCompatConfig);

export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        project: true,
      },
    },
    plugins: {
      ...tsCompatPlugins,
      react,
      ...reactHooksCompatPlugins,
      ...importCompatPlugins,
    },
    settings: {
      react: {
        version: 'detect',
      },
      'import/resolver': {
        typescript: {
          project: 'packages/*/tsconfig.json',
        },
      },
      'import/internal-regex': '^#internal/',
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsCompatRules,
      ...reactRecommended.rules,
      ...reactJSXRuntime.rules,
      ...prettierCompatRules,

      // add additional rules
      'no-constructor-return': 'error',
      'no-duplicate-imports': 'error',
      'no-new-native-nonconstructor': 'error',
      'no-promise-executor-return': 'error',
      'no-unused-private-class-members': 'error',
      'no-use-before-define': 'error',
      'require-atomic-updates': 'error',
      'block-scoped-var': 'error',
      curly: 'error',
      'default-param-last': 'error',
      eqeqeq: 'error',
      'no-eval': 'error',
      'no-extra-bind': 'error',
      'no-extra-label': 'error',
      'no-implicit-coercion': 'error',
      'no-implied-eval': 'error',
      'no-label-var': 'error',
      'no-multi-assign': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-object-constructor': 'error',
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-useless-computed-key': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-object-has-own': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'sort-imports': [
        'error',
        {
          ignoreCase: false,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          allowSeparatedGroups: true,
        },
      ],

      '@typescript-eslint/consistent-type-exports': [
        'error',
        {fixMixedExportsWithInlineTypeSpecifier: true},
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: true,
        },
      ],
      '@typescript-eslint/explicit-member-accessibility': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/method-signature-style': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-useless-empty-export': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/sort-type-constituents': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowNullableEnum: false,
          allowAny: false,
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
          ],
          pathGroups: [
            {pattern: 'react', group: 'external', position: 'before'},
            {pattern: 'react-dom/*', group: 'external', position: 'before'},
            {
              pattern: '@testing-library/*',
              group: 'external',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          distinctGroup: false,
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            orderImportKind: 'asc',
            caseInsensitive: false,
          },
        },
      ],

      // override recommended
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
