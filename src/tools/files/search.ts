import { z } from "zod";
import { type App, TFile } from "obsidian";
import { createDebug } from "$lib/debug";
import type {
  ToolDefinition,
  ToolExecutionOptionsWithContext,
} from "../types.ts";
import { invariant } from "@epic-web/invariant";
import { usePlugin } from "$lib/utils";

const debug = createDebug();

/**
 * Features:
 * - Performs comprehensive search across the Obsidian vault using native search engine
 * - Supports Obsidian's powerful query syntax with advanced operators
 * - Returns matching files with optional content snippets for context
 * - Configurable result limits and snippet settings for performance
 * - Timeout protection to prevent long-running searches
 * - Relevance-based sorting provided by Obsidian's search engine
 * - Support for regex patterns, content filters, path filters, and tag searches
 * - Handles various search operators: "path:", "file:", "tag:", "content:", "line:", "block:", "task-todo:"
 * - Cancellation support using abort signal from tool execution options
 * - Comprehensive error handling with detailed validation messages
 * - Efficient integration with Obsidian's indexed search capabilities
 * - Returns structured results with file paths and match snippets
 * - Configurable snippet length and count per file
 *
 * Common Use Cases:
 * - Find files containing specific content: "content:keyword"
 * - Search within specific folders: "path:\"My Folder/\""
 * - Find files by type: "file:.md" or "file:.js"
 * - Search by tags: "tag:#project" or "tag:#important"
 * - Complex queries: "content:API path:src/ -path:test/"
 * - Regex searches: "/\\b[A-Z]{3}\\d{2}\\b/" for pattern matching
 * - Task searches: "task-todo:" for finding TODO items
 *
 * Performance Notes:
 * - Leverages Obsidian's pre-built search index for fast results
 * - Configurable timeouts prevent UI blocking
 * - Result limiting maintains responsiveness
 * - Snippet truncation balances context with performance
 */

export const searchToolDefaultConfig = {
  RESULT_LIMIT: 50, // Max number of files to return
  SEARCH_TIMEOUT_MS: 15000, // Timeout for the search operation
  SNIPPET_LIMIT_PER_FILE: 3, // Max match snippets per file to return
  MAX_SNIPPET_LENGTH: 250, // Max length for each snippet
  SHOW_FULL_PATH: false, // Whether to show full path or path relative to vault root
};

export const TOOL_NAME = "ObsidianSearch"; // Specific to Obsidian
export const TOOL_DESCRIPTION =
  "Performs a search across the Obsidian vault using Obsidian's native search engine and query syntax. Returns a list of matching files, optionally with snippets of the matches.";
export const TOOL_PROMPT_GUIDANCE = `Use this tool to search for files and content within the Obsidian vault.
It uses Obsidian's powerful query syntax. Refer to Obsidian's help for search operators (e.g., "path:", "file:", "tag:", "content:", "line:", "block:", "task-todo:", regex with /query/).

Parameters:
- query: (string, required) The Obsidian search query. Examples:
    - "content:myKeyword path:\"My Folder/\""
    - "file:.md tag:#project -path:Archive/"
    - "/\\b[A-Z]{3}\\d{2}\\b/ (for regex search)"

Results are typically sorted by relevance by Obsidian. A limited number of results and match snippets will be returned.`;

// --- Input Schema ---
const searchInputSchema = z.strictObject({
  query: z
    .string()
    .min(1, "Search query cannot be empty.")
    .describe("The Obsidian search query string."),
});

// --- Output Type for execute ---
interface FormattedSearchResultItem {
  filePath: string; // Absolute vault path (e.g., /folder/note.md)
  score?: number;
  matchSnippets?: string[];
}

type SearchToolOutput =
  | {
      query: string;
      results: FormattedSearchResultItem[];
      numResults: number;
      totalMatchesInVault?: number; // Might be hard to get accurately from internal API
      truncated: boolean; // If results were limited by RESULT_LIMIT
    }
  | {
      error: string;
      message?: string;
      meta?: any;
    };

// --- Helper: Version-safety wrapper (from your research) ---
function safeCoreSearchInstance(app: App): any {
  // Try 'global-search' first (newer versions)
  // @ts-expect-error internalPlugins not typed
  let corePlugin = app.internalPlugins.plugins["global-search"];
  if (corePlugin?.instance?.prepareQuery) {
    return corePlugin.instance;
  }
  // Fallback to 'search' (older versions)
  // @ts-expect-error internalPlugins not typed
  corePlugin = app.internalPlugins.plugins["search"];
  if (corePlugin?.instance?.prepareQuery) {
    debug("Using older 'search' plugin ID for Obsidian search engine.");
    return corePlugin.instance;
  }
  throw new Error(
    "Global Search core plugin (global-search or search) not found or its instance is not available. Please ensure it is enabled in Obsidian settings.",
  );
}

// --- Execute Function ---
export async function execute(
  params: z.infer<typeof searchInputSchema>,
  toolExecOptions: ToolExecutionOptionsWithContext,
): Promise<SearchToolOutput> {
  const { abortSignal } = toolExecOptions;
  const { vault, config: contextConfig } = toolExecOptions.getContext();
  const { app } = usePlugin();

  const config = { ...searchToolDefaultConfig, ...contextConfig };

  invariant(vault, "Vault not available in execution context.");

  let searchEngineInstance: any;
  try {
    // It's good practice to ensure plugin is enabled, though `safeCoreSearchInstance` implies it.
    if (
      !app.internalPlugins.plugins["global-search"]?.enabled &&
      !app.internalPlugins.plugins["search"]?.enabled
    ) {
      await app.internalPlugins
        .enablePlugin("global-search")
        .catch(async () => {
          await app.internalPlugins.enablePlugin("search"); // Fallback for older Obsidian
        });
    }
    searchEngineInstance = safeCoreSearchInstance(app);
  } catch (e: any) {
    debug("Error accessing Obsidian search engine:", e);
    return {
      error: "Search Engine Error",
      message: `Could not access Obsidian's search engine: ${e.message}`,
    };
  }

  try {
    const queryObj = searchEngineInstance.prepareQuery(params.query);
    if (abortSignal.aborted)
      return {
        error: "Operation aborted",
        message: "Search operation aborted by user.",
      };

    // To control context lines for snippets (0 means off, just the match itself)
    // const originalContextSetting = searchEngineInstance.settings.context;
    // searchEngineInstance.settings.context = 0; // Or a small number like 1 or 2

    const searchResultsCollector: Array<{
      file: TFile;
      score: number;
      matches: any[];
    }> = [];
    let searchIsDone = false;
    let totalVaultMatchesEstimate = 0; // Obsidian search might provide this

    await new Promise<void>((resolve, reject) => {
      const searchTimeoutId = setTimeout(() => {
        debug(
          `Obsidian search for query "${params.query}" timed out after ${config.SEARCH_TIMEOUT_MS}ms.`,
        );
        if (!searchIsDone) {
          searchIsDone = true; // Prevent further processing
          resolve(); // Resolve with whatever results were collected
        }
      }, config.SEARCH_TIMEOUT_MS);

      const onAbort = () => {
        clearTimeout(searchTimeoutId);
        if (!searchIsDone) {
          searchIsDone = true;
          reject(new Error("Search operation aborted by user."));
        }
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });

      searchEngineInstance.search(
        queryObj,
        (resultItem: any /* SearchResult from Obsidian */) => {
          if (searchIsDone || abortSignal.aborted) {
            // Potentially try to tell engine to stop if API exists, for now, just stop processing
            return;
          }

          if (
            resultItem.type === "result" &&
            resultItem.file instanceof TFile
          ) {
            if (searchResultsCollector.length < config.RESULT_LIMIT) {
              searchResultsCollector.push({
                file: resultItem.file,
                score: resultItem.score,
                matches: resultItem.matches || [],
              });
            }
            // Keep track of total matches found by Obsidian, even if we limit what we collect
            if (typeof searchEngineInstance.fileCount === "number") {
              // Check if this property exists
              totalVaultMatchesEstimate = searchEngineInstance.fileCount;
            } else if (resultItem.total !== undefined) {
              // Some search result types might have total
              totalVaultMatchesEstimate = resultItem.total;
            } else {
              // If no direct total, increment a counter (less accurate for overall total)
              // This part is tricky as the internal API might not expose total easily before 'done'
            }
          } else if (resultItem.type === "done") {
            clearTimeout(searchTimeoutId);
            abortSignal.removeEventListener("abort", onAbort);
            searchIsDone = true;
            if (typeof resultItem.total === "number") {
              // 'done' event might have the final total
              totalVaultMatchesEstimate = resultItem.total;
            }
            resolve();
          } else if (resultItem.type === "error") {
            clearTimeout(searchTimeoutId);
            abortSignal.removeEventListener("abort", onAbort);
            searchIsDone = true;
            reject(
              new Error(
                resultItem.message ||
                  "Obsidian search engine reported an error.",
              ),
            );
          }
        },
      );
    });

    // Restore original context setting if changed
    // searchEngineInstance.settings.context = originalContextSetting;

    if (abortSignal.aborted && !searchIsDone) {
      // Check again if abort happened during promise resolution
      return {
        error: "Operation aborted",
        message: "Search operation aborted by user.",
      };
    }

    const formattedResults = searchResultsCollector.map((item) => {
      let matchSnippets: string[] = [];
      if (item.matches && item.matches.length > 0) {
        matchSnippets = item.matches
          .slice(0, config.SNIPPET_LIMIT_PER_FILE)
          .map((m: any) => {
            // The structure of 'm' (SearchMatch) needs to be known.
            // It often has `m.match` (the exact text) and `m.context` (if context lines are enabled).
            // For simplicity, let's prioritize `m.match`.
            let snippet = "";
            if (m.match && typeof m.match === "string") {
              snippet = m.match;
            } else if (m.content && typeof m.content === "string") {
              // Some plugins use 'content'
              snippet = m.content;
            } else if (m.context && typeof m.context === "string") {
              snippet = m.context;
            } else {
              snippet = "[match context unavailable]";
            }
            return snippet.length > config.MAX_SNIPPET_LENGTH
              ? snippet.substring(0, config.MAX_SNIPPET_LENGTH) + "..."
              : snippet;
          });
      }

      return {
        filePath: config.SHOW_FULL_PATH ? `/${item.file.path}` : item.file.path, // Obsidian paths are vault-relative
        score: item.score,
        matchSnippets: matchSnippets.length > 0 ? matchSnippets : undefined,
      };
    });

    // If totalVaultMatchesEstimate wasn't updated by 'done' or 'result' events,
    // it might be available on the engine instance after search completion.
    if (
      totalVaultMatchesEstimate === 0 &&
      typeof searchEngineInstance.fileCount === "number"
    ) {
      totalVaultMatchesEstimate = searchEngineInstance.fileCount;
    }

    return {
      query: params.query,
      results: formattedResults,
      numResults: formattedResults.length,
      totalMatchesInVault:
        totalVaultMatchesEstimate > 0
          ? totalVaultMatchesEstimate
          : searchResultsCollector.length,
      truncated:
        searchResultsCollector.length >= config.RESULT_LIMIT &&
        (totalVaultMatchesEstimate > searchResultsCollector.length ||
          (totalVaultMatchesEstimate === 0 &&
            searchResultsCollector.length === config.RESULT_LIMIT)),
    };
  } catch (e: any) {
    debug(`Error during Obsidian search for query '${params.query}':`, e);
    return {
      error: "Tool execution failed",
      message: e.message || String(e),
    };
  }
}

export const searchTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema: searchInputSchema,
  execute,
};
