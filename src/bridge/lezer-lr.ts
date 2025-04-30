import { bridge } from "./util.ts";
import type * as moduleType from "@lezer/lr";

const module = (await bridge("@lezer/lr")) as typeof moduleType;

export default module;

export const {
  ContextTracker,
  ExternalTokenizer,
  InputStream,
  LRParser,
  LocalTokenGroup,
  Stack,
} = module;
