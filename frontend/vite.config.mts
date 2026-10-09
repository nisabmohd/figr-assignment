import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  server: { port: 5173, strictPort: true, fs: { allow: [".."] } },
  build: { outDir: "../dist", emptyOutDir: true },
});
