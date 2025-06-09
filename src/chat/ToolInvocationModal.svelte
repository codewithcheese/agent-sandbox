<script lang="ts">
  import type { ToolInvocation } from "@ai-sdk/ui-utils";
  import type { Chat } from "./chat.svelte.js";

  type Props = {
    chat: Chat;
    toolInvocation: ToolInvocation;
    close: () => void;
    execute: () => void;
  };
  let { toolInvocation, execute }: Props = $props();
</script>

<div class="flex flex-col gap-2">
  <div class="font-semibold">{toolInvocation.toolName}</div>
  <div
    class="select-text text-xs bg-(--background-primary) border border-(--background-modifier-border) p-2 rounded font-mono whitespace-pre-wrap"
  >
    <p>
      {JSON.stringify(toolInvocation.args, null, 2)}
    </p>
  </div>
  {#if "result" in toolInvocation}
    <div
      class="select-text text-xs bg-(--background-primary) border border-(--background-modifier-border) p-2 rounded font-mono whitespace-pre-wrap"
    >
      <p>
        {#if typeof toolInvocation.result === "string"}
          {toolInvocation.result}
        {:else}
          {JSON.stringify(toolInvocation.result, null, 2)}
        {/if}
      </p>
    </div>
  {/if}
  <div>
    <button onclick={execute}>Execute</button>
  </div>
</div>
