let obsidian: any;

if (
  typeof window !== "undefined" &&
  "__vitest_browser__" in window &&
  window.__vitest_browser__ === true
) {
  // Test mode - mock obsidian
  obsidian = (await import("../../../tests/mocks/obsidian.ts")).default;
} else if (
  typeof window !== "undefined" &&
  window.bridge &&
  window.bridge.obsidian
) {
  // Development mode - use global bridge provided by dev-proxy
  obsidian = window.bridge.obsidian;
} else {
  obsidian = await import("obsidian");
}

// Default export
export default obsidian;

// Named exports
export const Plugin = obsidian.Plugin;
export const App = obsidian.App;
export const Notice = obsidian.Notice;
export const Modal = obsidian.Modal;
export const Setting = obsidian.Setting;
export const PluginSettingTab = obsidian.PluginSettingTab;
export const MarkdownView = obsidian.MarkdownView;
export const MarkdownRenderer = obsidian.MarkdownRenderer;
export const TFile = obsidian.TFile;
export const TFolder = obsidian.TFolder;
export const Vault = obsidian.Vault;
export const Workspace = obsidian.Workspace;
export const Editor = obsidian.Editor;
export const Menu = obsidian.Menu;
export const FuzzySuggestModal = obsidian.FuzzySuggestModal;
export const FileSystemAdapter = obsidian.FileSystemAdapter;
export const DataAdapter = obsidian.DataAdapter;
export const Component = obsidian.Component;
export const Events = obsidian.Events;
export const ItemView = obsidian.ItemView;
export const WorkspaceLeaf = obsidian.WorkspaceLeaf;
export const TAbstractFile = obsidian.TAbstractFile;
export const FileView = obsidian.FileView;
export const TextComponent = obsidian.TextComponent;
export const ButtonComponent = obsidian.ButtonComponent;
export const ToggleComponent = obsidian.ToggleComponent;
export const ExtraButtonComponent = obsidian.ExtraButtonComponent;
export const DropdownComponent = obsidian.DropdownComponent;
export const TextAreaComponent = obsidian.TextAreaComponent;
export const SliderComponent = obsidian.SliderComponent;
export const MomentFormatComponent = obsidian.MomentFormatComponent;
export const Platform = obsidian.Platform;
export const loadMathJax = obsidian.loadMathJax;
export const prepareFuzzySearch = obsidian.prepareFuzzySearch;
export const debounce = obsidian.debounce;
export const getAllTags = obsidian.getAllTags;
export const parseFrontMatterAliases = obsidian.parseFrontMatterAliases;
export const parseFrontMatterTags = obsidian.parseFrontMatterTags;
export const resolveSubpath = obsidian.resolveSubpath;
export const normalizePath = obsidian.normalizePath;
export const requestUrl = obsidian.requestUrl;
export const MarkdownRenderChild = obsidian.MarkdownRenderChild;
