<script lang="ts">
  import { untrack } from "svelte";
  import { FileTextIcon, BotIcon, WrenchIcon } from "lucide-svelte";
  import { createSystemContent } from "./system.ts";
  import { usePlugin } from "$lib/utils";
  import { openPath } from "$lib/utils/obsidian.ts";
  import { estimateTokenCount } from "$lib/token-estimation.ts";
  import { calculateInputCost, formatCost } from "$lib/pricing-calculator.ts";
  import { getChatModel } from "../settings/utils.ts";
  import { getListFromFrontmatter } from "$lib/utils/frontmatter.ts";
  import { resolveInternalLink } from "$lib/utils/obsidian.ts";
  import type { TFile } from "obsidian";

  type Props = {
    agent: { name: string; file: TFile };
    modelId?: string;
  };
  let { agent, modelId }: Props = $props();

  // State for system content and metrics
  let systemContent = $state<string>("");
  let tokenCount = $state<number>(0);
  let estimatedCost = $state<number>(0);
  let isLoading = $state<boolean>(true);
  let error = $state<string | null>(null);
  let tools = $state<{ name: string; file: TFile }[]>([]);

  $inspect(
    "agent",
    agent,
    modelId,
    tokenCount,
    estimatedCost,
    isLoading,
    error,
    tools,
  );

  async function loadAgentInfo(agentFile: TFile, currentModelId?: string) {
    const plugin = usePlugin();

    try {
      // Load system content
      const content = await createSystemContent(agentFile, plugin.app.vault, plugin.app.metadataCache);
      systemContent = content;

      // Calculate token count
      const tokens = estimateTokenCount(content);
      tokenCount = tokens;

      // Calculate cost if model is available
      if (currentModelId) {
        try {
          const model = getChatModel(currentModelId);
          estimatedCost = calculateInputCost(tokens, model);
        } catch (modelError) {
          console.warn("Failed to get model for pricing:", modelError);
          estimatedCost = 0;
        }
      } else {
        estimatedCost = 0;
      }

      // Extract tools from frontmatter
      const metadata = plugin.app.metadataCache.getFileCache(agentFile);
      const toolLinks = getListFromFrontmatter(metadata, "tools");
      const resolvedTools: { name: string; file: TFile }[] = [];

      for (const toolLink of toolLinks) {
        const toolFile = resolveInternalLink(toolLink, plugin);
        if (toolFile) {
          resolvedTools.push({
            name: toolFile.basename,
            file: toolFile,
          });
        }
      }

      tools = resolvedTools;
      isLoading = false;
    } catch (err) {
      console.error("Failed to load system content:", err);
      error =
        err instanceof Error ? err.message : "Failed to load system content";
      systemContent = "";
      tokenCount = 0;
      estimatedCost = 0;
      tools = [];
      isLoading = false;
    }
  }

  // Effect that only tracks agent and modelId changes
  $effect(() => {
    if (!agent?.file) {
      systemContent = "";
      tokenCount = 0;
      estimatedCost = 0;
      isLoading = false;
      error = null;
      tools = [];
      return;
    }

    // Set loading state and load metrics without tracking internal state changes
    isLoading = true;
    error = null;
    // track modelId changes
    modelId;

    untrack(() => {
      loadAgentInfo(agent.file, modelId);
    });
  });

  // Truncate system content for preview
  const previewLength = 150;
  let preview = $derived(
    systemContent.length > previewLength
      ? systemContent.slice(0, previewLength) + "..."
      : systemContent,
  );
</script>

<div class="mb-3">
  <!-- System message content -->
  <div
    class="bg-(--background-secondary) border border-(--background-modifier-border) rounded p-4"
  >
    <div class="flex items-start gap-3">
      <BotIcon class="size-5 text-(--text-accent) mt-0.5 flex-shrink-0" />

      <div class="flex-1 min-w-0">
        {#if isLoading}
          <div class="text-sm text-(--text-muted)">
            Loading system message...
          </div>
        {:else if error}
          <div class="text-sm text-(--color-red)">Error: {error}</div>
        {:else}
          <!-- Preview content -->
          <!-- <div class="text-sm text-(--text-normal) mb-3 leading-relaxed">
            {preview}
          </div> -->

          <!-- Metrics -->
          <div class="flex items-center gap-4 text-xs text-(--text-muted) mt-1">
            <div class="flex items-center gap-1">
              <span>Tokens:</span>
              <span class="font-mono text-(--text-normal) font-medium"
                >{tokenCount.toLocaleString()}</span
              >
            </div>

            {#if modelId}
              <div class="flex items-center gap-1">
                <span>Est. Cost:</span>
                <span class="font-mono text-(--text-normal) font-medium">
                  {estimatedCost > 0 ? formatCost(estimatedCost) : "$0.00"}
                </span>
              </div>
            {:else}
              <div class="text-(--text-muted) italic">
                Select model for cost estimate
              </div>
            {/if}
          </div>

          <!-- Tools -->
          {#if tools.length > 0}
            <div class="mt-2 pt-2">
              <div class="flex items-center gap-2 mb-2">
                <WrenchIcon class="size-4 text-(--text-muted)" />
                <span class="text-xs text-(--text-muted) font-medium"
                  >Tools ({tools.length})</span
                >
              </div>
              <div class="flex flex-wrap gap-2">
                {#each tools as tool}
                  <a
                    class="text-xs text-(--text-accent) hover:text-(--text-accent-hover) cursor-pointer"
                    onclick={() => openPath(tool.file.path)}
                    role="button"
                    tabindex="0"
                    aria-label="Open tool: {tool.name}"
                    onkeydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openPath(tool.file.path);
                      }
                    }}
                  >
                    {tool.name}
                  </a>
                {/each}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>
