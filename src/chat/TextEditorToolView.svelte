<script lang="ts">
  import {
    FileTextIcon,
    FileIcon,
    FilePlusIcon,
    FileEditIcon,
    FileScanIcon,
    FileSearch2Icon,
  } from "lucide-svelte";
  import ToolRow from "./ToolRow.svelte";
  import type { ToolInvocation } from "@ai-sdk/ui-utils";

  type Props = {
    toolInvocation: ToolInvocation;
    reviewTextEditorChanges: (toolCallId: string, args: any) => void;
  };
  let { toolInvocation, reviewTextEditorChanges }: Props = $props();
</script>

{#if toolInvocation.args.command === "str_replace"}
  <ToolRow label="Editing" path={toolInvocation.args.path}>
    {#snippet icon()}
      <FileEditIcon class="size-3.5 text-yellow-600" />
    {/snippet}
    {#snippet controls()}
      <button
        class="clickable-icon gap-1 highlight-icon"
        onclick={() =>
          reviewTextEditorChanges(
            toolInvocation.toolCallId,
            toolInvocation.args,
          )}
      >
        <FileTextIcon class="size-3.5" />
        Review
      </button>
    {/snippet}
  </ToolRow>
{:else if toolInvocation.args.command === "view"}
  <!-- File viewing -->
  <ToolRow label="Analyzed" path={toolInvocation.args.path}>
    {#snippet icon()}
      <FileSearch2Icon class="size-3.5 text-gray-400" />
    {/snippet}
  </ToolRow>
{:else if toolInvocation.args.command === "create"}
  <!-- File creation -->
  <ToolRow label="Created" path={toolInvocation.args.path}>
    {#snippet icon()}
      <FilePlusIcon class="size-3.5 text-green-600" />
    {/snippet}
  </ToolRow>
{:else if toolInvocation.args.command === "insert"}
  <!-- File insertion proposal -->
  <ToolRow label="Inserted" path={toolInvocation.args.path}>
    {#snippet icon()}
      <FileEditIcon class="size-3.5 text-yellow-600" />
    {/snippet}
    {#snippet controls()}
      <button
        class="clickable-icon highlight-icon"
        onclick={() =>
          reviewTextEditorChanges(
            toolInvocation.toolCallId,
            toolInvocation.args,
          )}
      >
        <FileTextIcon class="size-3.5" />
        Review
      </button>
    {/snippet}
  </ToolRow>
{:else}
  <!-- Fallback for other commands -->
  <ToolRow
    label={`File operation: ${toolInvocation.args.command}`}
    path={toolInvocation.args.path}
  >
    {#snippet icon()}
      <FileTextIcon class="size-3.5 text-gray-400" />
    {/snippet}
  </ToolRow>
{/if}

<style>
  .highlight-icon {
    background: darkslategray !important;
    color: white !important;
  }
</style>
