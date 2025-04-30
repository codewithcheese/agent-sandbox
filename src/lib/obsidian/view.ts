export const VIEW_CTX = Symbol("view");

export type ViewContext = {
  position: "right" | "left" | "center";
  name: string;
};
