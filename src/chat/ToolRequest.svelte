<script lang="ts">
  import {
    FileTextIcon,
    FilePlusIcon,
    FileEditIcon,
    FileSearch2Icon,
    Trash2Icon,
  } from "lucide-svelte";
  import ToolRow from "./ToolRow.svelte";
  import { type ToolRequest } from "../tools/tool-request.ts";

  type Props = {
    toolCallId: string;
    toolRequest: ToolRequest;
    onReviewClick: (toolCallId: string) => void;
  };
  let { toolCallId, onReviewClick, toolRequest }: Props = $props();

  function getLabel(request: ToolRequest) {
    if (request.type === "read") {
      return "Analyzing";
    } else if (request.type === "modify") {
      return "Editing";
    } else if (request.type === "create") {
      return "Created";
    } else if (request.type === "delete") {
      return "Deleting";
    } else if (request.type === "trash") {
      return "Trashing";
    } else {
      // exhaustive check
      const unknown: never = request["type"];
      throw new Error(`Unsupported tool request type: ${unknown}`);
    }
  }
</script>

<ToolRow
  stats={"stats" in toolRequest ? toolRequest.stats : undefined}
  label={getLabel(toolRequest)}
  path={"path" in toolRequest ? toolRequest.path : undefined}
>
  {#snippet icon()}
    {#if toolRequest.type === "modify"}
      <FileEditIcon class="size-3.5 text-yellow-600" />
    {:else if toolRequest.type === "read"}
      <FileSearch2Icon class="size-3.5 text-gray-400" />
    {:else if toolRequest.type === "create"}
      <FilePlusIcon class="size-3.5 text-green-600" />
    {:else if toolRequest.type === "trash"}
      <Trash2Icon class="size-3.5 text-yellow-600" />
    {:else if toolRequest.type === "delete"}
      <Trash2Icon class="size-3.5 text-yellow-600" />
    {/if}
  {/snippet}

  {#snippet controls()}
    {#if toolRequest.type === "modify"}
      <button
        class="clickable-icon highlight-icon"
        onclick={() => onReviewClick(toolCallId)}
      >
        <FileTextIcon class="size-3.5" />
        Review
      </button>
    {/if}
  {/snippet}
</ToolRow>

<style>
  .highlight-icon {
    background: darkslategray !important;
    color: white !important;
  }
</style>
