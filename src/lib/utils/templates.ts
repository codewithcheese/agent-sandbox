import Handlebars from "handlebars";
import asyncHelpers from "handlebars-async-helpers";

type AsyncHelperFunction = (...args: any[]) => Promise<string>;
type HelperFunction = (...args: any[]) => string;
type Helpers = Record<string, AsyncHelperFunction | HelperFunction>;

interface TemplateOptions {
  allowProtoMethodsByDefault?: boolean;
  allowProtoPropertiesByDefault?: boolean;
  noEscape?: boolean;
}

/**
 * Process a template string with async helpers using Handlebars
 * @param content Template string to process
 * @param helpers Record of helper functions to register with Handlebars
 * @param options Template compilation and runtime options
 * @returns Processed template string
 */
export async function processTemplate(
  content: string,
  helpers: Helpers,
  options: TemplateOptions = {},
): Promise<string> {
  const hb = asyncHelpers(Handlebars);

  // Register all helpers
  Object.entries(helpers).forEach(([name, helper]) => {
    hb.registerHelper(name, async function (...args) {
      // Remove the Handlebars options object from the end of args
      const helperArgs = args.slice(0, -1);
      console.log("Args", args, helperArgs);
      const result = await helper(...helperArgs);
      return new Handlebars.SafeString(result);
    });
  });

  // Create template
  const template = hb.compile(content, {
    noEscape: options.noEscape ?? true,
  });

  // Execute template with async helpers
  return template(
    {},
    {
      allowProtoMethodsByDefault: options.allowProtoMethodsByDefault ?? true,
      allowProtoPropertiesByDefault:
        options.allowProtoPropertiesByDefault ?? true,
    },
  );
}
