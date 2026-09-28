import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        app: "readonly",
      },
    },
    rules: {
      // 即使分支只有 return，也写完整的大括号和多行语句。
      curly: ["error", "all"],
      "brace-style": [
        "error",
        "1tbs",
        {
          allowSingleLine: false,
        },
      ],
      "max-statements-per-line": [
        "error",
        {
          max: 1,
        },
      ],
      "object-curly-newline": [
        "error",
        {
          ObjectExpression: {
            minProperties: 1,
          },
        },
      ],
      "object-property-newline": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["tests/obsidian/host.mjs"],
    // Electron 页面通过宿主提供的 require 取得窗口，不能使用静态 ESM 导入。
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
