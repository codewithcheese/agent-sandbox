<script lang="ts">
  import type { TFile } from "obsidian";
  import { BotIcon } from "lucide-svelte";
  import { isAgent } from "../chat/agents.svelte.ts";

  type Props = {
    template: { file?: TFile };
    openModal: (file: TFile) => void;
  };
  let { template, openModal }: Props = $props();
</script>

{#if template.file}
  <span
    role="button"
    tabindex="0"
    onkeydown={() => openModal(template.file)}
    class="flex items-center gap-1"
    onclick={() => openModal(template.file)}
  >
    <span class="status-bar-item-icon">
      <BotIcon size="14" />
    </span>
    {isAgent(template.file)}
  </span>
{/if}
