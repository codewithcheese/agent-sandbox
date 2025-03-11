import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";
import * as path from "node:path";

export default defineConfig(({ command }) => {
  const isDev = command === "serve";

  return {
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
          globals: {
            obsidian: "obsidian",
          },
        },
      },
      outDir: "dist",
      emptyOutDir: false,
    },
  };
});
