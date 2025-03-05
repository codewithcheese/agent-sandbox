import { defineConfig, UserConfig } from "vite";
import * as path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { readFile } from "node:fs/promises";

function PostcssPlugin() {
  return {
    name: "postcss",
    setup: async (build: any) => {
      build.onLoad({ filter: /\.css$/ }, async ({ path }: { path: string }) => {
        console.log("Onload css", path);
        const processor = postcss(
          tailwindcss({ config: "./tailwind.config.js" }),
          autoprefixer({}),
        );
        const content = await readFile(path);
        const result = await processor.process(content, { from: path });
        return {
          contents: result.toString(),
          loader: "text",
        };
      });
    },
  };
}

module.exports = defineConfig(async (env): Promise<UserConfig> => {
  const { default: obsidian } = await import("@codewithcheese/vite-plugin-obsidian");
  const { svelte } = await import("@sveltejs/vite-plugin-svelte");
  return {
    build: {
      rollupOptions: {
        external: [
          "obsidian",
          "electron",
          "@codemirror/autocomplete",
          "@codemirror/collab",
          "@codemirror/commands",
          "@codemirror/language",
          "@codemirror/lint",
          "@codemirror/search",
          "@codemirror/state",
          "@codemirror/view",
          "@lezer/common",
          "@lezer/highlight",
          "@lezer/lr",
        ],
      },
    },
    optimizeDeps: {
      exclude: ["obsidian"], // This is important for the dev server
    },
    plugins: [
      svelte(),
      obsidian({
        extension: {
          plugins: [PostcssPlugin()],
          loader: {
            ".css": "text", // This is needed for CSS inlining
          },
        },
      }),
    ],
    resolve: {
      alias: {
        $lib: path.resolve("./src/lib"),
      },
    },
  };
});
