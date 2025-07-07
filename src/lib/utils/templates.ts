import nunjucks from "nunjucks";
import { usePlugin } from "$lib/utils/index.ts";
import { enhanceNunjucksError } from "./nunjucks.ts";

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
  throwOnUndefined?: boolean;
}

/**
 * Render a template string using **Nunjucks** with support for asynchronous
 * filters.
 */
export async function processTemplate(
  content: string,
  filters: Filters,
  context: Record<string, any> = {},
  options: TemplateOptions & { templateName?: string } = {},
): Promise<string> {
  const env = new nunjucks.Environment(null, {
    autoescape: options.autoescape ?? false,
    throwOnUndefined: options.throwOnUndefined ?? false,
    dev: true, // Enable dev mode for better error messages
  });

  // Fix the dev flag bug mentioned in nunjucks issue #516
  // The dev flag gets stored in env.opts.dev but prettifyError looks for env.dev
  if ((env as any).opts && "dev" in (env as any).opts) {
    (env as any).dev = (env as any).opts.dev;
  }

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

  // Add path function that joins arguments and adds .md extension
  env.addGlobal("path", (...args: string[]) => {
    return args.join("/") + ".md";
  });

  env.addFilter(
    "exists",
    (filePath: string, done: (err: Error | null, result?: boolean) => void) => {
      const plugin = usePlugin();
      plugin.app.vault.adapter
        .exists(filePath, true)
        .then((exists) => done(null, exists))
        .catch((err) => done(err));
    },
    /* async */ true,
  );

  env.addFilter(
    "read",
    (filePath: string, done: (err: Error | null, result?: string) => void) => {
      const plugin = usePlugin();
      plugin.app.vault.adapter
        .exists(filePath, true)
        .then((exists) => {
          if (!exists) {
            return done(new Error(`File not found: ${filePath}`));
          }

          return plugin.app.vault.adapter
            .read(filePath)
            .then((content) => done(null, content))
            .catch((err) => done(err));
        })
        .catch((err) => done(err));
    },
    /* async */ true,
  );

  // Add debug filter to log variables during template rendering
  env.addFilter("debug", (value: any) => {
    console.log("[Template Debug]", value);
    return value;
  });

  return new Promise<string>((resolve, reject) => {
    const template = nunjucks.compile(content, env);
    template.render(context, (err, res) => {
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
        return reject(enhanceNunjucksError(err, content));
      }
      resolve(res as string);
    });
  });
}
