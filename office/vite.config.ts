import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "/office/",
  build: {
    outDir: "../dist-office",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3456",
      "/ws": { target: "ws://localhost:3456", ws: true },
    },
  },
});
