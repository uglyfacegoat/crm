export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("./server/config/environment");
    try {
      validateRuntimeEnvironment(process.env);
    } catch (error) {
      // Next may keep listening after a rejected register hook; invalid config is fatal.
      console.error(error instanceof Error ? error.message : "Invalid runtime configuration.");
      process.exit(1);
    }
  }
}
