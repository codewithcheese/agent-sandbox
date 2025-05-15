export function watchForRemoval(target: HTMLElement, onGone: () => void) {
  const parent = target.parentElement;
  if (!parent) return;

  const mo = new MutationObserver((records) => {
    if (
      records.some((r) =>
        [...r.removedNodes].some((n) => n === target || n.contains(target)),
      )
    ) {
      mo.disconnect();
      onGone(); // e.g. panel.$destroy()
    }
  });
  mo.observe(parent, { childList: true });
}
