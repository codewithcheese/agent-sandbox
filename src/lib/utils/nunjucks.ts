import nunjucks from "nunjucks";

export function renderStringAsync(
  str: string,
  data: Record<string, any>,
  options: { autoescape?: boolean; throwOnUndefined?: boolean } = {},
) {
  const env = new nunjucks.Environment(null, {
    autoescape: options.autoescape ?? false,
    throwOnUndefined: options.autoescape ?? true,
  });
  return new Promise<string>((resolve, reject) => {
    env.renderString(str, data, (err, result) => {
      if (err) {
        reject(err);
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
