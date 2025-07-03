import { afterAll, beforeAll, beforeEach } from "vitest";
import { Polly } from "@pollyjs/core";
import FSPersister from "@pollyjs/persister-fs";
import FetchAdapter from "@pollyjs/adapter-fetch";

Polly.register(FetchAdapter);
Polly.register(FSPersister);

/**
 * Sets up Polly for recording and replaying HTTP interactions in tests.
 *
 * @param {Object} [options={}] - Configuration options for the recording.
 * @param {string} [options.recordingName] - The name of the recording. If not provided, the suite name will be used.
 * @param {string} [options.recordingPath] - The path to save the recordings. If not provided, the recordings will be saved in a "__recordings__" directory next to the test file.
 */
export function useRecording(
  options: { recordingName?: string; recordingPath?: string } = {},
) {
  let polly: Polly;

  beforeAll((suite) => {
    try {
      polly = new Polly(options.recordingName ?? suite.name, {
        adapters: ["fetch"],
        mode: "replay",
        recordIfMissing: true,
        recordFailedRequests: false,
        persister: "fs",
        logLevel: "trace",
        persisterOptions: {
          fs: {
            recordingsDir:
              options.recordingPath ??
              `${suite.file.filepath.substring(0, suite.file.filepath.lastIndexOf("/"))}/__recordings__`,
          },
        },
      });
      polly.server.any().on("beforePersist", (_req, recording) => {
        // headers
        recording.request.headers = recording.request.headers.filter(
          ({ name }) => !["authorization", "x-api-key"].includes(name),
        );

        // query-string parameters
        recording.request.queryString = recording.request.queryString.filter(
          ({ name }) => !["access_token", "api_key"].includes(name),
        );
      });
    } catch (error) {
      console.error(error);
      throw error;
    }
  });

  beforeEach((context) => {
    // Overwrite recording name on a per-test basis
    polly.recordingName = options.recordingName ?? context.task.name;
  });

  afterAll(async () => {
    await polly.stop();
  });

  return;
}
