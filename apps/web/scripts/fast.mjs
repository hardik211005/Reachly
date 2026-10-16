// Run the web app locally the way customers get it: a production build, then `next start`.
// Much snappier than `next dev` (no compiling on first visit, links preload), but no hot reload —
// re-run after code changes. Uses its own build folder so it never clashes with the dev server.
import { spawnSync, spawn } from "node:child_process";

const env = { ...process.env, NODE_ENV: "production", NEXT_DIST_DIR: ".next-fast" };
const port = process.env.PORT ?? "3000";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const build = spawnSync(npx, ["next", "build"], { stdio: "inherit", env, shell: process.platform === "win32" });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(npx, ["next", "start", "--port", port], { stdio: "inherit", env, shell: process.platform === "win32" });
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
