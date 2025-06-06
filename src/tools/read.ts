import { homedir as getHomeDirectory } from "os";
import path from "path"; // Assuming 'bh' and 'Dp1' refer to the path module
import fs from "fs"; // Assuming 'b1()' provides fs
import picomatch from "picomatch";
import { normalizePath } from "obsidian"; // Assuming 'fm0.default()' is picomatch

// --- Constants ---
const PATH_SEPARATOR = path.sep;
const MAX_FILE_SIZE_FOR_FULL_READ_BYTES = 262144; // yF1
const MAX_TOKEN_COUNT = 25000; // hr
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]); // jF1
const KNOWN_BINARY_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "flac",
  "ogg",
  "aac",
  "m4a",
  "wma",
  "aiff",
  "opus",
  "mp4",
  "avi",
  "mov",
  "wmv",
  "flv",
  "mkv",
  "webm",
  "m4v",
  "mpeg",
  "mpg",
  "zip",
  "rar",
  "tar",
  "gz",
  "bz2",
  "7z",
  "xz",
  "z",
  "tgz",
  "iso",
  "exe",
  "dll",
  "so",
  "dylib",
  "app",
  "msi",
  "deb",
  "rpm",
  "bin",
  "dat",
  "db",
  "sqlite",
  "sqlite3",
  "mdb",
  "idx",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "psd",
  "ai",
  "eps",
  "sketch",
  "fig",
  "xd",
  "blend",
  "obj",
  "3ds",
  "max",
  "class",
  "jar",
  "war",
  "pyc",
  "pyo",
  "rlib",
  "swf",
  "fla",
]); // Kw6

const IMAGE_MAX_DIMENSION_BEFORE_RESIZE = 2000; // SF1, _F1
const IMAGE_MAX_BYTES_BEFORE_RESIZE = 3932160; // Gp1 (approx 3.75MB)

const JUPYTER_TOOL_NAME = "Jupyter Notebook extension"; // Placeholder for kh
const PERMISSION_TYPE_READ = "read"; // oL
const PERMISSION_TYPE_EDIT = "edit"; // _U
const PERMISSION_BEHAVIOR_DENY = "deny";
const PERMISSION_BEHAVIOR_ALLOW = "allow";

// --- Mock/Placeholder External Functions & Objects ---
// These would be properly imported or defined in a real application.

// Mock for project settings / configuration store
const getProjectSettings = () => ({
  // E9()
  ignorePatterns: [], // Example: ["**/node_modules/**", ".git/**"]
});

// Mock for getting raw permission rules from different sources
const getRawPermissionRulesFromSource = (
  permissionContext,
  permissionType,
  behavior,
) => {
  // cu1()
  // This function would fetch rules based on context, type, and behavior
  // For example, from user settings, project settings, etc.
  // Returns a Map of [patternString, ruleDetailsObject]
  // ruleDetailsObject should have a 'source' property (e.g., "projectSettings", "userSettings")
  return new Map();
};

const getCurrentWorkingDirectory = () => process.cwd(); // uA()
const getCliArgRootPath = () => process.cwd(); // u4() - Assuming CLI args are relative to CWD or a specific root

const suggestSimilarFilePath = (filePath) => null; // Ux()
const countTokens = (text) => text.length / 4; // Ur() - Very rough approximation
const countTokensAsync = async (text, isNonInteractive) => countTokens(text); // Wg0()
const logProcessingError = (error) => console.error("Processing Error:", error); // g1()
const readFileLinesWithLimitOffset = (filePath, startLineIndex, lineLimit) => {
  // xLA()
  // Actual implementation would read file lines respecting offset and limit
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const totalLines = lines.length;
    const effectiveStart = Math.max(0, startLineIndex);
    let selectedLines;
    if (lineLimit === undefined) {
      selectedLines = lines.slice(effectiveStart);
    } else {
      selectedLines = lines.slice(effectiveStart, effectiveStart + lineLimit);
    }
    return {
      content: selectedLines.join("\n"),
      lineCount: selectedLines.length,
      totalLines: totalLines,
    };
  } catch (e) {
    logProcessingError(e);
    return { content: "", lineCount: 0, totalLines: 0 };
  }
};

const dynamicImportSharp = async () => {
  // J1(PF1(), 1)
  try {
    return (await import("sharp")).default;
  } catch (e) {
    logProcessingError(
      "Sharp module not found. Image processing will be limited.",
    );
    return null;
  }
};

// --- Path Normalization and Resolution Helpers ---

/**
 * Checks if a path is absolute.
 * @param {string} filePath
 * @returns {boolean}
 */
const isAbsolutePath = (filePath) => {
  // $K6(A)
  return path.isAbsolute(filePath);
};

/**
 * Normalizes path separators and joins path segments.
 * If the first path is absolute, it's used as the base. Otherwise, basePath is prepended.
 * @param {string} basePath
 * @param  {...string} subPaths
 * @returns {string}
 */
const normalizePathSeparators = (basePath, ...subPaths) => {
  // xm0(A, B) where A is base, B is subPath
  const fullPath = subPaths.join(PATH_SEPARATOR);
  if (isAbsolutePath(fullPath)) {
    return path.normalize(fullPath);
  }
  return path.normalize(path.join(basePath, fullPath));
};

/**
 * Resolves a path, making it absolute and normalized.
 * @param {string} filePath
 * @returns {string}
 */
const resolvePath = (filePath) => {
  // KM1(A)
  // This might involve more complex logic in the original, like resolving against a project root
  return path.resolve(filePath);
};

/**
 * Determines the root path for a given setting type.
 * @param {string} settingType - e.g., "cliArg", "userSettings"
 * @returns {string | null}
 */
const getSettingsRootPath = (settingType) => {
  // RK6(A)
  switch (settingType) {
    case "cliArg":
      return normalizePathSeparators(getCliArgRootPath());
    case "userSettings":
    case "policySettings":
    case "projectSettings": // S41(A) - Assuming S41 is a more specific getter for these
    case "localSettings":
      // This would typically return the path to the respective settings file's directory
      // or a conventional project root for projectSettings.
      // For simplicity, let's assume projectSettings relate to CWD.
      if (settingType === "projectSettings")
        return getCurrentWorkingDirectory();
      return getHomeDirectory(); // Placeholder for others
    default:
      return null;
  }
};

// --- Permission System Helpers (Simplified for isPathIgnoredByProjectConfig) ---

/**
 * Parses a permission pattern string to determine its relative pattern and root.
 * - Patterns like "//foo" are relative to the root of the filesystem.
 * - Patterns like "~/foo" are relative to the home directory.
 * - Patterns like "/foo" are relative to the root determined by `sourceContext`.
 * - Other patterns are considered relative to `null` root (meaning they apply globally within their defined scope if not further processed).
 * @param {string} patternString
 * @param {string} sourceContext - e.g., "projectSettings", "userSettings"
 * @returns {{relativePattern: string, root: string | null}}
 */
const parsePermissionPattern = (patternString, sourceContext) => {
  // bm0(A, B)
  if (patternString.startsWith(`${PATH_SEPARATOR}${PATH_SEPARATOR}`)) {
    // e.g. //some/path (root of drive)
    return {
      relativePattern: patternString.slice(1), // Keep one leading separator for root-relative
      root: PATH_SEPARATOR, // Special marker for filesystem root
    };
  } else if (patternString.startsWith(`~${PATH_SEPARATOR}`)) {
    // e.g. ~/some/path
    return {
      relativePattern: patternString.slice(1), // Keep leading separator for home-relative
      root: getHomeDirectory(),
    };
  } else if (patternString.startsWith(PATH_SEPARATOR)) {
    // e.g. /some/path (relative to context root)
    return {
      relativePattern: patternString,
      root: getSettingsRootPath(sourceContext),
    };
  }
  // Pattern is relative to its definition context (e.g., a .gitignore in a subfolder)
  // The `root: null` here means its root is determined by where the rule was defined.
  // This will be resolved later by `resolvePatternToProjectRoot`.
  return {
    relativePattern: patternString,
    root: null, // Indicates the pattern's root is the location of its defining config file
  };
};

/**
 * Groups permission rules by their effective root path.
 * @param {any} permissionContext - Context object passed around.
 * @param {string} permissionType - e.g., "read", "edit".
 * @param {string} behavior - e.g., "deny", "allow".
 * @returns {Map<string | null, Map<string, any>>} Map from root path to (Map of pattern to rule details).
 */
const getGroupedPermissionRules = (
  permissionContext,
  permissionType,
  behavior,
) => {
  // gm0(A, B, Q)
  const rawRules = getRawPermissionRulesFromSource(
    permissionContext,
    permissionType,
    behavior,
  );
  const groupedRules = new Map(); // Map<rootPath | null, Map<patternString, ruleDetails>>

  for (let [patternString, ruleDetails] of rawRules.entries()) {
    const { relativePattern, root: patternRootPath } = parsePermissionPattern(
      patternString,
      ruleDetails.source,
    );
    let patternsAtRoot = groupedRules.get(patternRootPath);
    if (!patternsAtRoot) {
      patternsAtRoot = new Map();
      groupedRules.set(patternRootPath, patternsAtRoot);
    }
    patternsAtRoot.set(relativePattern, ruleDetails);
  }
  return groupedRules;
};

/**
 * Finds a matching permission rule for a given file path.
 * @param {string} absoluteFilePath - The absolute path to check.
 * @param {any} permissionContext - The permission context.
 * @param {string} permissionType - "read" or "edit".
 * @param {string} behavior - "deny" or "allow".
 * @returns {any | null} The matching rule object or null.
 */
const findMatchingPermissionRule = (
  absoluteFilePath,
  permissionContext,
  permissionType,
  behavior,
) => {
  // HF1(A, B, Q, I)
  const groupedRules = getGroupedPermissionRules(
    permissionContext,
    permissionType,
    behavior,
  );
  const normalizedFilePathToCheck = normalizePathSeparators(absoluteFilePath);

  for (let [definedRuleRootPath, patternsAtRoot] of groupedRules.entries()) {
    const effectiveRuleRoot =
      definedRuleRootPath === PATH_SEPARATOR
        ? "" // For patterns like "//foo"
        : (definedRuleRootPath ?? getCurrentWorkingDirectory()); // If null, assume CWD or project root

    const patternsArray = Array.from(patternsAtRoot.keys());
    if (patternsArray.length === 0) continue;

    const matcher = picomatch(patternsArray, {
      dot: true,
      cwd: effectiveRuleRoot,
    });

    // Path to test needs to be relative to the matcher's CWD (effectiveRuleRoot)
    let relativePathToTest = path.relative(
      effectiveRuleRoot,
      normalizedFilePathToCheck,
    );
    if (
      relativePathToTest === "" &&
      patternsArray.some((p) => p === "." || p === "./")
    ) {
      // Match current dir
      relativePathToTest = ".";
    }

    if (relativePathToTest.startsWith(`..${PATH_SEPARATOR}`)) {
      // File is outside the CWD of these patterns
      continue;
    }

    const isMatch = matcher(relativePathToTest);

    if (isMatch) {
      // Picomatch returns the pattern string that matched if used with an array of patterns.
      // We need to find the original rule object.
      // This part is tricky as picomatch might return a slightly modified pattern.
      // A more robust way would be to iterate and test one by one if picomatch doesn't directly give the original.
      // For simplicity, assuming `isMatch` directly gives a key in `patternsAtRoot` or we find it.
      let matchedPatternKey = patternsArray.find((p) =>
        picomatch(p, { dot: true, cwd: effectiveRuleRoot })(relativePathToTest),
      );
      if (matchedPatternKey && patternsAtRoot.has(matchedPatternKey)) {
        return patternsAtRoot.get(matchedPatternKey);
      }
    }
  }
  return null;
};

/**
 * Checks if a given file path is ignored by project configuration or deny rules.
 * This is a simplified version of what Nx(G) would do.
 * @param {string} absoluteFilePath
 * @param {any} permissionContext
 * @returns {boolean}
 */
const isPathIgnoredByProjectConfig = (absoluteFilePath, permissionContext) => {
  // Nx(G)
  // This function effectively checks if there's a "deny read" rule matching the file.
  const denyRule = findMatchingPermissionRule(
    absoluteFilePath,
    permissionContext,
    PERMISSION_TYPE_READ,
    PERMISSION_BEHAVIOR_DENY,
  );
  return denyRule !== null;
};

// --- Message Formatting ---
const formatFileSizeTooLargeMessage = (fileSize) => {
  // Zp1(A)
  return `File content (${Math.round(fileSize / 1024)}KB) exceeds maximum allowed size (${Math.round(MAX_FILE_SIZE_FOR_FULL_READ_BYTES / 1024)}KB). Please use offset and limit parameters to read specific portions of the file.`;
};

const formatTokenCountTooLargeMessage = (tokenCount) => {
  // zw6(A)
  return `File content (${tokenCount} tokens) exceeds maximum allowed tokens (${MAX_TOKEN_COUNT}). Please use offset and limit parameters to read specific portions of the file.`;
};

// --- Core File Processing Logic ---

/**
 * Validates input parameters for reading a file.
 * @param {object} options
 * @param {string} options.file_path - The path to the file.
 * @param {number} [options.offset] - The offset (line number, 1-based) to start reading from.
 * @param {number} [options.limit] - The number of lines to read.
 * @param {any} permissionContext - Context for permission checks.
 * @returns {Promise<object>} Validation result.
 */
async function validateInputParameters(
  {
    // Original validateInput
    file_path: rawFilePath,
    offset,
    limit,
  },
  permissionContext,
) {
  const resolvedFilePath = normalizePath(rawFilePath);

  if (isPathIgnoredByProjectConfig(resolvedFilePath, permissionContext)) {
    return {
      result: false,
      message:
        "File is in a directory that is ignored by your project configuration.",
      errorCode: 1, // FILE_IGNORED_BY_CONFIG
    };
  }

  if (!fs.existsSync(resolvedFilePath)) {
    let message = "File does not exist.";
    const suggestedPath = suggestSimilarFilePath(resolvedFilePath);
    if (suggestedPath) {
      message += ` Did you mean ${suggestedPath}?`;
    }
    return { result: false, message, errorCode: 2 }; // FILE_DOES_NOT_EXIST
  }

  if (resolvedFilePath.endsWith(".ipynb")) {
    return {
      result: false,
      message: `File is a Jupyter Notebook. Use the ${JUPYTER_TOOL_NAME} to read this file.`,
      errorCode: 3, // FILE_IS_JUPYTER_NOTEBOOK
    };
  }

  const fileStats = fs.statSync(resolvedFilePath);
  const fileSizeInBytes = fileStats.size;
  const fileExtensionWithDot = path.extname(resolvedFilePath).toLowerCase();
  const fileExtension = fileExtensionWithDot.startsWith(".")
    ? fileExtensionWithDot.slice(1)
    : fileExtensionWithDot;

  if (KNOWN_BINARY_EXTENSIONS.has(fileExtension)) {
    return {
      result: false,
      message: `This tool cannot read binary files. The file appears to be a binary ${fileExtensionWithDot} file. Please use appropriate tools for binary file analysis.`,
      errorCode: 4, // FILE_IS_BINARY
    };
  }

  if (fileSizeInBytes === 0) {
    if (IMAGE_EXTENSIONS.has(fileExtension)) {
      return {
        result: false,
        message: "Empty image files cannot be processed.",
        errorCode: 5, // EMPTY_IMAGE_FILE
      };
    }
    // Other empty files might be okay, or handled by the `call` function.
  }

  // Check size limits for non-image files if no offset/limit is provided
  if (!IMAGE_EXTENSIONS.has(fileExtension)) {
    if (
      fileSizeInBytes > MAX_FILE_SIZE_FOR_FULL_READ_BYTES &&
      !offset &&
      !limit
    ) {
      return {
        result: false,
        message: formatFileSizeTooLargeMessage(fileSizeInBytes),
        meta: { fileSize: fileSizeInBytes },
        errorCode: 6, // FILE_TOO_LARGE_FOR_FULL_READ
      };
    }
  }

  return { result: true };
}

/**
 * Validates content against size and token limits.
 * @param {string} content
 * @param {string} fileExtensionWithoutDot
 * @param {boolean} isNonInteractiveSession
 * @throws {Error} if limits are exceeded.
 */
async function validateContentLimits(
  content,
  fileExtensionWithoutDot,
  isNonInteractiveSession,
) {
  // ww6
  if (
    !IMAGE_EXTENSIONS.has(fileExtensionWithoutDot) &&
    content.length > MAX_FILE_SIZE_FOR_FULL_READ_BYTES
  ) {
    throw new Error(formatFileSizeTooLargeMessage(content.length));
  }

  // Rough token check for very large content to avoid expensive tokenization
  // (Original Ur was synchronous, Wg0 async)
  if (content.length > MAX_TOKEN_COUNT * 4) {
    // Assuming average 4 chars per token
    const tokenCount = await countTokensAsync(content, isNonInteractiveSession);
    if (tokenCount > MAX_TOKEN_COUNT) {
      throw new Error(formatTokenCountTooLargeMessage(tokenCount));
    }
  }
}

/**
 * Creates a standardized image result object.
 * @param {Buffer} buffer
 * @param {string} imageType - e.g., "jpeg", "png"
 * @param {number} originalSize - Original file size in bytes.
 * @returns {object}
 */
const createImageResultObject = (buffer, imageType, originalSize) => {
  // rz
  return {
    type: "image",
    file: {
      base64: buffer.toString("base64"),
      type: `image/${imageType}`, // e.g. image/jpeg
      originalSize: originalSize,
    },
  };
};

/**
 * Prepares image metadata and buffer for Sharp processing.
 */
async function prepareImageForSharp(filePath, targetMaxBytesForBase64) {
  // Uw6
  const sharp = await dynamicImportSharp();
  if (!sharp)
    throw new Error("Image processing library (Sharp) is not available.");

  const fileStats = fs.statSync(filePath);
  const imageBuffer = fs.readFileSync(filePath); // readFileBytesSync
  const metadata = await sharp(imageBuffer).metadata();
  const format = metadata.format || "jpeg"; // Default to jpeg if format is unknown

  // targetMaxBytesForBase64 is for the *output* base64 string.
  // Base64 is ~4/3 the size of binary. So, binary target is ~3/4 of base64 target.
  const maxOutputBinaryBytes = Math.floor(targetMaxBytesForBase64 * 0.75);

  return {
    imageBuffer,
    metadata,
    format,
    maxOutputBinaryBytes, // Max bytes for the *binary* image data after resize
    originalSize: fileStats.size,
    sharpInstance: sharp, // Pass the sharp instance
  };
}

function applySharpFormatOptions(sharpChain, format) {
  // $w6
  switch (format) {
    case "png":
      return sharpChain.png({ compressionLevel: 9, palette: true });
    case "jpeg":
    case "jpg":
      return sharpChain.jpeg({ quality: 80 }); // Default good quality
    case "webp":
      return sharpChain.webp({ quality: 80 });
    default:
      return sharpChain; // No specific options or rely on auto-conversion
  }
}

async function attemptImageResizingStrategies(sharpCtx) {
  // Nw6, qw6, Mw6, Lw6 combined logic
  const resizeDimensions = [
    {
      width: sharpCtx.metadata.width || 2000,
      height: sharpCtx.metadata.height || 2000,
      suffix: "full",
    }, // Try original size first with compression
    {
      width: Math.round((sharpCtx.metadata.width || 2000) * 0.75),
      height: Math.round((sharpCtx.metadata.height || 2000) * 0.75),
      suffix: "large",
    },
    {
      width: Math.round((sharpCtx.metadata.width || 2000) * 0.5),
      height: Math.round((sharpCtx.metadata.height || 2000) * 0.5),
      suffix: "medium",
    },
    {
      width: 800,
      height: 800,
      suffix: "small_png_palette",
      forceFormat: "png",
      pngOptions: { compressionLevel: 9, palette: true, colors: 64 },
    },
    {
      width: 600,
      height: 600,
      suffix: "small_jpeg_q50",
      forceFormat: "jpeg",
      jpegOptions: { quality: 50 },
    },
    {
      width: Math.round((sharpCtx.metadata.width || 2000) * 0.25),
      height: Math.round((sharpCtx.metadata.height || 2000) * 0.25),
      suffix: "tiny",
    },
    {
      width: 400,
      height: 400,
      suffix: "fallback_jpeg_q20",
      forceFormat: "jpeg",
      jpegOptions: { quality: 20 },
    }, // Fallback
  ];

  for (const dim of resizeDimensions) {
    let chain = sharpCtx
      .sharpInstance(sharpCtx.imageBuffer)
      .resize(dim.width, dim.height, {
        fit: "inside",
        withoutEnlargement: true,
      });

    const currentFormat = dim.forceFormat || sharpCtx.format;
    if (dim.forceFormat === "png" && dim.pngOptions) {
      chain = chain.png(dim.pngOptions);
    } else if (dim.forceFormat === "jpeg" && dim.jpegOptions) {
      chain = chain.jpeg(dim.jpegOptions);
    } else {
      // Apply default format options
      chain = applySharpFormatOptions(chain, currentFormat);
    }

    const buffer = await chain.toBuffer();
    if (buffer.length <= sharpCtx.maxOutputBinaryBytes) {
      return createImageResultObject(
        buffer,
        currentFormat === "jpg" ? "jpeg" : currentFormat,
        sharpCtx.originalSize,
      );
    }
  }
  // If all strategies fail, return the smallest one (last one attempted) even if it's too large
  // The caller might decide what to do. Or, we could throw an error.
  // For now, let's return the result of the last attempt.
  const lastAttempt = resizeDimensions[resizeDimensions.length - 1];
  let fallbackChain = sharpCtx
    .sharpInstance(sharpCtx.imageBuffer)
    .resize(lastAttempt.width, lastAttempt.height, {
      fit: "inside",
      withoutEnlargement: true,
    });
  const fallbackFormat = lastAttempt.forceFormat || sharpCtx.format;
  if (lastAttempt.forceFormat === "jpeg" && lastAttempt.jpegOptions)
    fallbackChain = fallbackChain.jpeg(lastAttempt.jpegOptions);
  else fallbackChain = applySharpFormatOptions(fallbackChain, fallbackFormat);

  const fallbackBuffer = await fallbackChain.toBuffer();
  return createImageResultObject(
    fallbackBuffer,
    fallbackFormat === "jpg" ? "jpeg" : fallbackFormat,
    sharpCtx.originalSize,
  );
}

/**
 * Resizes an image to attempt to fit within an approximate byte limit (derived from token limit).
 */
async function resizeImageToFitTokenLimit(filePath, maxTokensApproximation) {
  // Ew6
  // maxTokensApproximation is MAX_TOKEN_COUNT (hr)
  // Convert token limit to an approximate base64 byte limit.
  // Original: Math.ceil(V.file.base64.length * 0.125) > hr
  // So, base64 length limit is hr / 0.125 = hr * 8
  const targetMaxBase64Bytes = maxTokensApproximation * 8; // A very rough guide

  try {
    const sharpContext = await prepareImageForSharp(
      filePath,
      targetMaxBase64Bytes,
    );
    return await attemptImageResizingStrategies(sharpContext);
  } catch (error) {
    logProcessingError(error);
    // Fallback: try to read and return a very small jpeg as last resort if sharp fails badly
    const sharp = await dynamicImportSharp();
    if (!sharp)
      return createImageResultObject(
        fs.readFileSync(filePath),
        path.extname(filePath).slice(1) || "jpeg",
        fs.statSync(filePath).size,
      ); // Cannot process

    const fallbackBuffer = await sharp(fs.readFileSync(filePath))
      .resize(400, 400, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 20 })
      .toBuffer();
    return createImageResultObject(
      fallbackBuffer,
      "jpeg",
      fs.statSync(filePath).size,
    );
  }
}

/**
 * Processes and resizes an image for display, applying size constraints.
 */
async function processAndResizeImageForDisplay(
  filePath,
  fileExtensionWithoutDot,
) {
  // Ow6
  const sharp = await dynamicImportSharp();
  if (!sharp) {
    // If sharp is not available, return raw (but check size)
    const buffer = fs.readFileSync(filePath);
    const originalSize = buffer.length;
    if (originalSize > IMAGE_MAX_BYTES_BEFORE_RESIZE * 2) {
      // Arbitrary larger limit if no resize
      throw new Error(
        `Image ${filePath} is too large (${originalSize} bytes) and cannot be resized.`,
      );
    }
    return createImageResultObject(
      buffer,
      fileExtensionWithoutDot,
      originalSize,
    );
  }

  try {
    const fileStats = fs.statSync(filePath);
    const originalSize = fileStats.size;

    if (originalSize === 0) {
      throw new Error(`Image file is empty: ${filePath}`);
    }

    const imageBuffer = fs.readFileSync(filePath);
    let sharpChain = sharp(imageBuffer);
    const metadata = await sharpChain.metadata();

    let targetWidth = metadata.width || IMAGE_MAX_DIMENSION_BEFORE_RESIZE;
    let targetHeight = metadata.height || IMAGE_MAX_DIMENSION_BEFORE_RESIZE;
    const currentFormat = metadata.format || fileExtensionWithoutDot || "jpeg";

    // If image is within reasonable size and dimensions, use as is or with mild compression
    if (
      originalSize <= IMAGE_MAX_BYTES_BEFORE_RESIZE &&
      targetWidth <= IMAGE_MAX_DIMENSION_BEFORE_RESIZE &&
      targetHeight <= IMAGE_MAX_DIMENSION_BEFORE_RESIZE
    ) {
      // Apply default compression to ensure it's not excessively large if it's uncompressed
      const compressedBuffer = await applySharpFormatOptions(
        sharpChain,
        currentFormat,
      ).toBuffer();
      return createImageResultObject(
        compressedBuffer,
        currentFormat,
        originalSize,
      );
    }

    // Apply dimension constraints
    if (targetWidth > IMAGE_MAX_DIMENSION_BEFORE_RESIZE) {
      targetHeight = Math.round(
        (targetHeight * IMAGE_MAX_DIMENSION_BEFORE_RESIZE) / targetWidth,
      );
      targetWidth = IMAGE_MAX_DIMENSION_BEFORE_RESIZE;
    }
    if (targetHeight > IMAGE_MAX_DIMENSION_BEFORE_RESIZE) {
      targetWidth = Math.round(
        (targetWidth * IMAGE_MAX_DIMENSION_BEFORE_RESIZE) / targetHeight,
      );
      targetHeight = IMAGE_MAX_DIMENSION_BEFORE_RESIZE;
    }

    sharpChain = sharpChain.resize(targetWidth, targetHeight, {
      fit: "inside",
      withoutEnlargement: true,
    });
    sharpChain = applySharpFormatOptions(sharpChain, currentFormat);

    let resizedBuffer = await sharpChain.toBuffer();

    // If still too large after dimension resize, try more aggressive JPEG compression
    if (resizedBuffer.length > IMAGE_MAX_BYTES_BEFORE_RESIZE) {
      resizedBuffer = await sharp(imageBuffer) // Start from original for this
        .resize(targetWidth, targetHeight, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 75, progressive: true }) // More aggressive
        .toBuffer();
      if (resizedBuffer.length > IMAGE_MAX_BYTES_BEFORE_RESIZE) {
        resizedBuffer = await sharp(imageBuffer)
          .resize(Math.min(targetWidth, 1024), Math.min(targetHeight, 1024), {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 60 })
          .toBuffer();
      }
    }
    return createImageResultObject(
      resizedBuffer,
      currentFormat === "jpg" ? "jpeg" : currentFormat,
      originalSize,
    );
  } catch (error) {
    logProcessingError(error);
    // Fallback: return original if processing fails, but only if it's not excessively huge
    const buffer = fs.readFileSync(filePath);
    const originalSize = buffer.length;
    if (originalSize > IMAGE_MAX_BYTES_BEFORE_RESIZE * 2) {
      throw new Error(
        `Image ${filePath} processing failed and original is too large (${originalSize} bytes).`,
      );
    }
    return createImageResultObject(
      buffer,
      fileExtensionWithoutDot,
      originalSize,
    );
  }
}

/**
 * Processes a file (text or image) based on input parameters.
 * Async generator function.
 * @param {object} params - Parameters for file processing.
 * @param {string} params.file_path - Path to the file.
 * @param {number} [params.offset=1] - 1-based line number to start reading from (for text files).
 * @param {number} [params.limit] - Number of lines to read (for text files).
 * @param {object} context - Execution context.
 * @param {object} context.readFileState - State object to store read file content/timestamp.
 * @param {object} context.options - Tool options.
 * @param {boolean} context.options.isNonInteractiveSession - Flag for session type.
 * @param {Set<string>} context.nestedMemoryAttachmentTriggers - Set to track memory attachments.
 */
async function* read(
  {
    // Original: call
    filePath,
    offset = 1, // 1-based
    limit = undefined,
  },
  context,
) {
  const {
    readFileState, // Original: G
    options: { isNonInteractiveSession }, // Original: D
    nestedMemoryAttachmentTriggers,
  } = context;

  const resolvedFilePath = normalizePath(filePath); // Original: Y = KM1(A)
  const fileExtensionWithDot = path.extname(resolvedFilePath).toLowerCase();
  const fileExtension = fileExtensionWithDot.startsWith(".")
    ? fileExtensionWithDot.slice(1)
    : ""; // Original: Z

  if (IMAGE_EXTENSIONS.has(fileExtension)) {
    let imageDataResult = await processAndResizeImageForDisplay(
      resolvedFilePath,
      fileExtension,
    ); // Original: V = Ow6(Y,Z)

    // Check if the resulting image (base64) is too large for "token" limits (approximated by byte size)
    // Original: Math.ceil(V.file.base64.length * 0.125) > hr
    const base64ByteEquivalentForTokens = imageDataResult.file.base64.length;
    if (base64ByteEquivalentForTokens / 8 > MAX_TOKEN_COUNT) {
      imageDataResult = await resizeImageToFitTokenLimit(
        resolvedFilePath,
        MAX_TOKEN_COUNT,
      ); // Original: U = Ew6(Y, hr)
    }

    readFileState[resolvedFilePath] = {
      content: imageDataResult.file.base64, // Store base64 content
      timestamp: Date.now(),
    };
    nestedMemoryAttachmentTriggers?.add(resolvedFilePath);
    yield { type: "result", data: imageDataResult };
    return;
  }

  // For text files
  const startLineIndex = offset === 0 ? 0 : offset - 1; // Convert 1-based to 0-based // Original: W
  const {
    content: fileContent, // Original: F
    lineCount: numLinesRead, // Original: J
    totalLines: totalNumLines, // Original: C
  } = readFileLinesWithLimitOffset(resolvedFilePath, startLineIndex, limit);

  // Validate content size and token limits (throws error if exceeded)
  await validateContentLimits(
    fileContent,
    fileExtension,
    isNonInteractiveSession,
  ); // Original: ww6(F, Z, D)

  readFileState[resolvedFilePath] = {
    content: fileContent,
    timestamp: Date.now(),
  };
  nestedMemoryAttachmentTriggers?.add(resolvedFilePath);

  yield {
    type: "result",
    data: {
      type: "text",
      file: {
        filePath: filePath, // Return original path as provided
        content: fileContent,
        numLines: numLinesRead,
        startLine: offset, // Return 1-based
        totalLines: totalNumLines,
      },
    },
  };
}

// To use these functions:
// const permissionCtx = { /* ... some context object ... */ };
// const validation = await validateInputParameters({ file_path: "path/to/file.txt" }, permissionCtx);
// if (validation.result) {
//   const processingContext = {
//     readFileState: {},
//     options: { isNonInteractiveSession: false },
//     nestedMemoryAttachmentTriggers: new Set()
//   };
//   for await (const result of processFile({ file_path: "path/to/file.txt" }, processingContext)) {
//     console.log(result);
//   }
// } else {
//   console.error("Validation failed:", validation.message);
// }
