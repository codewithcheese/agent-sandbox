<script lang="ts">
  import { openLink } from "$lib/utils/obsidian.ts";
  import { getContext } from "svelte";

  let props = $props();

  let source: string = (getContext("linkSource") as string | undefined) ?? "";

  $inspect("source", source);

  function handleClick() {
    return openLink(props.title, source);
  }
</script>

<a tabindex="0" onkeydown={handleClick} onclick={handleClick}>
  {@render props.children()}
</a>
