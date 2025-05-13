import { usePlugin } from "$lib/utils";
import type { CachedMetadata, TFile } from "obsidian";
import { processEmbeds, processLinks } from "$lib/utils/embeds.ts";
import { processTemplate } from "$lib/utils/templates.ts";
import { fileTree } from "$lib/utils/file-tree.ts";
import * as _ from "lodash";
import Ajv from "ajv";

type SystemMessageOptions = {
  template?: {
    autoescape?: boolean;
    throwOnUndefined?: boolean;
  };
};

export async function createSystemContent(
  file: TFile,
  options: SystemMessageOptions = {},
) {
  const plugin = usePlugin();
  const metadata = plugin.app.metadataCache.getFileCache(file);
  const data = extractDataFromFrontmatter(metadata);
  const schema = extractSchemaFromFrontmatter(metadata);
  validateDataAgainstSchema(data, schema);
  let system = await plugin.app.vault.read(file);
  system = stripFrontmatter(system);
  system = unescapeTags(system);
  system = await processEmbeds(file, system);
  system = await processLinks(file, system);
  system = await processTemplate(system, { fileTree }, data, options.template);
  return system;
}

function validateDataAgainstSchema(
  data: Record<string, any>,
  schema: Record<string, any>,
): void {
  try {
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate(data);

    if (!valid) {
      const errors = validate.errors
        ?.map((err) => {
          return `${err.instancePath} ${err.message}`;
        })
        .join(", ");
      throw new Error(
        `Data validation failed: ${errors || "Data does not conform to the schema"}`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Schema validation error: ${error.message}`);
    } else {
      throw new Error("Unknown schema validation error");
    }
  }
}

function unescapeTags(text: string): string {
  // Replace tags like \<hello> or \</hello> with <hello> or </hello>
  return text.replace(/\\(<\/?[^>]+>)/g, "$1");
}

function stripFrontmatter(content: string): string {
  // Match YAML frontmatter between --- delimiters at the start of the content
  const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
  return content.replace(frontmatterRegex, "");
}

function extractDataFromFrontmatter(
  metadata: CachedMetadata,
): Record<string, any> {
  const data = {};
  if (!("frontmatter" in metadata)) {
    return data;
  }
  for (const [key, value] of Object.entries(metadata.frontmatter)) {
    if (key.startsWith("data.")) {
      _.set(data, key.substring(5), value);
    }
  }
  return data;
}

function extractSchemaFromFrontmatter(
  metadata: CachedMetadata,
): Record<string, any> {
  const schema = {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: true,
  };
  if (!("frontmatter" in metadata)) {
    return schema;
  }
  for (const [key, value] of Object.entries(metadata.frontmatter)) {
    if (key.startsWith("schema.")) {
      const propertyPath = key.substring(7);

      // Handle special case for required properties
      if (propertyPath === "required" && Array.isArray(value)) {
        schema.required = value;
        continue;
      }

      // Handle property definitions
      const keys = propertyPath.split(".");
      const lastKey = keys.pop();
      let currentObj = schema.properties;

      // Build nested objects structure
      for (const k of keys) {
        if (!currentObj[k]) {
          currentObj[k] = {
            type: "object",
            properties: {},
          };
        } else if (!currentObj[k].properties) {
          currentObj[k].properties = {};
        }
        currentObj = currentObj[k].properties;
      }

      // Set the property type based on the value
      if (lastKey) {
        currentObj[lastKey] = {
          type: value,
        };
      }
    }
  }
  return schema;
}
