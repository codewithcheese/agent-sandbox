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
      const rows = Math.min(Math.max(needed, 1), max);
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
  class={cn("w-full", className)}
  bind:value
  {...restProps}
></textarea>
