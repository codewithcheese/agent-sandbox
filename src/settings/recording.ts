import { usePlugin } from "$lib/utils";

export function getTranscriptionAccount() {
  const plugin = usePlugin();
  const settings = plugin.settings?.recording;
  if (!settings?.modelId) {
    throw new Error("Transcription model not configured");
  }

  const model = plugin.settings.models.find((m) => m.id === settings.modelId);
  if (!model) {
    throw new Error(`Transcription model ${settings.modelId} not found`);
  }

  if (!settings.accountId) {
    throw new Error("Transcription account not configured");
  }

  const account = plugin.settings.accounts.find(
    (a) => a.id === settings.accountId,
  );
  if (!account) {
    throw new Error(`Transcription account ${settings.accountId} not found`);
  }

  if (model.provider !== "assemblyai") {
    throw new Error(
      `Transcription provider ${model.provider} is not supported`,
    );
  }

  return { model, account };
}
