import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  server: { proxy: { "/api": "http://127.0.0.1:8808" } },
  build: { outDir: "../src/ssh_mcp/web/static", emptyOutDir: true },
});
