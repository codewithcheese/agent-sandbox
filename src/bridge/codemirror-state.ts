import type * as CodeMirrorStateType from "@codemirror/state";

let codemirrorState: typeof CodeMirrorStateType;

if (
  typeof window !== "undefined" &&
  window.bridge &&
  window.bridge["@codemirror/state"]
) {
  // Development mode - use global bridge provided by dev-proxy
  codemirrorState = window.bridge["@codemirror/state"];
} else {
  codemirrorState = await import("@codemirror/state");
}

export default codemirrorState;

// Named exports
export const RangeSetBuilder = codemirrorState.RangeSetBuilder;
export const StateField = codemirrorState.StateField;
export const StateEffect = codemirrorState.StateEffect;
export const Transaction = codemirrorState.Transaction;
export const Text = codemirrorState.Text;
