<script lang="ts">
  import { BotIcon, HammerIcon, TextIcon, TextSearchIcon } from "lucide-svelte";
  import type { BannerProps } from "./agent-banner-component.svelte.ts";
  import { ChatView } from "../../chat/chat-view.svelte.ts";
  import { Chat } from "../../chat/chat.svelte.ts";
  import { usePlugin } from "$lib/utils";
  import { Notice } from "obsidian";
  import { nanoid } from "nanoid";

  let { path, errors, openAgentView, openMarkdownView, viewType }: BannerProps =
    $props();

  async function handleFixClick() {
    const plugin = usePlugin();
    const { settings } = plugin;
    if (!settings?.agents?.templateRepairAgentPath) {
      new Notice(
        "No repair agent configured. Go to settings to select an agent that can repair templates.",
      );
      return;
    }
    const agentFile = plugin.app.vault.getFileByPath(path);
    // open chat view and set agent
    const view = await ChatView.newChat();
    // get reference to view's chat and submit
    const chat = await Chat.load(view.file.path);
    chat.options.agentPath = settings.agents.templateRepairAgentPath;
    await chat.submit(`Fix: ${errors.join("\n")}`, [
      { id: nanoid(), path: agentFile.path },
    ]);
  }
</script>

<div
  data-banner-metadata=""
  data-banner-fold=""
  data-banner="agent"
  class="banner p-2"
>
  <div class="banner-icon">
    <BotIcon />
  </div>
  <div class="banner-title">Agent</div>
  <div class="ml-4">
    {#each errors as error}
      <div class="text-(--text-error)">Error: {error}</div>
    {/each}
  </div>
  <div class="flex-1"></div>
  <div class="flex flex-row gap-1">
    {#if errors.length > 0}
      <button onclick={() => handleFixClick()} class="gap-1"
        ><HammerIcon size="14" /> Fix</button
      >
    {/if}
    {#if viewType === "MarkdownView" && errors.length === 0}
      <button class="gap-1" onclick={() => openAgentView()} type="button"
        ><TextSearchIcon size="14" /> Preview</button
      >
    {/if}
    {#if viewType === "AgentView"}
      <button class="gap-1" onclick={() => openMarkdownView()} type="button"
        ><TextIcon size="14" /> Markdown</button
      >
    {/if}
  </div>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    overflow: hidden;
    border-style: solid;
    border-color: rgba(var(--callout-color), var(--callout-border-opacity));
    border-width: var(--callout-border-width);
    mix-blend-mode: var(--callout-blend-mode);
    background-color: rgba(var(--callout-color), 0.1);
    gap: var(--size-4-1);
  }

  .banner[data-banner="agent"] {
    --callout-color: var(--callout-example);
    --callout-icon: lucide-list;
  }

  .banner-icon {
    color: rgb(var(--callout-color));
  }

  .banner-title {
    font-weight: var(--callout-title-weight);
    font-size: var(--callout-title-size);
    color: rgb(var(--callout-color));
  }
</style>
