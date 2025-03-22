export interface PyodideWorkerResponse {
  id: number;
  success: boolean;
  result?: any;
  error?: string;
  stdout?: string;
}

export interface PyodideWorkerAPI {
  init(): Promise<void>;
  execute(
    code: string,
    globals?: Record<string, any>,
  ): Promise<PyodideWorkerResponse>;
  installPackage(packageName: string): Promise<void>;
}
