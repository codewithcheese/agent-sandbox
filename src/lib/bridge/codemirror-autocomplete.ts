import { bridge } from "./util.ts";
import type * as moduleType from "@codemirror/autocomplete";

const module = (await bridge("@codemirror/autocomplete")) as typeof moduleType;

export default module;

export const {
  CompletionContext,
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeBrackets,
  closeBracketsKeymap,
  closeCompletion,
  completeAnyWord,
  completeFromList,
  completionKeymap,
  completionStatus,
  currentCompletions,
  deleteBracketPair,
  hasNextSnippetField,
  hasPrevSnippetField,
  ifIn,
  ifNotIn,
  insertBracket,
  insertCompletionText,
  moveCompletionSelection,
  nextSnippetField,
  pickedCompletion,
  prevSnippetField,
  selectedCompletion,
  selectedCompletionIndex,
  setSelectedCompletion,
  snippet,
  snippetCompletion,
  snippetKeymap,
  startCompletion,
} = module;
