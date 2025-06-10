<script lang="ts">
  import { normalizePath, Notice } from "obsidian";
  import { openPath } from "$lib/utils/obsidian.ts";

  type Props = {
    icon?: () => any;
    label: string;
    path?: string;
    stats?: { added: number; removed: number };
    controls?: () => any;
  };
  let { icon, label, stats, path, controls = undefined }: Props = $props();
</script>

<div class="flex p-1">
  <div class="flex flex-1 items-center gap-2 text-sm">
    {@render icon?.()}
    {label}
    {#if path}
      <button class="clickable-icon" onclick={() => openPath(path)}
        >{normalizePath(path)}</button
      >
    {/if}
    {#if stats && (stats.added || stats.removed)}
      <div class="text-(--text-success) font-semibold text-sm">
        +{stats.added}
      </div>
      <div class="text-(--text-error) font-semibold text-sm">
        -{stats.removed}
      </div>
    {/if}
  </div>
  <div>
    {@render controls?.()}
  </div>
</div>
