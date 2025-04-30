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
  import { getRequestStats, type ToolRequest } from "../tools/request.ts";

  type Props = {
    toolInvocation: ToolInvocation;
    requests: ToolRequest[];
    onReviewClick: (toolCallId: string) => void;
  };
  let { toolInvocation, onReviewClick, requests }: Props = $props();
</script>

{#if toolInvocation.args.command === "str_replace"}
  <ToolRow
    stats={getRequestStats(requests)}
    label="Editing"
    path={toolInvocation.args.path}
  >
    {#snippet icon()}
      <FileEditIcon class="size-3.5 text-yellow-600" />
    {/snippet}
    {#snippet controls()}
      <button
        class="clickable-icon gap-1 highlight-icon"
        onclick={() => onReviewClick(toolInvocation.toolCallId)}
      >
        <FileTextIcon class="size-3.5" />
        Review
      </button>
    {/snippet}
  </ToolRow>
{:else if toolInvocation.args.command === "view"}
  <!-- File viewing -->
  <ToolRow
    stats={getRequestStats(requests)}
    label="Analyzed"
    path={toolInvocation.args.path}
  >
    {#snippet icon()}
      <FileSearch2Icon class="size-3.5 text-gray-400" />
    {/snippet}
  </ToolRow>
{:else if toolInvocation.args.command === "create"}
  <!-- File creation -->
  <ToolRow
    stats={getRequestStats(requests)}
    label="Created"
    path={toolInvocation.args.path}
  >
    {#snippet icon()}
      <FilePlusIcon class="size-3.5 text-green-600" />
    {/snippet}
  </ToolRow>
{:else if toolInvocation.args.command === "insert"}
  <!-- File insertion proposal -->
  <ToolRow
    stats={getRequestStats(requests)}
    label="Inserted"
    path={toolInvocation.args.path}
  >
    {#snippet icon()}
      <FileEditIcon class="size-3.5 text-yellow-600" />
    {/snippet}
    {#snippet controls()}
      <button
        class="clickable-icon highlight-icon"
        onclick={() =>
          onReviewClick(toolInvocation.toolCallId, toolInvocation.args)}
      >
        <FileTextIcon class="size-3.5" />
        Review
      </button>
    {/snippet}
  </ToolRow>
{:else}
  <!-- Fallback for other commands -->
  <ToolRow
    stats={getRequestStats(requests)}
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
