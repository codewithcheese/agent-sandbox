import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";
import * as path from "node:path";

export default defineConfig(({ command }) => {
  const isDev = command === "serve";

  return {
    define: {
      // Workaround of Pglite extension loading, if process detected will try
      // to use fs instead of fetch to load extension
      // https://github.com/electric-sql/pglite/blob/main/packages/pglite/src/extensionUtils.ts#L10
      process: undefined,
    },
    resolve: {
      alias: {
        $lib: path.resolve("./src/lib"),
        // Redirect 'obsidian' imports to our proxy file
        obsidian: resolve(__dirname, "src/obsidian.ts"),
      },
    },
    server: {
      cors: {
        // Allow requests from any origin
        origin: "*",
        // Allow all headers
        allowedHeaders: "*",
        // Allow all methods
        methods: "*",
        // Allow credentials
        credentials: true,
      },
    },
    plugins: [
      svelte(),
      // Copy dev-proxy.js to dist/main.js during development
      isDev && {
        name: "copy-dev-proxy",
        configureServer(server) {
          // Access the server instance here
          server.httpServer?.once("listening", () => {
            const address = server.httpServer?.address();
            const protocol = server.config.server.https ? "https" : "http";
            const host = server.config.server.host || "localhost";
            const port =
              typeof address === "object" && address
                ? address.port
                : server.config.server.port;
            const devServerUrl = `${protocol}://${host}:${port}`;

            // Create dist directory if it doesn't exist
            if (!fs.existsSync("./dist")) {
              fs.mkdirSync("./dist", { recursive: true });
            }

            // Read the proxy content
            let proxyContent = fs.readFileSync("./dev-proxy.js", "utf8");

            // Replace the hardcoded URL with the actual dev server URL
            proxyContent = proxyContent.replace(
              /const DEV_SERVER_URL = ['"](.*)['"];/,
              `const DEV_SERVER_URL = '${devServerUrl}';`,
            );

            // Write the modified content to dist/main.js
            fs.writeFileSync("./dist/main.js", proxyContent);
            console.log(
              `Dev proxy copied to dist/main.js with server URL: ${devServerUrl}`,
            );
          });
        },
      },
      // Copy manifest.json to dist directory during build
      {
        name: "copy-manifest",
        apply: "build", // Only apply during build
        closeBundle() {
          // This hook runs after the bundle is generated
          if (fs.existsSync("./manifest.json")) {
            // Create dist directory if it doesn't exist
            if (!fs.existsSync("./dist")) {
              fs.mkdirSync("./dist", { recursive: true });
            }
            
            // Copy manifest.json to dist directory
            fs.copyFileSync("./manifest.json", "./dist/manifest.json");
            console.log("manifest.json copied to dist directory");
          } else {
            console.warn("manifest.json not found in project root");
          }
        },
      },
    ],
    optimizeDeps: {
      exclude: ["obsidian"],
    },
    build: {
      lib: {
        entry: resolve(__dirname, "src/main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js",
      },
      rollupOptions: {
        external: ["obsidian"],
        output: {
          format: "cjs",
          exports: "named",
          globals: {
            obsidian: "obsidian",
          },
          // Prevent code-splitting
          inlineDynamicImports: true,
          // Ensure consistent exports format
          preserveModules: false,
          // Ensure a single chunk is generated
          chunkFileNames: "main.js",
        },
      },
      outDir: "dist",
      emptyOutDir: false,
    },
  };
});
