export { readFileTool } from "./readFile";
export { listFilesTool } from "./listFiles";
export { redditSearchTool } from "./reddit/searchReddit";
export { redditGetPostCommentsTool } from "./reddit/getPostComments";
export { redditSearchSubredditsTool } from "./reddit/searchSubreddits";
export { redditGetPostsTool } from "./reddit/getSubredditPosts";

import { readFileTool } from "./readFile";
import { listFilesTool } from "./listFiles";
import { redditSearchTool } from "./reddit/searchReddit";
import { redditGetPostCommentsTool } from "./reddit/getPostComments";
import { redditSearchSubredditsTool } from "./reddit/searchSubreddits";
import { redditGetPostsTool } from "./reddit/getSubredditPosts";

export const getAllTools = () => ({
  readFile: readFileTool,
  listFiles: listFilesTool,
  redditSearch: redditSearchTool,
  redditGetPostComments: redditGetPostCommentsTool,
  redditSearchSubreddits: redditSearchSubredditsTool,
  redditGetPosts: redditGetPostsTool,
});
