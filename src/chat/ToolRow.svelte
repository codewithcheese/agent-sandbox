<script lang="ts">
  import { normalizePath, Notice } from "obsidian";
  import { usePlugin } from "$lib/utils";

  type Props = {
    icon?: () => any;
    label: string;
    path?: string;
    controls?: () => any;
  };
  let { icon, label, path, controls = undefined } = $props();

  function openFile(path) {
    const plugin = usePlugin();
    const normalizedPath = normalizePath(path);
    const file = plugin.app.vault.getFileByPath(normalizedPath);
    if (!file) {
      new Notice(`File not found: ${normalizedPath}`, 3000);
      return;
    }
    const centerLeaf = plugin.app.workspace.getLeaf("tab");
    centerLeaf.openFile(file, { active: true });
  }
</script>

<div class="flex p-1">
  <div class="flex flex-1 items-center gap-2">
    {@render icon?.()}
    {label}
    {#if path}
      <button class="clickable-icon" onclick={() => openFile(path)}
        >{normalizePath(path)}</button
      >
    {/if}
  </div>
  <div>
    {@render controls?.()}
  </div>
</div>
