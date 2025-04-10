import { bridge } from "./util.ts";
import type * as moduleType from "@lezer/highlight";

const module = (await bridge("@lezer/highlight")) as typeof moduleType;

export default module;

export const {
  Tag,
  classHighlighter,
  getStyleTags,
  highlightCode,
  highlightTree,
  styleTags,
  tagHighlighter,
  tags,
} = module;
