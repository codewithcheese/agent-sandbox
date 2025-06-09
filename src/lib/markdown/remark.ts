import { visit } from "unist-util-visit";
import { createDebug } from "$lib/debug.ts";

const debug = createDebug();

export const BRACKET_LINK_REGEX =
  /\[\[([a-zA-ZÀ-ÿ0-9-'?%.():&,+/€! ]+)#?([a-zA-ZÀ-ÿ0-9-'?%.():&,+/€! ]+)?\|?([a-zA-ZÀ-ÿ0-9-'?%.():&,+/€! ]+)?]]/g;

export const EMBED_LINK_REGEX = /!\[\[([a-zA-ZÀ-ÿ0-9-'?%.():&,+/€! ]+)]]/g;

export const CODE_BLOCK_REGEX = /(```[\s\S]*?```)|`[^`]*?`/g;

export const CALLOUT_REGEX = /\[!(?<type>\w+)](?: (?<title>.+))?/g;

const plugin =
  (options: Record<string, any> = {}) =>
  (tree) => {
    const {} = options;

    visit(tree, "paragraph", (node) => {
      const rebuilt: any[] = [];

      for (const child of node.children) {
        if (child.type !== "text") {
          rebuilt.push(child);
          continue;
        }

        const value = child.value as string;
        BRACKET_LINK_REGEX.lastIndex = 0;

        let last = 0;
        let m: RegExpExecArray | null;
        const chunks: any[] = []; // collect replacements here

        while ((m = BRACKET_LINK_REGEX.exec(value))) {
          const [full, link, heading, text] = m;
          const idx = m.index;

          if (idx > last) {
            chunks.push({ type: "text", value: value.slice(last, idx) });
          }

          debug("Found link", link, heading, text);

          const href = link + (heading ? `#${heading}` : "");
          const title = text ?? href;

          chunks.push({
            type: "link",
            url: href,
            title: href,
            children: [{ type: "text", value: title }],
          });

          last = idx + full.length;
        }

        /* If no matches, keep the original node exactly once */
        if (last === 0) {
          rebuilt.push(child);
        } else {
          /* We *did* match → add the trailing slice (if any) and splice in */
          if (last < value.length) {
            chunks.push({ type: "text", value: value.slice(last) });
          }
          rebuilt.push(...chunks);
        }
      }

      node.children = rebuilt;
      return node;
    });
  };

export default plugin;
