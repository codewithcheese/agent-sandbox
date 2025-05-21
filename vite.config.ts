import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { resolve } from "path";
import * as fs from "fs";
import * as path from "node:path";
import { configDefaults, defineProject } from "vitest/config";
import builtins from "builtin-modules";
import slugify from "@sindresorhus/slugify";
import tailwindcss from "@tailwindcss/vite";

// Define the list of packages to exclude from bundling
const excludePackages = [
  "obsidian",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/lr",
];

// Helper function to copy manifest.json to dist directory
function copyManifestToDist() {
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
}

export default defineConfig(({ command }) => {
  const isDev = command === "serve";

  const aliasEntries = excludePackages.map((pkg) => {
    const bridgeFile = `${slugify(pkg)}.ts`;
    return [pkg, resolve(__dirname, `src/bridge/${bridgeFile}`)];
  });

  // console.log(aliasEntries, {
  //   $lib: path.resolve("./src/lib"),
  //   // Spread the dynamically generated bridge aliases
  //   ...Object.fromEntries(aliasEntries),
  // });

  return {
    resolve: {
      alias: {
        $lib: path.resolve("./src/lib"),
        // Spread the dynamically generated bridge aliases
        ...Object.fromEntries(aliasEntries),
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
      tailwindcss(),
      svelte({
        compilerOptions: {
          customElement: true,
        },
      }),
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
      // Copy manifest.json to dist directory in both dev and build modes
      {
        name: "copy-manifest",
        configureServer(server) {
          // For development mode
          copyManifestToDist();

          // Watch for changes to manifest.json in dev mode
          if (fs.existsSync("./manifest.json")) {
            server.watcher.add("./manifest.json");
            server.watcher.on("change", (path) => {
              if (
                path.endsWith("manifest.json") &&
                !path.endsWith("dist/manifest.json")
              ) {
                copyManifestToDist();
              }
            });
          }
        },
        closeBundle() {
          // For production build
          copyManifestToDist();
        },
      },
    ],
    optimizeDeps: {
      exclude: excludePackages,
    },
    assetsInclude: ["**/*.md"],
    test: {
      setupFiles: "tests/setup.ts",
      passWithNoTests: true,
      exclude: [...configDefaults.exclude, "e2e/*"],

      // Define multiple projects
      workspace: [
        {
          extends: true,
          test: {
            name: "browser",
            environment: "jsdom",
            // Include files that match browser tests pattern
            include: [
              "**/*.browser.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
              "**/tests/**/*.browser.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
            ],
            browser: {
              enabled: true,
              headless: process.env.CI === "true",
              provider: "playwright",
              instances: [
                {
                  name: "chromium",
                  browser: "chromium",
                },
              ],
            },
          },
        },
        {
          extends: true,
          test: {
            name: "jsdom",
            environment: "jsdom",
            // Include all test files except browser-specific ones
            include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
            exclude: [
              "**/*.browser.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
              "**/tests/**/*.browser.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
              "node_modules/**",
            ],
          },
        },
      ],
    },
    build: {
      lib: {
        entry: resolve(__dirname, "src/main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js",
      },
      rollupOptions: {
        external: [...excludePackages, "electron", ...builtins],
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
      // sourcemap: "inline", // useful for debugging build, but bundle is > 7MB
      // minify: false,
    },
  };
});
