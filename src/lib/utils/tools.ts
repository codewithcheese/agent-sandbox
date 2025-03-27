import type { UIMessage } from "ai";
import type { ToolInvocation, ToolInvocationUIPart } from "@ai-sdk/ui-utils";
import { TFile } from "obsidian";
import { usePlugin } from "./index.ts";
import { tool } from "ai";
import { JSONSchemaToZod } from '@dmitryrechkin/json-schema-to-zod';

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

/**
 * Interface representing a tool definition from a vault note
 */
export interface VaultToolDefinition {
  name: string;
  description: string;
  schema: any;
  file: TFile;
}

/**
 * Cache of loaded vault tools to avoid reloading
 */
const vaultToolsCache = new Map<string, any>();

/**
 * Parses a tool definition from an Obsidian note
 *
 * @param file The Obsidian file to parse
 * @returns A tool definition or null if the file doesn't contain a valid tool definition
 */
export async function parseToolDefinition(
  file: TFile,
): Promise<VaultToolDefinition | null> {
  const plugin = usePlugin();

  // Get file metadata to check for frontmatter
  const metadata = plugin.app.metadataCache.getFileCache(file);

  // Check if the file has the required frontmatter fields
  if (
    !metadata?.frontmatter ||
    !metadata.frontmatter.name ||
    !metadata.frontmatter.description
  ) {
    return null;
  }

  // Read the file content
  const content = await plugin.app.vault.read(file);

  // Find the first JSON code block
  const codeBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!codeBlockMatch || !codeBlockMatch[1]) {
    return null;
  }

  try {
    // Parse the JSON schema from the content inside the code block
    const schema = JSON.parse(codeBlockMatch[1]);

    return {
      name: metadata.frontmatter.name,
      description: metadata.frontmatter.description,
      schema,
      file,
    };
  } catch (error) {
    console.error(
      `Failed to parse JSON schema in tool definition ${file.path}:`,
      error,
    );
    return null;
  }
}

/**
 * Creates an AI SDK tool from a vault tool definition
 *
 * @param toolDef The tool definition from the vault
 * @returns An object containing the tool name and the tool implementation
 */
export function createVaultTool(toolDef: VaultToolDefinition) {
  // Convert JSON schema to Zod schema
  const zodSchema = JSONSchemaToZod.convert(toolDef.schema);
  
  // Create a tool with the schema from the vault definition
  const vaultTool = tool({
    description: toolDef.description,
    parameters: zodSchema,
    execute: async (params) => {
      // Log the tool execution
      console.log(`Executing vault tool ${toolDef.name} with params:`, params);

      // For now, just return the params as the result
      // In a real implementation, you might want to execute custom code here
      return {
        result: `Executed ${toolDef.name} with the provided parameters.`,
        params,
      };
    },
  });

  // Return the tool name and implementation
  return { name: toolDef.name, tool: vaultTool };
}

/**
 * Loads all tool definitions from the vault
 *
 * @param toolsPath The path to the directory containing tool definitions
 * @returns A map of tool names to tool implementations
 */
export async function loadVaultTools(
  toolsPath: string,
): Promise<Record<string, any>> {
  const plugin = usePlugin();
  const tools: Record<string, any> = {};

  // Get all files in the tools directory
  const files = plugin.app.vault.getFiles();
  const normalizedPath = toolsPath.startsWith("/")
    ? toolsPath.slice(1)
    : toolsPath;

  const toolFiles = files.filter((file) =>
    file.path.startsWith(normalizedPath),
  );

  for (const file of toolFiles) {
    // Check if we've already loaded this tool
    if (vaultToolsCache.has(file.path)) {
      tools[vaultToolsCache.get(file.path).name] = vaultToolsCache.get(
        file.path,
      ).tool;
      continue;
    }

    // Parse the tool definition
    const toolDef = await parseToolDefinition(file);
    if (!toolDef) {
      continue;
    }

    // Create the tool
    const toolImpl = createVaultTool(toolDef);

    // Add to the tools map
    tools[toolDef.name] = toolImpl;

    // Cache the tool
    vaultToolsCache.set(file.path, { name: toolDef.name, tool: toolImpl });
  }

  return tools;
}

/**
 * Resolves tool references from a chatbot's frontmatter
 *
 * @param requestedTools Array of tool names or paths to tool definition files
 * @param builtInTools Map of built-in tools
 * @param vaultTools Map of vault-defined tools
 * @returns A map of resolved tools
 */
export function resolveTools(
  requestedTools: string[],
  builtInTools: Record<string, any>,
  vaultTools: Record<string, any>,
): Record<string, any> {
  const resolvedTools: Record<string, any> = {};

  for (const toolRef of requestedTools) {
    // Check if it's a built-in tool
    if (builtInTools[toolRef]) {
      resolvedTools[toolRef] = builtInTools[toolRef];
      continue;
    }

    // Check if it's a vault-defined tool
    if (vaultTools[toolRef]) {
      resolvedTools[toolRef] = vaultTools[toolRef];
      continue;
    }

    // If we get here, the tool wasn't found
    console.warn(`Tool not found: ${toolRef}`);
  }

  return resolvedTools;
}

/**
 * Loads tools from frontmatter
 *
 * @param metadata The file metadata containing frontmatter
 * @returns Record of tool name to tool implementation
 */
export async function loadToolsFromFrontmatter(
  metadata: any,
): Promise<Record<string, any>> {
  const plugin = usePlugin();
  const activeTools: Record<string, any> = {};

  // If no tools in frontmatter, return empty object
  if (!metadata?.frontmatter || !metadata.frontmatter["tools"]) {
    return activeTools;
  }

  // Get tool links from frontmatter (can be string or array)
  let toolLinks: string[] = [];
  if (typeof metadata.frontmatter["tools"] === "string") {
    toolLinks = [metadata.frontmatter["tools"]];
  } else if (Array.isArray(metadata.frontmatter["tools"])) {
    toolLinks = metadata.frontmatter["tools"];
  }

  // Process each tool link
  for (const toolLink of toolLinks) {
    // Only process internal links [[path/to/tool]]
    const internalLinkMatch = toolLink.match(/\[\[([^\]]+)\]\]/);
    if (!internalLinkMatch) {
      console.warn(`Unsupported tool link format: ${toolLink}`);
      continue;
    }

    const [, linkText] = internalLinkMatch;

    // Get the target file using Obsidian's link resolution
    // This handles aliases, shortest path matching, and spaces in filenames
    const toolFile = plugin.app.metadataCache.getFirstLinkpathDest(
      linkText,
      "",
    );

    if (!toolFile) {
      throw new Error(`Tool file not found: ${linkText}`);
    }

    // Parse the tool definition
    const toolDef = await parseToolDefinition(toolFile);
    if (!toolDef) {
      throw new Error(`Failed to parse tool definition from ${toolFile.path}`);
    }

    // Create the tool and add it to active tools
    const { name, tool } = createVaultTool(toolDef);
    activeTools[name] = tool;
  }

  return activeTools;
}
