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
    class="text-xs bg-gray-100 border border-gray-300 p-2 rounded font-mono whitespace-pre-wrap"
  >
    <p>
      {JSON.stringify(toolInvocation.args, null, 2)}
    </p>
  </div>
  <div>
    <button onclick={execute}>Execute</button>
  </div>
</div>
