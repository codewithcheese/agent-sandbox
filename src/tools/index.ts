export { readFileTool } from "./read-file.ts";
export { listFilesTool } from "./list-files.ts";
export { executePythonTool } from "./execute-python.ts";
export { redditSearchTool } from "./reddit/search-reddit.ts";
export { redditGetPostCommentsTool } from "./reddit/get-post-comments.ts";
export { redditSearchSubredditsTool } from "./reddit/search-subreddits.ts";
export { redditGetPostsTool } from "./reddit/get-subreddit-posts.ts";

import { readFileTool } from "./read-file.ts";
import { listFilesTool } from "./list-files.ts";
import { executePythonTool } from "./execute-python.ts";
import { redditSearchTool } from "./reddit/search-reddit.ts";
import { redditGetPostCommentsTool } from "./reddit/get-post-comments.ts";
import { redditSearchSubredditsTool } from "./reddit/search-subreddits.ts";
import { redditGetPostsTool } from "./reddit/get-subreddit-posts.ts";

export const getAllTools = () => ({
  readFile: readFileTool,
  listFiles: listFilesTool,
  executePython: executePythonTool,
  redditSearch: redditSearchTool,
  redditGetPostComments: redditGetPostCommentsTool,
  redditSearchSubreddits: redditSearchSubredditsTool,
  redditGetPosts: redditGetPostsTool,
});
