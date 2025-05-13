<script>
  import CopyIcon from "lucide-svelte/icons/copy";
  import CopyCheckIcon from "lucide-svelte/icons/copy-check";
  let showCopied = $state(false);
  let { children } = $props();

  let pre;

  function copyToClipboard() {
    if (pre) {
      navigator.clipboard.writeText(pre.textContent || "");
      showCopied = true;
      setTimeout(() => (showCopied = false), 2000);
    }
  }
</script>

<div class="flex flex-col">
  <pre bind:this={pre}>{@render children?.()}</pre>
  <div class="flex">
    <div class="flex-1"></div>
    <button onclick={copyToClipboard} class="clickable-icon gap-1">
      <span class="text-sm">
        {showCopied ? "Copied" : "Copy"}
      </span>
      {#if showCopied}
        <CopyCheckIcon class="size-3" />
      {:else}
        <CopyIcon class="size-3" />
      {/if}
    </button>
  </div>
</div>
