import type { TFile } from "obsidian";

export interface Recording {
  id: string;
  text: string;
  date: Date;
  duration: number; // seconds
  audioUrl: null; // reserved for future wav saving
  file: TFile; // Obsidian TFile reference (required)
}
