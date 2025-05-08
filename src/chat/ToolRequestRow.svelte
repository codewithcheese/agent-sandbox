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
    onReviewClick: () => void;
  };
  let { toolCallId, onReviewClick, toolRequest }: Props = $props();

  function getLabel(request: ToolRequest) {
    const labels = {
      read: ["Viewing", "Viewed", "Failed"],
      modify: ["Editing", "Edited", "Failed"],
      create: ["Creating", "Created", "Failed"],
      delete: ["Deleting", "Deleted", "Failed"],
      trash: ["Trashing", "Trashed", "Failed"],
    };
    let index: number =
      request.status === "pending" ? 0 : request.status === "success" ? 1 : 2;
    return labels[request.type][index];
  }

  function getColor(request: ToolRequest) {
    return request.status === "pending"
      ? "text-(--text-warning)"
      : request.status === "success"
        ? "text-(--text-success)"
        : "text-(--text-error)";
  }
</script>

<ToolRow
  stats={"stats" in toolRequest ? toolRequest.stats : undefined}
  label={getLabel(toolRequest)}
  path={"path" in toolRequest ? toolRequest.path : undefined}
>
  {#snippet icon()}
    {#if toolRequest.type === "modify"}
      <FileEditIcon class="size-3.5 {getColor(toolRequest)}" />
    {:else if toolRequest.type === "read"}
      <FileSearch2Icon class="size-3.5 {getColor(toolRequest)}" />
    {:else if toolRequest.type === "create"}
      <FilePlusIcon class="size-3.5 {getColor(toolRequest)}" />
    {:else if toolRequest.type === "trash"}
      <Trash2Icon class="size-3.5 {getColor(toolRequest)}" />
    {:else if toolRequest.type === "delete"}
      <Trash2Icon class="size-3.5 {getColor(toolRequest)}" />
    {/if}
  {/snippet}

  {#snippet controls()}
    {#if toolRequest.type === "modify" && toolRequest.status === "pending"}
      <button class="clickable-icon highlight-icon" onclick={onReviewClick}>
        <FileTextIcon class="size-3.5" />&nbsp;Review
      </button>
    {/if}
  {/snippet}
</ToolRow>

<style>
  .highlight-icon {
    background: var(--interactive-accent) !important;
    color: var(--text-on-accent) !important;
  }
</style>
