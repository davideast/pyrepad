import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  {
    files: ["packages/**/*.{ts,js,tsx,jsx}", "src/**/*.{ts,js,tsx,jsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Promise: "readonly",
        Object: "readonly",
        Array: "readonly",
        String: "readonly",
        Number: "readonly",
        Boolean: "readonly",
        Error: "readonly",
        Map: "readonly",
        Set: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooksPlugin
    },
    rules: {
      // Merge-Conflict-Resistant Architecture Guardrails
      "max-lines": ["error", { "max": 300, "skipBlankLines": true, "skipComments": true }],
      "max-lines-per-function": ["error", { "max": 60, "skipBlankLines": true, "skipComments": true }],
      "max-params": ["error", 4],
      "max-depth": ["error", 4],

      // Code hygiene
      "no-var": "error",
      "prefer-const": "error",
      "no-duplicate-imports": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    // Zero-DOM Headless Server Guarantee for @pyrepad/core
    files: ["packages/core/**/*.{ts,js}"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "HTMLElement",
        "navigator",
        "localStorage",
        "sessionStorage",
        "location"
      ]
    }
  },
  {
    // Ignore patterns
    ignores: [
      "node_modules/**",
      "dist/**",
      "lib/**",
      "test/**",
      "tools/**",
      "examples/**",
      "*.min.js",
      "*.config.js",
      "*.config.mjs",
      "Gruntfile.js"
    ]
  }
];
