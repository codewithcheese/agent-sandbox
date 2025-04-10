import type * as CodeMirrorStateType from "@codemirror/view";

let codemirrorView: typeof CodeMirrorStateType;

if (
  typeof window !== "undefined" &&
  window.bridge &&
  window.bridge["@codemirror/view"]
) {
  // Development mode - use global bridge provided by dev-proxy
  codemirrorView = window.bridge["@codemirror/view"];
} else {
  codemirrorView = await import("@codemirror/view");
}

export default codemirrorView;

// Named exports
export const EditorView = codemirrorView.EditorView;
export const Decoration = codemirrorView.Decoration;
export const WidgetType = codemirrorView.WidgetType;
