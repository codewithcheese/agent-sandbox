<script lang="ts">
  import type { Chat } from "./chat.svelte.js";
  import { getToolName, type ToolUIPart } from "ai";

  type Props = {
    chat: Chat;
    toolPart: ToolUIPart;
    close: () => void;
    execute: () => void;
  };
  let { toolPart, execute }: Props = $props();
</script>

<div class="flex flex-col gap-2">
  <div class="font-semibold">{getToolName(toolPart)}</div>
  <div
    class="select-text text-xs bg-(--background-primary) border border-(--background-modifier-border) p-2 rounded font-mono whitespace-pre-wrap"
  >
    <p>
      {JSON.stringify(toolPart.input, null, 2)}
    </p>
  </div>
  {#if toolPart.state === "output-available"}
    <div
      class="select-text text-xs bg-(--background-primary) border border-(--background-modifier-border) p-2 rounded font-mono whitespace-pre-wrap"
    >
      <p>
        {#if typeof toolPart.output === "string"}
          {toolPart.output}
        {:else}
          {JSON.stringify(toolPart.output, null, 2)}
        {/if}
      </p>
    </div>
  {/if}
  {#if toolPart.state === "output-error"}
    <div
      class="select-text text-xs bg-(--background-primary) border border-(--background-modifier-border) p-2 rounded font-mono whitespace-pre-wrap"
    >
      <p>
        {toolPart.errorText}
      </p>
    </div>
  {/if}
  <div>
    <button onclick={execute}>Execute</button>
  </div>
</div>
