import { validateRuntimeEnvironment } from "../src/server/config/environment.ts";

try {
  validateRuntimeEnvironment(process.env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
