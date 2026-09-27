import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooksPlugin from "eslint-plugin-react-hooks";

// Merge-Conflict-Resistant Architecture Guardrails, shared by every linted tree.
const guardrails = {
  "max-lines": ["error", { "max": 300, "skipBlankLines": true, "skipComments": true }],
  "max-lines-per-function": ["error", { "max": 60, "skipBlankLines": true, "skipComments": true }],
  "max-params": ["error", 4],
  "max-depth": ["error", 4]
};

// Code hygiene, shared by every linted tree.
const hygiene = {
  "no-var": "error",
  "prefer-const": "error",
  "no-duplicate-imports": "error"
};

export default [
  {
    files: ["src/**/*.{ts,js,tsx,jsx}"],
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
        Set: "readonly",
        Math: "readonly",
        JSON: "readonly",
        RegExp: "readonly",
        isNaN: "readonly",
        parseInt: "readonly",
        ArrayBuffer: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooksPlugin
    },
    rules: {
      ...guardrails,
      ...hygiene,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    // Zero-DOM Headless Server Guarantee for @pyric/pad/core
    files: ["src/core/**/*.{ts,js}"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "HTMLElement",
        "navigator",
        "localStorage",
        "sessionStorage",
        "location",
        "DOMParser",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "alert"
      ]
    }
  },
  {
    // Specs and test/tool scripts: the repo rules, except spec files may be long.
    files: ["test/**/*.{js,ts}", "tools/**/*.js"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      ...guardrails,
      ...hygiene
    }
  },
  {
    files: ["test/**/*.spec.{js,ts}"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off"
    }
  },
  {
    // Legacy Firepad 1.x bundle (frozen, A1 option a): ES5 `var` and long files are allowed.
    // The function-shape guardrails report as warnings: the existing legacy functions that
    // exceed them are frozen rather than restructured.
    files: ["lib/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script"
    },
    rules: {
      ...guardrails,
      ...hygiene,
      "no-var": "off",
      "max-lines": "off",
      "max-lines-per-function": ["warn", { "max": 60, "skipBlankLines": true, "skipComments": true }],
      "max-params": ["warn", 4],
      "max-depth": ["warn", 4]
    }
  },
  {
    // Ignore patterns
    ignores: [
      "node_modules/**",
      "dist/**",
      "examples/**",
      ".claude/**",
      "*.min.js",
      "*.config.js",
      "*.config.mjs"
    ]
  }
];
