import type { UIMessage } from "ai";
import type { ToolInvocation, ToolInvocationUIPart } from "@ai-sdk/ui-utils";
import type { TFile } from "obsidian";
import { usePlugin } from "./index.ts";
import { tool } from "ai";
import { JSONSchemaToZod } from "@dmitryrechkin/json-schema-to-zod";
import { anthropic } from "@ai-sdk/anthropic";
import { textEditor } from "../../../src/tools/index.ts";

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
  code: string | null;
  import?: string; // Just the function name from tools/index.ts
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
  
  // Special case for str_replace_editor (Anthropic's text editor tool)
  // This tool doesn't require a schema, code block, or import function
  if (metadata.frontmatter.name === "str_replace_editor") {
    return {
      name: metadata.frontmatter.name,
      description: metadata.frontmatter.description,
      schema: {}, // Empty schema for str_replace_editor
      code: null,
      file,
    };
  }

  // Check if there's an import field in the frontmatter
  let importFunction = null;
  if (metadata.frontmatter.import) {
    importFunction = metadata.frontmatter.import;

    // Validate that it's just a function name without path
    if (importFunction.includes(":") || importFunction.includes("/")) {
      console.error(
        `Invalid import format in ${file.path}: ${importFunction}. Expected format: functionName`,
      );
      return null;
    }
  }

  // Read the file content
  const content = await plugin.app.vault.read(file);

  // Use Obsidian's markdown parser to get code blocks
  // Get the file cache which contains parsed markdown elements
  const cache = plugin.app.metadataCache.getFileCache(file);

  // Check if we have code blocks in the cache
  if (!cache || !cache.sections) {
    return null;
  }

  // Filter for code blocks
  const codeBlocks = cache.sections.filter(
    (section) => section.type === "code",
  );

  // If we have an import, we only need the schema code block
  // Otherwise, we need both schema and execution code blocks
  if (codeBlocks.length < 1 || (!importFunction && codeBlocks.length < 2)) {
    return null;
  }

  // Extract content from a code block by removing the first and last lines
  const extractCodeBlockContent = (
    blockText: string,
    blockIndex: number,
    filePath: string,
  ): string => {
    const lines = blockText.split("\n");

    // Validate first line starts with ```
    if (!lines[0].startsWith("```")) {
      throw new Error(
        `Invalid code block format in ${filePath}: code block #${blockIndex + 1} is missing opening backticks`,
      );
    }

    // Validate last line is just ```
    if (!lines[lines.length - 1].startsWith("```")) {
      throw new Error(
        `Invalid code block format in ${filePath}: code block #${blockIndex + 1} is missing closing backticks`,
      );
    }

    // Return everything except first and last lines
    return lines.slice(1, lines.length - 1).join("\n");
  };

  // First code block is expected to be the JSON schema
  const schemaBlock = codeBlocks[0];
  const schemaText = content.slice(
    schemaBlock.position.start.offset,
    schemaBlock.position.end.offset,
  );
  const firstBlockContent = extractCodeBlockContent(schemaText, 0, file.path);

  // If we don't have an import, get the execution code from the second code block
  let code = null;
  if (!importFunction) {
    const codeBlock = codeBlocks[1];
    const codeText = content.slice(
      codeBlock.position.start.offset,
      codeBlock.position.end.offset,
    );
    code = extractCodeBlockContent(codeText, 1, file.path);

    if (!code) {
      throw new Error(`No tool execution code found in ${file.name}`);
    }
  }

  try {
    // Parse the JSON schema from the first code block
    const schema = JSON.parse(firstBlockContent);

    const result: VaultToolDefinition = {
      name: metadata.frontmatter.name,
      description: metadata.frontmatter.description,
      schema,
      code,
      file,
    };

    // Add import function if present
    if (importFunction) {
      result.import = importFunction;
    }

    // Validate that we have either code or import
    if (!code && !importFunction) {
      throw new Error(
        `Tool ${file.name} must have either code or import specified`,
      );
    }

    return result;
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

  // Special case for Anthropic text editor tool
  if (toolDef.name === "str_replace_editor") {
    // Use the Anthropic text editor tool constructor
    const textEditorTool = anthropic.tools.textEditor_20250124({
      execute: async ({
        command,
        path,
        file_text,
        insert_line,
        new_str,
        old_str,
        view_range,
      }) => {
        return textEditor({
          command,
          path,
          file_text,
          insert_line,
          new_str,
          old_str,
          view_range
        });
      },
    })
    
    return { name: toolDef.name, tool: textEditorTool };
  }

  // Convert JSON schema to Zod schema
  const zodSchema = JSONSchemaToZod.convert(toolDef.schema);

  // Create a tool with the schema from the vault definition
  const toolConfig = {
    description: toolDef.description,
    parameters: zodSchema,
    execute: async (params) => {
      // Log the tool execution
      console.log(`Executing vault tool ${toolDef.name} with params:`, params);

      try {
        // Check if we're using an imported function or inline code
        if (toolDef.import) {
          console.log(`Using imported function: ${toolDef.import}`);

          try {
            // Import from tools/index.ts
            const toolsModule = await import(
              /* @vite-ignore */ "../../../src/tools/index.ts"
            );
            const importedFunction =
              toolsModule[toolDef.import as keyof typeof toolsModule];

            if (typeof importedFunction !== "function") {
              throw new Error(
                `Imported function '${toolDef.import}' not found in tools/index.ts`,
              );
            }

            // Execute the imported function
            // The imported function should only take the params object
            return await importedFunction(params);
          } catch (importError) {
            console.error(
              `Error importing function for ${toolDef.name}:`,
              importError,
            );
            return {
              error: `Error importing function: ${importError.message}`,
              params,
            };
          }
        } else if (toolDef.code) {
          // Use inline code execution
          console.log(`Using inline code for ${toolDef.name}`);

          const AsyncFunction = Object.getPrototypeOf(
            async function () {},
          ).constructor;
          const executeFunction = new AsyncFunction(
            "params",
            "usePlugin",
            toolDef.code,
          );

          // Execute the function with the parameters
          return await executeFunction(params, usePlugin);
        } else {
          throw new Error(
            `Tool ${toolDef.name} has neither code nor import specified`,
          );
        }
      } catch (error) {
        console.error(`Error executing code for ${toolDef.name}:`, error);
        return {
          error: `Error executing tool: ${error.message}`,
          params,
        };
      }
    }
  };
  
  // For all other tools, use the AI SDK tool constructor
  const vaultTool = tool(toolConfig);
  
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

    const toolPath = linkText.split("|")[0];

    // Get the target file using Obsidian's link resolution
    // This handles shortest path matching and spaces in filenames
    const toolFile = plugin.app.metadataCache.getFirstLinkpathDest(
      toolPath,
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
