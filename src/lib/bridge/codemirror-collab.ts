import { bridge } from "./util.ts";
import type * as moduleType from "@codemirror/collab";

const module = (await bridge("@codemirror/collab")) as typeof moduleType;

export default module;

export const {
  collab,
  getClientID,
  getSyncedVersion,
  rebaseUpdates,
  receiveUpdates,
  sendableUpdates,
} = module;
