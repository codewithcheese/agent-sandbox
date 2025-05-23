import type { UIMessage, Tool, CoreMessage, ToolExecutionOptions } from "ai";
import type { ToolInvocation, ToolInvocationUIPart } from "@ai-sdk/ui-utils";
import { type CachedMetadata, Notice, type TFile, Vault } from "obsidian";
import { usePlugin } from "$lib/utils";
import { tool } from "ai";
import { JSONSchemaToZod } from "@dmitryrechkin/json-schema-to-zod";
import { anthropic } from "@ai-sdk/anthropic";
import { textEditor } from "./execute.ts";
import { resolveInternalLink } from "../lib/utils/obsidian";
import { getListFromFrontmatter } from "../lib/utils/frontmatter";
import { extractCodeBlockContent } from "$lib/utils/codeblocks.ts";
import { createVaultProxy } from "./vault-proxy.ts";
import type { Chat } from "../chat/chat.svelte.ts";
import type { AIProviderId } from "../settings/providers";

export type VaultTool = BuiltinTool | ImportVaultTool | CodeVaultTool;

type BuiltinTool = {
  type: "built-in";
  name: "str_replace_editor";
  description: string;
  file: TFile;
  schema?: Record<string, any>;
};

type CodeVaultTool = {
  type: "code";
  name: string;
  description: string;
  schema: Record<string, any>;
  code: string;
  file: TFile;
};

type ImportVaultTool = {
  type: "import";
  name: string;
  description: string;
  schema: Record<string, any>;
  import: string;
  file: TFile;
};

export function updateToolInvocationPart(
  message: UIMessage,
  toolCallId: string,
  invocation: ToolInvocation,
) {
  const part = message.parts.find(
    (part) =>
      part.type === "tool-invocation" &&
      part.toolInvocation.toolCallId === toolCallId,
  ) as ToolInvocationUIPart | undefined;

  if (part != null) {
    part.toolInvocation = invocation;
  } else {
    message.parts.push({
      type: "tool-invocation",
      toolInvocation: invocation,
    });
  }
}

export function getToolCall(message: UIMessage, toolCallId: string) {
  return message.parts.find(
    (p) =>
      p.type === "tool-invocation" &&
      p.toolInvocation.toolCallId === toolCallId,
  ) as
    | (ToolInvocationUIPart & { toolInvocation: { text: string } })
    | undefined;
}

export async function parseToolDefinition(file: TFile): Promise<VaultTool> {
  const plugin = usePlugin();

  const metadata = plugin.app.metadataCache.getFileCache(file);

  if (
    !(
      metadata.frontmatter &&
      "name" in metadata.frontmatter &&
      "description" in metadata.frontmatter
    )
  ) {
    throw Error(
      `Invalid tool definition in ${file.path}. Missing frontmatter fields: name, description`,
    );
  }

  // Special case for str_replace_editor (Anthropic's text editor tool)
  if (metadata.frontmatter.name === "str_replace_editor") {
    let schema: Record<string, any> | undefined = undefined;

    const content = await plugin.app.vault.read(file);
    const cache = plugin.app.metadataCache.getFileCache(file);

    const codeBlocks =
      cache.sections?.filter((section) => section.type === "code") || [];

    if (codeBlocks.length > 0) {
      const schemaBlock = content.slice(
        codeBlocks[0].position.start.offset,
        codeBlocks[0].position.end.offset,
      );
      const schemaText = extractCodeBlockContent(schemaBlock, 0, file.path);
      if (schemaText) {
        schema = JSON.parse(schemaText);
      }
    }

    return {
      type: "built-in",
      name: metadata.frontmatter.name,
      description: metadata.frontmatter.description,
      file,
      schema,
    };
  }

  let importName: string | null = null;
  if ("import" in metadata.frontmatter) {
    importName = metadata.frontmatter["import"];

    // Validate that it's just a function name without path
    if (importName && (importName.includes(":") || importName.includes("/"))) {
      throw new Error(
        `Invalid import format in ${file.path}: ${importName}. Expected format: functionName`,
      );
    }
  }

  const content = await plugin.app.vault.read(file);
  const cache = plugin.app.metadataCache.getFileCache(file);

  const codeBlocks = cache.sections.filter(
    (section) => section.type === "code",
  );

  let schemaText: string | null = null;
  if (codeBlocks.length > 0) {
    const schemaBlock = content.slice(
      codeBlocks[0].position.start.offset,
      codeBlocks[0].position.end.offset,
    );
    schemaText = extractCodeBlockContent(schemaBlock, 0, file.path);
  }

  let code: string | null = null;
  if (codeBlocks.length > 1) {
    const codeBlock = content.slice(
      codeBlocks[1].position.start.offset,
      codeBlocks[1].position.end.offset,
    );
    code = extractCodeBlockContent(codeBlock, 1, file.path);
  }

  if (schemaText && code) {
    return {
      type: "code",
      name: metadata.frontmatter.name,
      description: metadata.frontmatter.description,
      schema: JSON.parse(schemaText),
      code,
      file,
    };
  } else if (schemaText && importName) {
    return {
      type: "import",
      name: metadata.frontmatter.name,
      description: metadata.frontmatter.description,
      schema: JSON.parse(schemaText),
      import: importName,
      file,
    };
  } else {
    throw new Error(
      `Tool ${file.name} must have a schema and either code or import specified`,
    );
  }
}

/**
 * Creates an AI SDK tool from a vault tool definition
 */
export async function createTool(
  vaultTool: VaultTool,
  chat: Chat,
  providerId?: AIProviderId,
) {
  // Special case for Anthropic text editor tool
  if (vaultTool.type === "built-in") {
    if (vaultTool.name === "str_replace_editor") {
      // Use Anthropic's built-in text editor if the model provider is Anthropic
      if (!providerId || providerId === "anthropic") {
        return anthropic.tools.textEditor_20250124({
          execute: await createExecutor(vaultTool, chat),
        });
      } else if (vaultTool.schema) {
        // For other model providers, use the schema-based approach if schema is available
        return tool({
          description: vaultTool.description,
          parameters: JSONSchemaToZod.convert(vaultTool.schema),
          execute: await createExecutor(vaultTool, chat),
        });
      } else {
        // If no schema is available for fallback, throw an error
        throw new Error(
          `Text Editor tool requires a schema for non-Anthropic models. Please add a schema to ${vaultTool.file.path}`,
        );
      }
    } else {
      throw new Error(`Unsupported builtin tool type: ${vaultTool["name"]}`);
    }
  }

  return tool({
    description: vaultTool.description,
    parameters: JSONSchemaToZod.convert(vaultTool.schema),
    execute: await createExecutor(vaultTool, chat),
  });
}

async function createCodeExecutor(vaultTool: CodeVaultTool) {
  console.log(`Using inline code for ${vaultTool.name}`);

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const executeFunction = new AsyncFunction(
    "params",
    "usePlugin",
    vaultTool.code,
  );

  return async (params: any, _options: ToolExecutionOptions) => {
    try {
      return await executeFunction(params, usePlugin);
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
}

async function createImportExecutor(vaultTool: ImportVaultTool) {
  const toolsModule = await import(/* @vite-ignore */ "./execute.ts");
  const importedFunction =
    toolsModule[vaultTool.import as keyof typeof toolsModule];
  if (typeof importedFunction !== "function") {
    return async () => ({
      error: `Imported function '${vaultTool.import}' not found in tools/execute.ts`,
    });
  }
  return async (params: any, options: ToolExecutionOptions) => {
    try {
      return await importedFunction(params?.thought ?? params, options);
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
}

type Executor = (params: any, options: ToolExecutionOptions) => Promise<any>;

async function createExecutor(
  vaultTool: VaultTool,
  chat: Chat,
): Promise<Executor> {
  console.log("Creating executor for tool", vaultTool.name);
  if (vaultTool.type === "built-in") {
    if (vaultTool.name === "str_replace_editor") {
      return async (params: any, options) => {
        console.log('Executing "str_replace_editor" tool', params, options);
        const vault = createVaultProxy(
          usePlugin().app.vault,
          options.toolCallId,
          chat,
        );
        return textEditor(params, { ...options, vault });
      };
    } else {
      throw new Error(`Unknown builtin tool: ${vaultTool["name"]}`);
    }
  } else if (vaultTool.type === "code") {
    return createCodeExecutor(vaultTool);
  } else if (vaultTool.type === "import") {
    return createImportExecutor(vaultTool);
  } else {
    throw new Error(`Unknown tool type: ${vaultTool["type"]}`);
  }
}

export async function loadAllTools(
  toolsPath: string,
  chat: Chat,
  providerId?: AIProviderId,
) {
  const plugin = usePlugin();
  const files = plugin.app.vault.getFiles();
  const normalizedPath = toolsPath.startsWith("/")
    ? toolsPath.slice(1)
    : toolsPath;

  const toolFiles = files.filter((file) =>
    file.path.startsWith(normalizedPath),
  );

  const tools: Record<string, Tool> = {};
  for (const file of toolFiles) {
    const toolDef = await parseToolDefinition(file);
    tools[toolDef.name] = await createTool(toolDef, chat, providerId);
  }
  return tools;
}

export async function loadToolsFromFrontmatter(
  metadata: CachedMetadata,
  chat: Chat,
  providerId?: AIProviderId,
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
    tools[toolDef.name] = await createTool(toolDef, chat, providerId);
  }

  return tools;
}

export async function executeToolInvocation(
  toolInvocation: ToolInvocation,
  chat: Chat,
  providerId?: AIProviderId,
) {
  const plugin = usePlugin();

  // todo: replace with setting
  const toolsDir = plugin.app.vault.getAbstractFileByPath("tools");
  if (!toolsDir) {
    throw new Error("Tools directory not found");
  }

  const allTools = await loadAllTools(toolsDir.path, chat, providerId);
  const tool = allTools[toolInvocation.toolName];

  if (!tool) {
    throw new Error(`Tool not found: ${toolInvocation.toolName}`);
  }
  if (!tool.execute) {
    throw new Error(
      `Tool ${toolInvocation.toolName} does not have an execute method`,
    );
  }

  // Execute the tool using its execute method
  const result = await tool.execute(toolInvocation.args, {
    toolCallId: toolInvocation.toolCallId,
    // fixme? pass messages not used yet
    messages: [],
  });
  console.log("Tool result:", result, toolInvocation);
}
