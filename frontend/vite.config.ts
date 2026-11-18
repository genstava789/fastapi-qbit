import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import fs from "fs";

let projectClientId = "";
let projectClientSecret = "";
try {
  const credPath = resolve(import.meta.dirname, "../credentials.json");
  if (fs.existsSync(credPath)) {
    const cred = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    projectClientId = cred.web?.client_id || cred.installed?.client_id || "";
    projectClientSecret = cred.web?.client_secret || cred.installed?.client_secret || "";
  }
} catch (e) {
  console.warn("Could not load credentials.json at build time:", e);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __GDRIVE_DEFAULT_CLIENT_ID__: JSON.stringify(projectClientId),
    __GDRIVE_DEFAULT_CLIENT_SECRET__: JSON.stringify(projectClientSecret),
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "esbuild",
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react-dom") || id.includes("react-router")) {
              return "vendor-react";
            }
            if (id.includes("framer-motion")) {
              return "vendor-motion";
            }
            if (id.includes("recharts") || id.includes("d3-")) {
              return "vendor-charts";
            }
            if (id.includes("lucide-react")) {
              return "vendor-icons";
            }
            if (id.includes("axios") || id.includes("@tanstack") || id.includes("zustand")) {
              return "vendor-state";
            }
          }
        },
      },
    },
  },
});
