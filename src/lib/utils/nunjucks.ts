import nunjucks from "nunjucks";

function extractTemplateSnippet(
  template: string,
  lineno: number,
  colno: number,
): string {
  const lines = template.split("\n");
  if (lineno < 1 || lineno > lines.length) return "";

  const line = lines[lineno - 1]; // lineno is 1-based
  if (colno < 1 || colno > line.length) return line;

  // Find the start of the expression (look backwards for {{)
  let start = colno - 1;
  while (start > 0 && line.substring(start - 2, start) !== "{{") {
    start--;
  }
  if (start > 0) start -= 2; // Include the {{

  // Find the end of the expression (look forward for }})
  let end = colno - 1;
  while (end < line.length - 1 && line.substring(end, end + 2) !== "}}") {
    end++;
  }
  if (end < line.length - 1) end += 2; // Include the }}

  // Extract the snippet with some context
  const contextStart = Math.max(0, start - 10);
  const contextEnd = Math.min(line.length, end + 10);

  let snippet = line.substring(contextStart, contextEnd);
  if (contextStart > 0) snippet = "..." + snippet;
  if (contextEnd < line.length) snippet = snippet + "...";

  return snippet;
}

export function enhanceNunjucksError(err: any, template: string): Error {
  if (err && typeof err.lineno === "number" && typeof err.colno === "number") {
    const snippet = extractTemplateSnippet(template, err.lineno, err.colno);
    if (snippet) {
      const originalMessage = err.message;
      err.message = `${originalMessage}: ${snippet}`;
    }
  }
  return err;
}

export function renderStringAsync(
  str: string,
  data: Record<string, any>,
  options: {
    autoescape?: boolean;
    throwOnUndefined?: boolean;
    templateName?: string;
  } = {},
) {
  const env = new nunjucks.Environment(null, {
    autoescape: options.autoescape ?? false,
    throwOnUndefined: options.throwOnUndefined ?? true,
  });

  return new Promise<string>((resolve, reject) => {
    const template = nunjucks.compile(str, env);
    template.render(data, (err, result) => {
      if (err) {
        // If we have a template name, replace "(unknown path)" with the template name
        if (
          options.templateName &&
          err.message &&
          err.message.includes("(unknown path)")
        ) {
          err.message = err.message.replace(
            "(unknown path)",
            `(${options.templateName})`,
          );
        }
        reject(enhanceNunjucksError(err, str));
      } else {
        resolve(result);
      }
    });
  });
}

export function hasVariable(template, varName) {
  // Use word boundary \b to match the exact variable name
  const pattern = new RegExp(`\\{\\{\\s*${varName}\\b`);
  return pattern.test(template);
}
