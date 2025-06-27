import { usePlugin } from "$lib/utils";
import { normalizePath, TFile, TFolder } from "obsidian";
import type { Recording } from "./types";

/**
 * Get the transcriptions folder path from settings
 */
export function getTranscriptionsPath(): string {
  const plugin = usePlugin();
  return plugin.settings.recording.transcriptionsPath || "transcriptions";
}

/**
 * Generate a filename for a transcription
 */
export function generateTranscriptionFilename(date: Date): string {
  const timestamp = date.toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `${timestamp}.md`;
}

/**
 * Create frontmatter for a transcription file
 */
export function createTranscriptionFrontmatter(
  date: Date,
  duration: number,
): string {
  return `---
created: ${date.toISOString()}
duration: ${duration}
source: voice-recorder
---

`;
}

/**
 * Save a transcription to a file
 */
export async function saveTranscriptionFile(
  text: string,
  date: Date,
  duration: number,
): Promise<TFile | null> {
  try {
    const plugin = usePlugin();
    const transcriptionsPath = getTranscriptionsPath();
    const filename = generateTranscriptionFilename(date);
    const filePath = normalizePath(`${transcriptionsPath}/${filename}`);

    // Create the folder if it doesn't exist
    const folderPath = transcriptionsPath;
    if (!(await plugin.app.vault.adapter.exists(folderPath))) {
      await plugin.app.vault.createFolder(folderPath);
    }

    // Create file content
    const frontmatter = createTranscriptionFrontmatter(date, duration);
    const content = frontmatter + text;

    // Create the file
    const file = await plugin.app.vault.create(filePath, content);
    return file;
  } catch (error) {
    console.error("Failed to save transcription file:", error);
    return null;
  }
}

/**
 * Load all transcription files from the transcriptions folder
 */
export async function loadTranscriptionFiles(): Promise<Recording[]> {
  try {
    const plugin = usePlugin();
    const transcriptionsPath = getTranscriptionsPath();

    // Check if folder exists
    if (!(await plugin.app.vault.adapter.exists(transcriptionsPath))) {
      return [];
    }

    // Get all .md files in the transcriptions folder
    const folder = plugin.app.vault.getAbstractFileByPath(transcriptionsPath);
    if (!folder || !(folder instanceof TFolder)) {
      return [];
    }

    const files = plugin.app.vault
      .getMarkdownFiles()
      .filter(
        (file) =>
          file.path.startsWith(transcriptionsPath + "/") &&
          file.path.endsWith(".md"),
      );

    const transcriptions: Recording[] = [];

    for (const file of files) {
      try {
        const content = await plugin.app.vault.read(file);
        const transcription = parseTranscriptionFile(file, content);
        if (transcription) {
          transcriptions.push(transcription);
        }
      } catch (error) {
        console.error(`Failed to read transcription file ${file.path}:`, error);
      }
    }

    // Sort by file modified time (newest first)
    return transcriptions.sort((a, b) => {
      const aModified = a.file.stat.mtime;
      const bModified = b.file.stat.mtime;
      return bModified - aModified;
    });
  } catch (error) {
    console.error("Failed to load transcription files:", error);
    return [];
  }
}

/**
 * Parse a transcription file and extract metadata
 */
function parseTranscriptionFile(
  file: TFile,
  content: string,
): Recording | null {
  try {
    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const textContent = content.slice(frontmatterMatch[0].length);

    // Parse frontmatter fields
    const createdMatch = frontmatter.match(/created:\s*(.+)/);
    const durationMatch = frontmatter.match(/duration:\s*(.+)/);

    if (!createdMatch || !durationMatch) {
      return null;
    }

    const date = new Date(createdMatch[1]);
    const duration = parseFloat(durationMatch[1]);

    // Extract text content (remove "# Transcription" header)
    const text = textContent.replace(/^# Transcription\s*\n+/, "").trim();

    return {
      id: file.path, // Use file path as ID
      text,
      date,
      duration,
      audioUrl: null,
      file,
    };
  } catch (error) {
    console.error(`Failed to parse transcription file ${file.path}:`, error);
    return null;
  }
}
