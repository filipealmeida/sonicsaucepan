import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});