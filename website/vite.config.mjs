import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
    rollupOptions: {
      // @phosphor-icons/react 的 dist/csr 是每个图标一个 .js（这个版本有 3024 个文件）。
      // rollup 默认会并发读很多个，在文件句柄上限低的构建容器里直接 EMFILE:
      //   Could not load .../NumberSquareTwo.es.js: too many open files
      // EdgeOne 的构建机就是这么挂的。调低并发只是慢一点，不会撞上限。
      maxParallelFileOps: 8,
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
