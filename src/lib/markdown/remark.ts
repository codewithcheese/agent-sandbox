import { visit } from "unist-util-visit";
import { createDebug } from "$lib/debug.ts";

const debug = createDebug();

export const BRACKET_LINK_REGEX =
  /\[\[([a-zA-ZÀ-ÿ0-9-'?%.():&,+/€! _]+)#?([a-zA-ZÀ-ÿ0-9-'?%.():&,+/€! _^]+)?\|?([a-zA-ZÀ-ÿ0-9-'?%.():&,+/€! _^]+)?]]/g;

export const EMBED_LINK_REGEX = /!\[\[([a-zA-ZÀ-ÿ0-9-'?%.():&,+/€! ]+)]]/g;

export const CODE_BLOCK_REGEX = /(```[\s\S]*?```)|`[^`]*?`/g;

export const CALLOUT_REGEX = /\[!(?<type>\w+)](?: (?<title>.+))?/g;

const processTextNode = (textNode: any): any[] => {
  const value = textNode.value as string;
  BRACKET_LINK_REGEX.lastIndex = 0;

  let last = 0;
  let m: RegExpExecArray | null;
  const chunks: any[] = [];

  while ((m = BRACKET_LINK_REGEX.exec(value))) {
    const [full, link, heading, text] = m;
    const idx = m.index;

    if (idx > last) {
      chunks.push({ type: "text", value: value.slice(last, idx) });
    }

    debug("Found link", link, heading, text);

    const href = link + (heading ? `#${heading}` : "");
    // If custom display text is provided, use it. Otherwise, show just the basename
    const title = text ?? (link.split('/').pop() || link);

    chunks.push({
      type: "link",
      url: href,
      title: href,
      children: [{ type: "text", value: title }],
    });

    last = idx + full.length;
  }

  // If no matches, return the original node
  if (last === 0) {
    return [textNode];
  }

  // Add the trailing slice (if any)
  if (last < value.length) {
    chunks.push({ type: "text", value: value.slice(last) });
  }

  return chunks;
};

const processNodeChildren = (node: any): void => {
  const rebuilt: any[] = [];

  for (const child of node.children) {
    if (child.type === "text") {
      // Process text nodes for wikilinks
      rebuilt.push(...processTextNode(child));
    } else if (child.children && Array.isArray(child.children)) {
      // Recursively process nodes that have children (like strong, em, etc.)
      processNodeChildren(child);
      rebuilt.push(child);
    } else {
      // Keep other nodes as-is
      rebuilt.push(child);
    }
  }

  node.children = rebuilt;
};

const plugin =
  (options: Record<string, any> = {}) =>
  (tree) => {
    const {} = options;

    // Process all nodes that can contain text, not just paragraphs
    visit(tree, (node) => {
      if (node.children && Array.isArray(node.children)) {
        processNodeChildren(node);
      }
      return node;
    });
  };

export default plugin;
