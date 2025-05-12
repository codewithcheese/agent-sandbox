<script lang="ts">
  import { HammerIcon } from "lucide-svelte";

  type Props = {
    name: string;
    content: string;
    errors: string[];
  };
  let { name, content, errors }: Props = $props();
</script>

<div class="markdown-source-view mod-cm6 is-readable-line-width">
  <div class="cm-editor">
    <div class="cm-scroller">
      <div class="cm-sizer">
        <div class="inline-title">{name}</div>
        {#each errors as error}
          <div class="text-(--text-error) py-2">Error: {error}</div>
        {/each}
        {#if errors.length > 0}
          <div>
            <button class="gap-1" onclick={() => {}}
              ><HammerIcon size="14" /> Fix</button
            >
          </div>
        {/if}

        <div class="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  </div>
</div>
