import { bridge } from "./util.ts";
import type * as moduleType from "@codemirror/search";

const module = (await bridge("@codemirror/search")) as typeof moduleType;

export default module;

export const {
  RegExpCursor,
  SearchCursor,
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  searchPanelOpen,
  selectMatches,
  selectNextOccurrence,
  selectSelectionMatches,
  setSearchQuery,
} = module;
