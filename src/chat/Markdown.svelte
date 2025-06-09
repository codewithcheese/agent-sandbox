<script>
  import { gfmPlugin } from "svelte-exmarkdown/gfm";
  import { Markdown } from "svelte-exmarkdown";
  import CodeBlock from "./CodeBlock.svelte";
  import remarkObsidian from "$lib/markdown/remark.ts";
  import MarkdownLink from "./MarkdownLink.svelte";

  let { md, renderObsidian = false } = $props();

  const plugins = [
    ...(renderObsidian ? [{ remarkPlugin: [remarkObsidian, {}] }] : []),
    gfmPlugin(),
    {
      renderer: {
        pre: CodeBlock,
        ...(renderObsidian ? { a: MarkdownLink } : {}),
      },
    },
  ];
</script>

<Markdown {plugins} {md} />
