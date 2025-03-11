export function insertCss(node: HTMLDivElement, css: string) {
  const styleTag = document.createElement("style");
  styleTag.textContent = css;
  node.parentNode!.insertBefore(styleTag, node);
  return {
    destroy() {
      styleTag.remove();
    },
  };
}
