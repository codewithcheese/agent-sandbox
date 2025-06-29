import { generateText, type ModelMessage } from "ai";
import { createAIProvider } from "../settings/providers";
import { usePlugin } from "$lib/utils";
import { hasVariable, renderStringAsync } from "$lib/utils/nunjucks";
import { Notice } from "obsidian";

export async function postProcessTranscription(transcript: string): Promise<string | null> {
  const plugin = usePlugin();
  const { recording } = plugin.settings;
  
  // Check if post-processing is enabled
  if (!recording.postProcessing.enabled) {
    return transcript; // Return original if disabled
  }

  // Check if account and model are selected
  if (!recording.postProcessing.accountId || !recording.postProcessing.modelId) {
    new Notice(
      "Post-processing is enabled but no model is selected. Please select a post-processing model in settings or disable post-processing.",
      8000,
    );
    return transcript; // Return original when no model selected
  }

  // Validate prompt has required variable
  if (!hasVariable(recording.postProcessing.prompt, "transcript")) {
    new Notice(
      "Transcription post-processing failed. Prompt must contain {{ transcript }} variable.",
      5000,
    );
    return transcript; // Return original on error
  }

  // Find account and model
  const account = plugin.settings.accounts.find(
    (a) => a.id === recording.postProcessing.accountId,
  );
  if (!account) {
    new Notice(
      `Transcription post-processing failed. Account ${recording.postProcessing.accountId} not found.`,
      5000,
    );
    return transcript; // Return original on error
  }

  const model = plugin.settings.models.find(
    (m) => m.id === recording.postProcessing.modelId,
  );
  if (!model) {
    new Notice(
      `Transcription post-processing failed. Model ${recording.postProcessing.modelId} not found.`,
      5000,
    );
    return transcript; // Return original on error
  }

  try {
    // Insert the transcript into the prompt template
    const promptWithTranscript = await renderStringAsync(
      recording.postProcessing.prompt,
      { transcript },
      { autoescape: false, throwOnUndefined: true },
    );

    // Create messages with assistant priming for <cleaned> tag
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: promptWithTranscript,
      },
      {
        role: "assistant",
        content: "<cleaned>",
      },
    ];

    const provider = createAIProvider(account);

    const textResult = await generateText({
      model: provider.languageModel(model.id),
      messages,
      maxRetries: 1,
      temperature: 0.2, // Low temperature for consistent cleaning
    });

    // Extract cleaned text from <cleaned> tags
    const cleanedMatch = textResult.text.match(/(?:<cleaned>|^)(.*?)<\/cleaned>/s);
    
    if (!cleanedMatch || !cleanedMatch[1]) {
      console.warn("Post-processing failed to extract cleaned text, using original");
      return transcript; // Return original if extraction fails
    }

    const cleanedText = cleanedMatch[1].trim();
    
    // Basic validation - ensure we didn't lose too much content
    if (cleanedText.length < transcript.length * 0.3) {
      console.warn("Post-processing removed too much content, using original");
      return transcript; // Return original if too much was removed
    }

    return cleanedText;
  } catch (error) {
    console.error("Transcription post-processing error:", error);
    new Notice(`Transcription post-processing failed: ${error}`, 5000);
    return transcript; // Return original on error
  }
}
