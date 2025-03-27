export { readFileTool } from "./read-file.ts";
export { listFilesTool } from "./list-files.ts";
export { executePythonTool } from "./execute-python.ts";
export { redditSearchTool } from "./reddit/search-reddit.ts";
export { redditGetPostCommentsTool } from "./reddit/get-post-comments.ts";
export { redditSearchSubredditsTool } from "./reddit/search-subreddits.ts";
export { redditGetPostsTool } from "./reddit/get-subreddit-posts.ts";
export { thinkTool } from "./think.ts";

import { readFileTool } from "./read-file.ts";
import { listFilesTool } from "./list-files.ts";
import { executePythonTool } from "./execute-python.ts";
import { redditSearchTool } from "./reddit/search-reddit.ts";
import { redditGetPostCommentsTool } from "./reddit/get-post-comments.ts";
import { redditSearchSubredditsTool } from "./reddit/search-subreddits.ts";
import { redditGetPostsTool } from "./reddit/get-subreddit-posts.ts";
import { thinkTool } from "./think.ts";
import { usePlugin } from "$lib/utils";

export const getAllTools = () => ({
  readFile: readFileTool,
  listFiles: listFilesTool,
  executePython: executePythonTool,
  redditSearch: redditSearchTool,
  redditGetPostComments: redditGetPostCommentsTool,
  redditSearchSubreddits: redditSearchSubredditsTool,
  redditGetPosts: redditGetPostsTool,
  think: thinkTool,
});

export async function readFile({ path }) {
  try {
    const plugin = usePlugin();
    // Remove leading slash if present as Obsidian doesn't support root path syntax
    const normalizedPath = path.startsWith("/") ? path.substring(1) : path;
    const file = plugin.app.vault.getFileByPath(normalizedPath);
    if (!file) {
      return { error: `File not found: ${path}` };
    }
    const content = await plugin.app.vault.read(file);
    return { content };
  } catch (error) {
    return { error: `Failed to read file: ${error.message}` };
  }
}

export async function listFiles({ path }) {
  try {
    // Coerce '.' into '/' since there's no concept of working directory in Obsidian
    const normalizedPath = path === "." ? "/" : path;
    const { fileTree } = await import("$lib/utils/file-tree.ts");
    const result = await fileTree(normalizedPath);
    return { result };
  } catch (error) {
    return { error: `Failed to list files: ${error.message}` };
  }
}
