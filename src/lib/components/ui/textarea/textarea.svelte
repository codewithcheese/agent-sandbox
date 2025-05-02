<script lang="ts">
  import type { WithElementRef, WithoutChildren } from "bits-ui";
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  import type { Action, ActionReturn } from "svelte/action";

  let {
    maxRows = 8,
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> & {
    maxRows?: number;
  } = $props();

  export const autosize: Action<
    HTMLTextAreaElement,
    { maxRows: number } | undefined
  > = (node, param = { maxRows: 8 }) => {
    let max = param.maxRows;
    const lh = parseFloat(getComputedStyle(node).lineHeight);

    const resize = () => {
      node.style.height = "auto"; // collapse first
      const needed = Math.ceil(node.scrollHeight / lh);
      const rows = Math.min(needed, max);
      node.style.overflowY = needed > max ? "auto" : "hidden";
      node.style.height = `${rows * lh}px`;

      console.log(
        "On resize",
        lh,
        node.scrollHeight,
        needed,
        rows,
        node.style.height,
      );
    };

    resize();
    node.addEventListener("input", resize);

    return {
      update({ maxRows }) {
        max = maxRows;
        resize();
      },
      destroy() {
        node.removeEventListener("input", resize);
      },
    };
  };
</script>

<textarea
  use:autosize={{ maxRows }}
  rows="1"
  bind:this={ref}
  class={cn(
    "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
    className,
  )}
  bind:value
  {...restProps}
></textarea>
