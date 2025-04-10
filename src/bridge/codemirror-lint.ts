import { bridge } from "./util.ts";
import type * as moduleType from "@codemirror/lint";

const module = (await bridge("@codemirror/lint")) as typeof moduleType;

export default module;

export const {
  closeLintPanel,
  diagnosticCount,
  forEachDiagnostic,
  forceLinting,
  lintGutter,
  lintKeymap,
  linter,
  nextDiagnostic,
  openLintPanel,
  previousDiagnostic,
  setDiagnostics,
  setDiagnosticsEffect,
} = module;
