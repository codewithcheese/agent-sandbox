import type { Tool, ToolUIPart } from "ai";
import { getToolName, jsonSchema, tool } from "ai";
import { type CachedMetadata, Notice, type TFile, Vault } from "obsidian";
import { usePlugin } from "$lib/utils";
import { resolveInternalLink } from "../lib/utils/obsidian";
import { getListFromFrontmatter } from "../lib/utils/frontmatter";
import type { Chat } from "../chat/chat.svelte.ts";
import { createDebug } from "$lib/debug.ts";
import { MetadataCacheOverlay } from "../chat/metadata-cache-overlay.ts";
import { readTool } from "./files/read.ts";
import { writeTool } from "./files/write.ts";
import { editTool } from "./files/edit.ts";
import { multiEditTool } from "./files/multi-edit.ts";
import { globTool } from "./files/glob.ts";
import { searchTool } from "./files/search.ts";
import type { ToolDefinition, ToolExecuteContext } from "./types.ts";
import { listTool } from "./files/list.ts";
import { outlineTool } from "./files/outline.ts";
import { toolDef as todoWrite } from "./todo/write.ts";
import { toolDef as todoRead } from "./todo/read.ts";
import { toolDef as webSearch } from "./web-search.ts";
import { fetchTool } from "./fetch.ts";
import { evaluateOutputTool } from "./evals/evaluate-output.ts";
import { evaluateTestSetTool } from "./evals/evaluate-test-set.ts";
import { promptTool } from "./evals/prompt.ts";
import { agentTool } from "./agent.ts";
import { extractCodeBlockContent } from "../lib/utils/codeblocks.ts";
import { createSystemContent } from "../chat/system.ts";
import { z } from "zod";
import type { SessionStore } from "../chat/session-store.svelte.ts";
import type { VaultOverlay } from "../chat/vault-overlay.svelte.ts";

const debug = createDebug();

export const toolRegistry: Record<string, ToolDefinition> = {
  web_search: webSearch,
  fetch: fetchTool,
  list: listTool,
  outline: outlineTool,
  read: readTool,
  write: writeTool,
  edit: editTool,
  multi_edit: multiEditTool,
  glob: globTool,
  search: searchTool,
  todo_write: todoWrite,
  todo_read: todoRead,
  evaluate_output: evaluateOutputTool,
  evaluate_test_set: evaluateTestSetTool,
  prompt: promptTool,
  agent: agentTool,
};

/**
 * Sanitize a string to be a valid function name
 * Must start with letter/underscore, contain only alphanumeric, underscores, dots, dashes
 */
function sanitizeToolName(name: string): string {
  // Replace spaces and invalid characters with underscores
  let sanitized = name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^[^a-zA-Z_]/, "_") // Ensure starts with letter or underscore
    .substring(0, 64); // Limit to 64 characters

  // Remove consecutive underscores
  sanitized = sanitized.replace(/_+/g, "_");

  // Remove trailing underscores
  sanitized = sanitized.replace(/_+$/, "");

  // Ensure it's not empty
  if (!sanitized) {
    sanitized = "prompt_tool";
  }

  return sanitized;
}

/**
 * Create a prompt tool definition from a markdown file
 */
async function createPromptToolDefinition(
  file: TFile,
  metadata: CachedMetadata,
): Promise<ToolDefinition> {
  const plugin = usePlugin();

  // Check for optional schema
  let inputSchema: z.ZodObject<any> = z.object({}); // empty schema by default
  let hasSchema = false;

  const content = await plugin.app.vault.read(file);
  const cache = plugin.app.metadataCache.getFileCache(file);
  const codeBlocks =
    cache?.sections?.filter((section) => section.type === "code") || [];

  // Look for schema code block
  for (const codeBlock of codeBlocks) {
    const blockText = content.slice(
      codeBlock.position.start.offset,
      codeBlock.position.end.offset,
    );

    if (blockText.startsWith("```schema")) {
      try {
        const schemaText = extractCodeBlockContent(blockText, 0, file.path);
        const parsedSchema = JSON.parse(schemaText);
        inputSchema = jsonSchema(parsedSchema) as any;
        hasSchema = true;
        break;
      } catch (error) {
        debug(`Error parsing schema in ${file.path}:`, error);
        // Continue without schema if parsing fails
      }
    }
  }

  // Get the tool name, sanitizing if using filename fallback
  const toolName =
    metadata?.frontmatter?.name || sanitizeToolName(file.basename);

  return {
    type: "local",
    name: toolName,
    description:
      metadata?.frontmatter?.description || `Prompt: ${file.basename}`,
    inputSchema,
    execute: async (params, options) => {
      try {
        const { vault, metadataCache } = options.getContext();
        return await createSystemContent(file, vault, metadataCache, {
          template: {
            autoescape: false,
            throwOnUndefined: false,
          },
          additionalData: params,
        });
      } catch (error) {
        new Notice(
          `Failed to execute ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
          3000,
        );
        return {
          error: `Failed to execute tool: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export async function parseToolDefinition(
  file: TFile,
): Promise<ToolDefinition> {
  const plugin = usePlugin();

  const metadata = plugin.app.metadataCache.getFileCache(file);

  // Check for import-based tools first
  if (metadata?.frontmatter?.import) {
    const importName = metadata.frontmatter["import"];

    if (!(importName in toolRegistry)) {
      throw Error(
        `Invalid tool definition in ${file.path}. No tool matching import: ${importName}`,
      );
    }

    return toolRegistry[importName];
  }

  return createPromptToolDefinition(file, metadata);
}

/**
 * Creates an AI SDK tool from a vault tool definition
 */
export async function createTool(
  toolDef: ToolDefinition,
  provider: string,
  context: ToolExecuteContext,
) {
  if (toolDef.type === "local") {
    return tool({
      description: toolDef.description,
      inputSchema:
        typeof toolDef.inputSchema === "string"
          ? jsonSchema(toolDef.inputSchema)
          : toolDef.inputSchema,
      execute: (params, options) =>
        toolDef.execute(params, { ...options, getContext: () => context }),
    });
  } else if (toolDef.type === "provider") {
    // todo: support tool options
    // todo: support provider checking
    return toolDef.createTool(provider, {});
  } else {
    const exhausted: never = toolDef;
    throw new Error(`Tool type not supported: ${(exhausted as any).type}`);
  }
}

// fixme: use agent context as parameters
export async function loadToolsFromFrontmatter(
  metadata: CachedMetadata,
  vault: VaultOverlay,
  sessionStore: SessionStore,
  provider: string,
) {
  const plugin = usePlugin();
  const tools: Record<string, Tool> = {};
  const toolLinks = getListFromFrontmatter(metadata, "tools");
  for (const toolLink of toolLinks) {
    const toolFile = resolveInternalLink(toolLink, plugin);
    if (!toolFile) {
      throw Error(`Failed to resolve tool link: ${toolLink}`);
    }
    const toolDef = await parseToolDefinition(toolFile);
    tools[toolDef.name] = await createTool(toolDef, provider, {
      vault: vault,
      config: {},
      sessionStore: sessionStore,
      metadataCache: new MetadataCacheOverlay(
        vault,
        plugin.app.metadataCache,
      ),
    });
  }

  return tools;
}

/**
 * Get tool definition by name from the registry
 * Maps tool names to registry keys since they may differ
 */
export function getToolDefinition(toolName: string): ToolDefinition | null {
  // First try direct lookup
  if (toolRegistry[toolName]) {
    return toolRegistry[toolName];
  }

  // Then try to find by tool definition name
  const toolDef = Object.values(toolRegistry).find(
    (def) => def.name === toolName,
  );
  return toolDef || null;
}

export async function executeToolCall(toolPart: ToolUIPart, chat: Chat) {
  const tool = Object.values(toolRegistry).find(
    (toolDef) => toolDef.name === getToolName(toolPart),
  );
  if (!tool) {
    throw new Error(`Tool not found: ${getToolName(toolPart)}`);
  }
  if (!("execute" in tool)) {
    throw new Error(`Tool is not executable: ${getToolName(toolPart)}`);
  }

  const result = await tool.execute(toolPart.input, {
    toolCallId: toolPart.toolCallId,
    messages: [],
    abortSignal: new AbortController().signal,
    getContext: () => {
      const plugin = usePlugin();
      return {
        vault: chat.vault,
        config: {},
        sessionStore: chat.sessionStore,
        metadataCache: new MetadataCacheOverlay(
          chat.vault,
          plugin.app.metadataCache,
        ),
      };
    },
  });
  debug("Tool result:", result, toolPart);
}
