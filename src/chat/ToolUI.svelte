<script lang="ts">
  import type { ToolUIPart } from "ai";
  import { getToolName } from "ai";
  import {
    InfoIcon,
    ChevronDownIcon,
    CheckCircleIcon,
    XCircleIcon,
    LoaderIcon,
    ArrowDownIcon,
    FileIcon,
    FolderIcon,
    SearchIcon,
    CheckIcon,
    ClockIcon,
    GlobeIcon,
    EditIcon,
    PlusIcon,
    ArrowRightIcon,
    HashIcon,
    TypeIcon,
    RulerIcon,
    ImageIcon,
    XIcon,
  } from "lucide-svelte";
  import { openToolPartModal } from "$lib/modals/open-tool-part-model.ts";
  import type { Chat } from "./chat.svelte.ts";
  import type { ToolUIData } from "../tools/types.ts";

  type Props = {
    chat: Chat;
    toolPart: ToolUIPart;
    message: { parts: any[] };
  };

  let { chat, toolPart, message }: Props = $props();

  // Find associated data part
  const dataPart = $derived(
    message.parts.find(
      (p) => p.type === "data-tool-ui" && p.id === toolPart.toolCallId,
    ),
  );

  // Determine status from data part or tool part state
  const status = $derived(
    dataPart?.data.status ||
      (toolPart.state === "output-error"
        ? "error"
        : toolPart.state === "output-available"
          ? "success"
          : toolPart.state === "input-streaming"
            ? "streaming"
            : "loading"),
  );

  const displayTitle = $derived(dataPart?.data.title || getToolName(toolPart));

  const isStreaming = $derived(
    dataPart?.data.streamingInfo?.isStreaming ||
      toolPart.state === "input-streaming",
  );

  // Icon component mapping with fallbacks
  const iconMap = {
    file: FileIcon,
    folder: FolderIcon,
    search: SearchIcon,
    check: CheckIcon,
    clock: ClockIcon,
    globe: GlobeIcon,
    edit: EditIcon,
    plus: PlusIcon,
    "arrow-right": ArrowRightIcon,
    hash: HashIcon,
    type: TypeIcon,
    ruler: RulerIcon,
    image: ImageIcon,
    x: XIcon,
  };

  function getIconComponent(iconName: string) {
    return iconMap[iconName] || InfoIcon;
  }

  function getColorClass(color: string) {
    const colors = {
      normal: "text-(--text-normal)",
      muted: "text-(--text-muted)",
      faint: "text-(--text-faint)",
      accent: "text-(--text-accent)",
      success: "text-(--color-green)",
      warning: "text-(--color-yellow)",
      error: "text-(--color-red)",
    };
    return colors[color] || colors.normal;
  }
</script>

<div class="rounded border border-(--background-modifier-border)">
  <div class="flex flex-row gap-2 text-xs p-2 items-center">
    <!-- Status Indicator -->
    <div class="flex items-center gap-1">
      {#if status === "success"}
        <CheckCircleIcon class="size-3 text-(--color-green)" />
      {:else if status === "error"}
        <XCircleIcon class="size-3 text-(--color-red)" />
      {:else if status === "streaming"}
        <ArrowDownIcon class="size-3 text-(--color-blue) animate-pulse" />
      {:else}
        <LoaderIcon class="size-3 text-(--color-yellow) animate-spin" />
      {/if}

      <!-- Token count for streaming -->
      {#if isStreaming && dataPart?.data.streamingInfo?.tokenCount}
        <span class="text-(--text-muted) text-xs">
          {dataPart.data.streamingInfo.tokenCount}
        </span>
      {/if}
    </div>

    <!-- Title -->
    <div class="flex-1 font-medium text-(--text-normal)">{displayTitle}</div>

    <!-- Description -->
    {#if dataPart?.data.description}
      <span class="text-(--text-muted) text-xs"
        >{dataPart.data.description}</span
      >
    {/if}

    <!-- Info Button -->
    <button
      type="button"
      class="clickable-icon"
      aria-label="Open tool invocation info"
      onclick={() => openToolPartModal(chat, toolPart)}
    >
      <InfoIcon class="size-3" />
    </button>
  </div>

  {#if dataPart?.data}
    <div class="px-2 pb-2 space-y-2">
      <!-- Generic Info Items -->
      {#if dataPart.data.infoItems && dataPart.data.infoItems.length > 0}
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {#each dataPart.data.infoItems as item}
            {@const IconComponent = getIconComponent(item.icon)}
            <div
              class="flex items-center gap-1 {getColorClass(
                item.color || 'normal',
              )}"
            >
              <IconComponent class="size-3" />
              <span class="font-medium">{item.label}:</span>
              <span>{item.value}</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Generic Preview -->
      {#if dataPart.data.preview}
        <div class="preview">
          {#if dataPart.data.preview.type === "image"}
            <img
              src="data:image/png;base64,{dataPart.data.preview.content}"
              alt="Preview"
              class="max-w-full h-auto rounded border border-(--background-modifier-border)"
              style="max-height: {dataPart.data.preview.maxHeight || '12rem'}"
            />
          {:else if dataPart.data.preview.type === "json"}
            <pre
              class="text-xs bg-(--background-secondary) text-(--text-normal) p-2 rounded overflow-auto border border-(--background-modifier-border)"
              style="max-height: {dataPart.data.preview.maxHeight || '8rem'}">
              {JSON.stringify(
                JSON.parse(dataPart.data.preview.content),
                null,
                2,
              )}
            </pre>
          {:else if dataPart.data.preview.type === "list"}
            <div
              class="text-xs bg-(--background-secondary) text-(--text-normal) p-2 rounded overflow-y-auto border border-(--background-modifier-border)"
              style="max-height: {dataPart.data.preview.maxHeight || '8rem'}"
            >
              {#each dataPart.data.preview.content.split("\n") as line}
                <div class="py-0.5">{line}</div>
              {/each}
            </div>
          {:else}
            <pre
              class="text-xs bg-(--background-secondary) text-(--text-normal) p-2 rounded overflow-auto whitespace-pre-wrap border border-(--background-modifier-border)"
              style="max-height: {dataPart.data.preview.maxHeight || '8rem'}">
              {dataPart.data.preview.content}
            </pre>
          {/if}
          {#if dataPart.data.preview.truncated}
            <div class="text-xs text-(--text-muted) mt-1">
              Preview truncated...
            </div>
          {/if}
        </div>
      {/if}

      <!-- Generic Actions -->
      {#if dataPart.data.actions && dataPart.data.actions.length > 0}
        <div class="flex gap-2">
          {#each dataPart.data.actions as action}
            {@const ActionIconComponent = getIconComponent(action.icon)}
            <button
              class="clickable-icon text-xs gap-1"
              onclick={action.onClick}
            >
              <ActionIconComponent class="size-3" />
              {action.label}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Fallback Metadata -->
      {#if dataPart.data.metadata && Object.keys(dataPart.data.metadata).length > 0}
        <details class="text-xs">
          <summary
            class="cursor-pointer text-(--text-muted) hover:text-(--text-normal) flex items-center gap-1"
          >
            <ChevronDownIcon class="size-3" />
            Additional Details
          </summary>
          <div class="mt-1 ml-4 space-y-1">
            {#each Object.entries(dataPart.data.metadata) as [key, value]}
              <div class="flex gap-2">
                <span class="text-(--text-muted) min-w-0 shrink-0">{key}:</span>
                <span class="text-(--text-normal) break-all">{value}</span>
              </div>
            {/each}
          </div>
        </details>
      {/if}
    </div>
  {/if}
</div>
