import { usePlugin } from "$lib/utils";

export function getTranscriptionAccount() {
  const plugin = usePlugin();
  const settings = plugin.settings.recording;

  if (!settings.accountId) {
    throw new Error(
      "Transcription account not found. Select an account in settings.",
    );
  }

  const account = plugin.settings.accounts.find(
    (a) => a.id === settings.accountId,
  );
  if (!account) {
    throw new Error(`Transcription account ${settings.accountId} not found`);
  }

  if (account.provider !== "assemblyai") {
    throw new Error(
      `Transcription provider ${account.provider} is not supported`,
    );
  }

  return { account };
}
