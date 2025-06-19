import { EditorView } from "@codemirror/view";

export const obsidianTheme = EditorView.theme({
  // ===================================================================
  // Layout & Structure
  // ===================================================================
  // ".cm-scroller": {
  //   padding: "var(--file-margins)",
  //   fontFamily: "var(--font-text)",
  //   lineHeight: "var(--line-height-normal)",
  // },
  ".cm-content": {
    maxWidth: "var(--file-line-width)",
    margin: "0 auto",
  },
  ".cm-line": {
    padding: "0",
    paddingBottom: "var(--p-spacing)",
  },
  ".cm-line:has(.bl), .cm-line:has(.ol)": {
    paddingBottom: "var(--list-spacing)",
  },
  ".h1, .h2, .h3, .h4, .h5, .h6": {
    paddingBottom: "0",
  },
  ".cm-widgetBuffer": {
    display: "inline",
    width: 0,
    border: 0,
    margin: 0,
    padding: 0,
  },

  // ===================================================================
  // Content Formatting
  // ===================================================================

  // Headers
  ".hg": {
    paddingTop: "var(--p-spacing) !important",
    marginBottom: "var(--heading-spacing)",
  },
  ".h1": {
    fontFamily: "var(--h1-font)",
    fontSize: "var(--h1-size)",
    fontWeight: "var(--h1-weight)",
    color: "var(--h1-color)",
    lineHeight: "var(--h1-line-height)",
  },
  ".h2": {
    fontFamily: "var(--h2-font)",
    fontSize: "var(--h2-size)",
    fontWeight: "var(--h2-weight)",
    color: "var(--h2-color)",
    lineHeight: "var(--h2-line-height)",
  },
  ".h3": {
    fontFamily: "var(--h3-font)",
    fontSize: "var(--h3-size)",
    fontWeight: "var(--h3-weight)",
    color: "var(--h3-color)",
    lineHeight: "var(--h3-line-height)",
  },
  ".h4": {
    fontFamily: "var(--h4-font)",
    fontSize: "var(--h4-size)",
    fontWeight: "var(--h4-weight)",
    color: "var(--h4-color)",
    lineHeight: "var(--h4-line-height)",
  },
  ".h5": {
    fontFamily: "var(--h5-font)",
    fontSize: "var(--h5-size)",
    fontWeight: "var(--h5-weight)",
    color: "var(--h5-color)",
    lineHeight: "var(--h5-line-height)",
  },
  ".h6": {
    fontFamily: "var(--h6-font)",
    fontSize: "var(--h6-size)",
    fontWeight: "var(--h6-weight)",
    color: "var(--h6-color)",
    lineHeight: "var(--h6-line-height)",
  },

  // Markdown syntax markers
  ".mk, .mkl, .lk-mk, .cb-mk": {
    color: "var(--text-faint)",
  },

  // Text Styling
  ".st": {
    // Bold
    fontWeight: "calc(var(--font-weight) + var(--bold-modifier))",
    color: "var(--bold-color)",
  },
  ".it": {
    // Italic
    fontStyle: "italic",
    color: "var(--italic-color)",
  },
  ".sk": {
    // Strikethrough
    textDecoration: "line-through",
  },
  mark: {
    // Highlight
    backgroundColor: "var(--text-highlight-bg)",
    color: "var(--text-normal)",
  },
  ".ic": {
    // Inline Code
    fontFamily: "var(--font-monospace)",
    color: "var(--code-normal)",
    backgroundColor: "var(--code-background)",
    fontSize: "var(--code-size)",
    borderRadius: "var(--code-radius)",
    padding: "0.15em 0.3em",
  },

  // Fenced Code Blocks
  ".cb-line": {
    fontFamily: "var(--font-monospace)",
    fontSize: "var(--code-size)",
    color: "var(--code-normal)",
    backgroundColor: "var(--code-background)",
    padding: "0 var(--size-4-4)", // Horizontal padding
    lineHeight: "var(--line-height-normal)",
  },
  ".cb-line.cb-start": {
    paddingTop: "var(--size-4-3)",
    borderTopLeftRadius: "var(--code-radius)",
    borderTopRightRadius: "var(--code-radius)",
  },
  ".cb-line.cb-end": {
    paddingBottom: "var(--size-4-3)",
    borderBottomLeftRadius: "var(--code-radius)",
    borderBottomRightRadius: "var(--code-radius)",
  },
  ".cb-mi": {
    // Language identifier
    color: "var(--text-muted)",
    fontFamily: "var(--font-interface)",
  },

  // Blockquotes
  ".bq-line": {
    borderLeft:
      "var(--blockquote-border-thickness) solid var(--blockquote-border-color)",
    color: "var(--blockquote-color)",
    paddingLeft: "var(--size-4-4)",
  },

  // Tables (styling raw text as monospace)
  ".cm-line:not(.cb-line):not(.bq-line):not(.hr)": {
    "& span:is(.cm-hmd-table-sep, .cm-inline-code)": {
      fontFamily: "var(--font-monospace)",
      color: "var(--text-faint)",
    },
  },

  // Horizontal Rule
  ".hr": {
    borderTop: "var(--hr-thickness) solid var(--hr-color)",
    color: "transparent", // Hide the '---' text
  },

  // Lists
  ".bl, .ol": {
    color: "var(--list-marker-color)",
  },
  ".cm-line[data-task='x'], .cm-line[data-task='X']": {
    color: "var(--checklist-done-color)",
    textDecoration: "var(--checklist-done-decoration)",
  },

  // Links
  "a.url": {
    color: "var(--link-external-color)",
    textDecoration: "var(--link-external-decoration)",
  },
  "a.url:hover": {
    color: "var(--link-external-color-hover)",
  },
  ".internal-link": {
    color: "var(--link-color)",
    textDecoration: "var(--link-decoration)",
    cursor: "var(--cursor-link)",
  },
  ".internal-link.is-unresolved": {
    color: "var(--link-unresolved-color)",
    opacity: "var(--link-unresolved-opacity)",
  },

  // Footnotes
  ".footnote-ref": {
    verticalAlign: "super",
    fontSize: "var(--font-smallest)",
    color: "var(--text-accent)",
  },

  // Math
  ".cm-math": {
    fontFamily: "var(--font-monospace)",
    color: "var(--code-normal)",
    fontStyle: "italic",
  },
  ".cm-formatting-math": {
    color: "var(--text-accent)",
  },

  // HTML Tags
  u: { textDecoration: "underline" },
  kbd: {
    fontFamily: "var(--font-monospace)",
    color: "var(--code-normal)",
    backgroundColor: "var(--code-background)",
    borderRadius: "var(--radius-s)",
    padding: "0.1em 0.25em",
  },
  sub: { verticalAlign: "sub", fontSize: "smaller" },
  sup: { verticalAlign: "super", fontSize: "smaller" },
});
