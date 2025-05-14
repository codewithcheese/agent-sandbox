import type { View } from "obsidian";
import { usePlugin } from "$lib/utils";
import type { Constructor } from "$lib/utils/typescript.ts";

export function findMatchingView<ViewType extends View>(
  type: Constructor<ViewType>,
  predicate: (view: ViewType) => boolean,
): ViewType | undefined {
  const plugin = usePlugin();
  const activeView = plugin.app.workspace.getActiveViewOfType(type);
  if (activeView && predicate(activeView)) {
    return activeView;
  }
  const matches = [];
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.view && leaf.view instanceof type && predicate(leaf.view)) {
      matches.push(leaf.view);
    }
  });
  console.log("matching views", matches);
  return matches[0];
}
