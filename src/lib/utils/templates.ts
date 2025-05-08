import nunjucks from "nunjucks";

/**
 * A filter receives the piped value as its first argument, followed by any
 * additional positional / keyword parameters, and may return either a value or
 * a `Promise` that resolves to a value.
 */
export type FilterFunction<In = unknown, Out = unknown> = (
  value: In,
  ...args: unknown[]
) => Out | Promise<Out>;

export type Filters = Record<string, FilterFunction>;

export interface TemplateOptions {
  autoescape?: boolean;
}

/**
 * Render a template string using **Nunjucks** with support for asynchronous
 * filters.
 */
export async function processTemplate(
  content: string,
  filters: Filters,
  context: Record<string, any> = {},
  options: TemplateOptions = {},
): Promise<string> {
  const env = new nunjucks.Environment(null, {
    autoescape: options.autoescape ?? false,
    throwOnUndefined: false,
  });

  // Register each filter as an async-aware Nunjucks filter.
  Object.entries(filters).forEach(([name, filterFn]) => {
    env.addFilter(
      name,
      (...rawArgs: unknown[]) => {
        // Nunjucks appends the async callback as the **last** argument.
        const done = rawArgs.pop() as (err: unknown, result?: unknown) => void;

        const [value, ...positional] = rawArgs as [unknown, ...unknown[]];

        Promise.resolve(filterFn(value, ...positional))
          .then((result) => done(null, result))
          .catch((err) => done(err));
      },
      /* async */ true,
    );
  });

  return new Promise<string>((resolve, reject) => {
    env.renderString(content, context, (err, res) => {
      if (err) return reject(err);
      resolve(res as string);
    });
  });
}
