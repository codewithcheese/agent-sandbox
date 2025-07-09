import { z } from "zod";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, Heading } from "mdast";
import { normalizePath } from "obsidian";
import type { ToolDefinition, ToolCallOptionsWithContext, ToolUIData } from "../types";
import { type ToolUIPart } from "ai";

// Define the UI tool type for the outline tool
type OutlineUITool = {
  input: {
    file_path: string;
  };
  output: OutlineResult | {
    error: string;
    message?: string;
    humanMessage?: string;
  };
};

type OutlineToolUIPart = ToolUIPart<{ Outline: OutlineUITool }>;

interface OutlineItem {
  level: number;
  text: string;
  offset: number;      // Line number to start reading (1-indexed, matches Read tool)
  limit: number;       // Number of lines in section (matches Read tool)
}

interface OutlineResult {
  file_path: string;
  total_lines: number;
  outline: OutlineItem[];
}

const TOOL_NAME = "Outline";
const TOOL_DESCRIPTION = "Extracts structural outline from markdown files showing headings with their line positions";
const TOOL_PROMPT_GUIDANCE = `Extracts a hierarchical outline from markdown files by parsing headings.

This tool is especially useful for navigating large markdown documents efficiently.

Usage:
- The file_path parameter must be an absolute path to a markdown file within the vault (e.g., /folder/document.md)
- Returns all headings with their hierarchy levels (1-6)
- Each heading includes offset and limit parameters that can be passed directly to the Read tool
- offset: The line number where the heading starts (1-indexed)
- limit: The number of lines in that section until the next heading or end of file

The output is designed to work seamlessly with the Read tool for targeted section reading.`;

const inputSchema = z.strictObject({
  file_path: z.string().describe("The absolute path to the markdown file"),
});

/**
 * Extracts text content from heading node
 */
function extractHeadingText(heading: Heading): string {
  function extractFromNode(node: any): string {
    if (node.type === "text") {
      return node.value;
    } else if (node.type === "inlineCode") {
      return node.value;
    } else if (node.type === "link") {
      // For links, extract the link text
      return node.children
        .map((child: any) => extractFromNode(child))
        .join("");
    } else if (node.type === "html") {
      // For HTML entities, return the raw value
      return node.value;
    } else if (node.children) {
      // For other nodes with children (strong, emphasis, etc)
      return node.children
        .map((child: any) => extractFromNode(child))
        .join("");
    }
    return "";
  }

  return heading.children
    .map((child: any) => extractFromNode(child))
    .join("")
    .trim();
}

/**
 * Parses markdown content to extract outline
 */
export function parseOutline(content: string): OutlineResult {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const ast = processor.parse(content) as Root;
  
  const headings: OutlineItem[] = [];
  const lines = content.split('\n');
  
  // Find all headings with their positions
  function visitNode(node: any): void {
    if (node.type === "heading") {
      const heading = node as Heading;
      const text = extractHeadingText(heading);
      
      if (text && heading.position) {
        const lineNumber = heading.position.start.line;
        headings.push({
          level: heading.depth,
          text,
          offset: lineNumber,  // Directly use line number as offset
          limit: 0,           // Will calculate below
        });
      }
    }
    
    if (node.children) {
      node.children.forEach(visitNode);
    }
  }
  
  ast.children.forEach(visitNode);
  
  // Calculate section sizes (limit = number of lines in section)
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings[i + 1];
    
    if (next) {
      current.limit = next.offset - current.offset;
    } else {
      current.limit = lines.length - current.offset + 1;
    }
  }
  
  return {
    file_path: "", // Will be set by caller
    total_lines: lines.length,
    outline: headings
  };
}

export async function execute(
  params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
): Promise<OutlineResult | { error: string; message: string; humanMessage?: string }> {
  const { vault } = toolExecOptions.getContext();
  
  if (!vault) {
    return {
      error: "Vault not available",
      message: "Vault not available in execution context",
      humanMessage: "Vault not available"
    };
  }
  
  const normalizedPath = normalizePath(params.file_path);
  const file = vault.getFileByPath(normalizedPath);
  
  if (!file) {
    return {
      error: "File not found",
      message: `File not found: ${params.file_path}`,
      humanMessage: "File not found"
    };
  }
  
  // Only process markdown files
  if (file.extension !== "md") {
    return {
      error: "Invalid file type",
      message: "Outline tool only supports markdown files",
      humanMessage: "Not a markdown file"
    };
  }
  
  try {
    const content = await vault.read(file);
    const result = parseOutline(content);
    result.file_path = params.file_path;
    
    return result;
  } catch (error) {
    return {
      error: "Parse failed",
      message: error instanceof Error ? error.message : String(error),
      humanMessage: "Failed to parse markdown"
    };
  }
}

export const outlineTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
  generateDataPart: (toolPart: OutlineToolUIPart) => {
    const { state, input } = toolPart;

    // Show path as soon as we have input
    if (state === "input-available" || state === "input-streaming") {
      return {
        path: input?.file_path,
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;
      
      // Handle recoverable error output
      if (output && typeof output === "object" && "error" in output) {
        return {
          path: input?.file_path,
          context: output.humanMessage || output.message || output.error,
          error: true,
        };
      }
      
      // Handle success output
      if (output && "outline" in output) {
        const headingCount = output.outline.length;
        const headingText = headingCount === 1 ? "heading" : "headings";
        
        return {
          path: input.file_path,
          lines: `${headingCount} ${headingText}`,
        };
      }
    }

    if (state === "output-error") {
      // Show actual error message
      const errorText = toolPart.errorText || "Unknown error";
      
      return {
        path: input?.file_path,
        lines: errorText,
      };
    }

    return null;
  },
};