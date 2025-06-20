export const ignoreMatchOptions = {
  dot: true,
  basename: false,
  nocase: true,
};

export const patternMatchOptions = {
  dot: true,
  basename: true,
  nocase: false,
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
  "**/packages/**",
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
