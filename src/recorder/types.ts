import type { TFile } from "obsidian";

export interface Recording {
  id: string;
  text: string;
  date: Date;
  duration: number;
  audioUrl: string | null;
  file: TFile;
}
