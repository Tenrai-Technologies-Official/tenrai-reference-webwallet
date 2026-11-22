import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Keep source initialization order across the shared SDK chunks.
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: true,
          groups: [
            {
              name: "tenrai-protocol",
              test: /[\\/]node_modules[\\/]@tenrai[\\/]sdk[\\/](?:wasm[\\/]tenrai_wasm\.js|dist[\\/]wallet[\\/]runtime\.js)(?:\?|$)/,
              priority: 30,
            },
            {
              name: "tenrai-crypto",
              test: /[\\/]node_modules[\\/]@noble[\\/](?:hashes|post-quantum)[\\/]/,
              priority: 20,
            },
            {
              name: "tenrai-sdk",
              test: /[\\/]node_modules[\\/]@tenrai[\\/]sdk[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
