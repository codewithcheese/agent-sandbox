export type ModelConfig = {
  baseURL?: string;
  apiKey?: string;
};

export const ModelConfigField = {
  apiKey: {
    name: "API Key",
    description: "Your API key for authentication.",
    placeholder: "sk-...",
    isPassword: true,
  },
  baseURL: {
    name: "Base URL",
    description: "The base URL for the API.",
    placeholder: "https://api.example.com",
    isPassword: false,
  },
} as const;

export const ModelProvider: Record<
  string,
  {
    name: string;
    requiredFields: (keyof typeof ModelConfigField)[];
    optionalFields: (keyof typeof ModelConfigField)[];
  }
> = {
  ollama: {
    name: "Ollama",
    requiredFields: [],
    optionalFields: ["baseURL"],
  },
  openai: {
    name: "OpenAI",
    requiredFields: ["apiKey"],
    optionalFields: ["baseURL"],
  },
} as const;

export function validateProviderConfig(
  provider: keyof typeof ModelProvider,
  config: ModelConfig,
): string[] {
  const entry = ModelProvider[provider];
  if (!entry) {
    return [`Unsupported provider: ${provider}`];
  }

  const errors: string[] = [];

  // Check that all required fields are present
  for (const fieldKey of entry.requiredFields) {
    const fieldValue = config[fieldKey];
    if (!fieldValue) {
      errors.push(`${ModelConfigField[fieldKey].name} is required`);
    }
  }

  return errors;
}
