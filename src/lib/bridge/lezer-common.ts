import { bridge } from "./util.ts";
import type * as moduleType from "@lezer/common";

const module = (await bridge("@lezer/common")) as typeof moduleType;

export default module;

export const {
  DefaultBufferLength,
  IterMode,
  MountedTree,
  NodeProp,
  NodeSet,
  NodeType,
  NodeWeakMap,
  Parser,
  Tree,
  TreeBuffer,
  TreeCursor,
  TreeFragment,
  parseMixed,
} = module;
