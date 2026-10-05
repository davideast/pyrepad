import { defineConfig, loadEnv } from "vite";
import { pyric } from "@pyric/cli/vite";

const KEY_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_GENAI_API_KEY",
  "VITE_GEMINI_API_KEY",
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // With a Gemini key the AI Logic calls pass through to real Gemini; without
  // one they stay in the local sandbox engine, so the other demos are unaffected.
  const live = KEY_VARS.some((name) => env[name] || process.env[name]);
  return {
    plugins: [
      pyric({
        hosted: true,
        ai: { mode: live ? "production" : "sandbox" },
        runtimeChip: { initiallyOpen: false },
      }),
    ],
    server: {
      port: 5173,
      host: "0.0.0.0",
    },
  };
});
