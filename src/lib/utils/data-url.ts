export function parseDataUrl(dataUrl: string): {
  mimeType: string;
  encoding: string;
  data: string;
} {
  // Check if it's a data URL
  if (!dataUrl.startsWith("data:")) {
    throw new Error("Not a valid data URL");
  }

  // Parse the data URL
  const matches = dataUrl.match(/^data:([^;]+)(?:;([^,]+))?,(.*)$/);

  if (!matches) {
    throw new Error("Invalid data URL format");
  }

  return {
    mimeType: matches[1] || "",
    encoding: matches[2] || "",
    data: matches[3] || "",
  };
}

export function extractDataFromDataUrl(dataUrl: string): {
  mimeType: string;
  data: string;
} {
  const { mimeType, encoding, data } = parseDataUrl(dataUrl);

  if (encoding === "base64") {
    return {
      mimeType,
      data: atob(data),
    };
  } else {
    return {
      mimeType,
      data: decodeURIComponent(data),
    };
  }
}
