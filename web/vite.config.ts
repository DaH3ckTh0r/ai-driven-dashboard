import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api goes to the monitor server (npm run serve).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8080", "/auth": "http://127.0.0.1:8080" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
