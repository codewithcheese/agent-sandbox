<script>
  import CopyIcon from "lucide-svelte/icons/copy";
  import CopyCheckIcon from "lucide-svelte/icons/copy-check";
  import { onMount, tick } from "svelte";
  import mermaid from "mermaid";
  import { createDebug } from "$lib/debug.js";

  const debug = createDebug();

  let showCopied = $state(false);
  let { children } = $props();

  let pre;
  let el;
  let diagram = $state(false);

  onMount(async () => {
    debug("CodeBlock mounted", pre);
    const codeEl = pre.querySelector("code");
    if (codeEl) {
      const lang = codeEl.className.replace("language-", "");
      if (lang === "mermaid") {
        const mermaidContent = codeEl.innerText;
        await tick();
        diagram = await mermaid.render(
          "mermaid-" + Math.random().toString(36).substr(2, 9),
          mermaidContent,
          el,
        );
        console.log("Mermaid rendered", diagram);
      }
    }
  });

  function copyToClipboard() {
    if (pre) {
      navigator.clipboard.writeText(pre.textContent || "");
      showCopied = true;
      setTimeout(() => (showCopied = false), 2000);
    }
  }
</script>

<div class="flex flex-col">
  {#if diagram}
    <div>{@html diagram.svg}</div>
  {:else}
    <pre bind:this={pre}>{@render children?.()}</pre>
  {/if}
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
