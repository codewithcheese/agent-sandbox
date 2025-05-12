<script lang="ts">
  import type { TFile } from "obsidian";
  import { isAgent } from "../chat/agents.svelte.ts";

  type Props = {
    content: string;
    file: TFile;
    error: unknown;
  };
  let { content, file, error }: Props = $props();
</script>

<div class="flex flex-col gap-2 select-text">
  <div class="font-semibold">{isAgent(file)}</div>
  {#if error}
    <div class="text-(--text-error)">
      {error}
    </div>
  {/if}
  {#if content}
    <div
      class="text-xs bg-(--background-primary) border border-(--background-modifier-border) p-2 rounded font-mono whitespace-pre-wrap"
    >
      {content}
    </div>
  {/if}
</div>
