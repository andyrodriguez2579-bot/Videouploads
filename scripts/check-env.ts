/**
 * Validates .env before you start the app, so a bad key is a clear message
 * rather than a runtime crash three screens in.
 *
 *   npm run env:check
 */
import "dotenv/config";

import { parseEnv } from "../src/lib/env";

const result = parseEnv();

if (result.ok) {
  console.log("Environment configuration is valid.");
  console.log(`  auth:      ${result.env.AUTH_PROVIDER}`);
  console.log(`  storage:   ${result.env.STORAGE_DRIVER}`);
  console.log(`  scenes:    ${result.env.SCENE_PLAN_PROVIDER}`);
  console.log(`  tts:       ${result.env.TTS_PROVIDER}`);
  console.log(`  asr:       ${result.env.ASR_PROVIDER}`);
  console.log(`  publish:   ${result.env.PUBLISHING_MODE}`);
  process.exit(0);
}

console.error("Environment configuration is invalid:\n");
for (const issue of result.issues) {
  console.error(`  ${issue.key}: ${issue.message}`);
}
console.error("\nSee .env.example.");
process.exit(1);
