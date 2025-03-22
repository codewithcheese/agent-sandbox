import * as Comlink from "comlink";
import type { PyodideWorkerAPI } from "./api";
import workerCode from "./worker.js?raw";

export class PyodideExecutor {
  private worker: Worker | null = null;
  private workerLink: PyodideWorkerAPI | null = null;
  public isLoading: boolean = false;

  async load() {
    if (this.workerLink) {
      return;
    }
    this.isLoading = true;

    return new Promise<void>(async (resolve, reject) => {
      try {
        // Use Vite's worker import syntax which will be properly bundled
        const blob = new Blob([workerCode], { type: "application/javascript" });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);
        // this.worker = new PyodideWorker();

        // Add error listener for top-level worker errors
        this.worker.addEventListener("error", (event) => {
          console.error("Worker error:", event);
          this.isLoading = false;
          reject(event.error);
        });

        this.workerLink = Comlink.wrap<PyodideWorkerAPI>(this.worker);
        await this.workerLink.init();
        this.isLoading = false;
        resolve();
      } catch (error) {
        console.error("Error loading worker:", error);
        this.isLoading = false;
        reject(error);
      }
    });
  }

  async execute(code: string, globals?: Record<string, any>) {
    if (!this.workerLink) {
      await this.load();
    }
    return await this.workerLink.execute(code, globals);
  }

  async installPackage(packageName: string) {
    if (!this.workerLink) {
      await this.load();
    }
    return this.workerLink.installPackage(packageName);
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerLink = null;
      this.isLoading = false;
    }
  }
}
