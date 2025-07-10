import type { Tool } from "ai";
import type { VaultOverlay } from "./vault-overlay.svelte.ts";
import type { SessionStore } from "./session-store.svelte.ts";
import type { AIAccount } from "../settings/settings.ts";
import type { ChatOptions } from "./chat.svelte.ts";
import { usePlugin } from "$lib/utils";
import { loadToolsFromFrontmatter } from "../tools";
import { createSystemContent } from "./system.ts";
import { MetadataCacheOverlay } from "./metadata-cache-overlay.ts";

export interface AgentConfig {
  name: string;
  instructions: (context: AgentContext) => Promise<string>;
  model: string;
  modelSettings?: {
    temperature?: number;
    maxTokens?: number;
    maxSteps?: number;
    thinkingEnabled?: boolean;
    thinkingTokensBudget?: number;
  };
  tools: Record<string, Tool>; // Tools belong to Agent configuration
}

export interface AgentContext {
  account: AIAccount;
  vault: VaultOverlay;
  sessionStore: SessionStore;
  chatPath: string;
  options: ChatOptions;
  metadata?: Record<string, any>;
}

export class Agent {
  constructor(private config: AgentConfig) {}

  static async fromFile(filePath: string, context: AgentContext): Promise<Agent> {
    const plugin = usePlugin();
    const agentFile = plugin.app.vault.getFileByPath(filePath);
    if (!agentFile) {
      throw new Error(`Agent file not found: ${filePath}`);
    }

    const metadata = plugin.app.metadataCache.getFileCache(agentFile);
    if (!metadata) {
      throw new Error(`No metadata found for agent file: ${filePath}`);
    }

    // Extract configuration from frontmatter
    const frontmatter = metadata.frontmatter || {};

    const name = frontmatter.name || agentFile.basename;
    const model = frontmatter.model || context.options.modelId || '';

    const modelSettings = {
      temperature: frontmatter.temperature ?? context.options.temperature,
      maxTokens: frontmatter.maxTokens ?? context.options.maxTokens,
      maxSteps: frontmatter.maxSteps ?? context.options.maxSteps,
      thinkingEnabled: frontmatter.thinkingEnabled ?? context.options.thinkingEnabled,
      thinkingTokensBudget: frontmatter.thinkingTokensBudget ?? context.options.thinkingTokensBudget,
    };

    // Load tools from frontmatter
    const tools = await loadToolsFromFrontmatter(metadata, context.vault, context.sessionStore, context.account.provider);

    // Create instructions function
    const instructions = async (ctx: AgentContext): Promise<string> => {
      const metadataCache = new MetadataCacheOverlay(ctx.vault, plugin.app.metadataCache);
      return await createSystemContent(agentFile, ctx.vault, metadataCache);
    };

    const config: AgentConfig = {
      name,
      instructions,
      model,
      modelSettings,
      tools,
    };

    return new Agent(config);
  }

  async getAgentPrompt(context: AgentContext): Promise<string> {
    return await this.config.instructions(context);
  }

  get tools(): Record<string, Tool> {
    return this.config.tools || {};
  }

  get name(): string {
    return this.config.name;
  }
}
