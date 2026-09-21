import { defineConfig } from "tsup";

// Bundles the worker and its workspace packages (which ship as TypeScript source) into
// dist/; npm dependencies stay external and are installed in the runtime image.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@repo\//],
  external: ["@prisma/client", "@prisma/adapter-pg", "pg", "bullmq", "ioredis", "pino", "nodemailer", "stripe", "pdf-lib"],
});
