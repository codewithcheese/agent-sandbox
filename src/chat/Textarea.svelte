<script lang="ts">
  import { cn } from "$lib/utils";
  let {
    class: className,
    value = $bindable(),
    ref = $bindable(),
    maxRows = 10,
    chatTitle,
    ...restProps
  }: {
    class?: string;
    value?: string;
    ref?: HTMLTextAreaElement;
    maxRows?: number;
    chatTitle: string;
  } & import("svelte/elements").HTMLTextareaAttributes = $props();

  $inspect(chatTitle);

  let wrapperRef: HTMLDivElement;

  // Update the data attribute when value changes
  $effect(() => {
    if (wrapperRef && value !== undefined) {
      wrapperRef.dataset.replicatedValue = value;
    }
  });

  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    if (wrapperRef) {
      wrapperRef.dataset.replicatedValue = target.value;
    }
  }
</script>

<div
  class="grow-wrap"
  bind:this={wrapperRef}
  data-replicated-value={value || ""}
  style={`--max-height: ${maxRows * 1.4}rem;`}
>
  <textarea
    rows="1"
    bind:this={ref}
    class={cn("w-full resize-none overflow-hidden", className)}
    bind:value
    oninput={handleInput}
    data-chat-title={chatTitle}
    {...restProps}
  ></textarea>
</div>

<style>
  .grow-wrap {
    display: grid;
    max-height: calc(var(--max-height, 10 * 1.4rem));
  }

  .grow-wrap::after {
    content: attr(data-replicated-value) " ";
    white-space: pre-wrap;
    visibility: hidden;
    max-height: calc(var(--max-height, 10 * 1.4rem));
    overflow: hidden;
  }

  .grow-wrap > textarea,
  .grow-wrap::after {
    padding: 0.75rem;
    font: inherit;
    line-height: 1.4;
    grid-area: 1 / 1 / 2 / 2;
    border-radius: calc(var(--radius) - 2px);
    /*background-color: var(--background);*/
    font-size: 0.875rem;
  }

  .grow-wrap > textarea {
    resize: none;
    overflow-y: auto;
    max-height: calc(var(--max-height, 10 * 1.4rem));
  }

  .grow-wrap > textarea:focus-visible {
    outline: 2px solid var(--text-accent);
    /*outline-offset: 2px;*/
  }
</style>
