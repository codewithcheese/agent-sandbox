export const ignoreMatchOptions = {
  dot: true,
  basename: false,
  nocase: true,
};

export const patternMatchOptions = {
  dot: true,
  basename: true,
  nocase: true,
};

export const COMMON_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/vendor/bundle/**",
  "**/vendor/**",
  "**/venv/**",
  "**/env/**",
  "**/.venv/**",
  "**/.env/**",
  "**/.tox/**",
  "**/target/**",
  "**/build/**",
  "**/.gradle/**",
  "**/bin/**",
  "**/obj/**",
  "**/.build/**",
  "**/.dart_tool/**",
  "**/.pub-cache/**",
  "**/_build/**",
  "**/deps/**",
  "**/dist/**",
  "**/dist-newstyle/**",
  "**/.deno/**",
  "**/bower_components/**",
];

export function removeUndefinedFields<T extends Record<string, any>>(obj: T): T {
  const result = {} as T;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key as keyof T] = value;
    }
  }
  return result;
}
