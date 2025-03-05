import type { TemplateDelegate } from 'handlebars';

type HandlebarsStatic = typeof import('handlebars');

declare module 'handlebars-async-helpers' {
  /**
   * Creates an async-enabled version of Handlebars that can handle Promise-based helpers
   * @param hbs The Handlebars instance to enhance with async capabilities
   * @returns A new Handlebars instance with async support
   */
  export default function asyncHelpers(hbs: HandlebarsStatic): HandlebarsStatic & {
    /**
     * The version of handlebars-async-helpers
     */
    ASYNC_VERSION: string;
    
    /**
     * Compiles the template with async support
     */
    compile(
      template: string,
      options?: CompileOptions
    ): (context?: any, options?: RuntimeOptions) => Promise<string>;
    
    /**
     * Creates a new template with async support
     */
    template(
      precompiled: TemplateSpecification,
      options?: RuntimeOptions
    ): (context?: any, options?: RuntimeOptions) => Promise<string>;
  };
}

interface CompileOptions {
  data?: boolean;
  compat?: boolean;
  knownHelpers?: {
    [name: string]: boolean;
  };
  knownHelpersOnly?: boolean;
  noEscape?: boolean;
  strict?: boolean;
  assumeObjects?: boolean;
  preventIndent?: boolean;
  ignoreStandalone?: boolean;
  explicitPartialContext?: boolean;
}

interface RuntimeOptions {
  partial?: boolean;
  depths?: any[];
  helpers?: { [name: string]: Function };
  partials?: { [name: string]: TemplateDelegate };
  decorators?: { [name: string]: Function };
  data?: any;
  blockParams?: any[];
  allowCallsToHelperMissing?: boolean;
  allowProtoMethodsByDefault?: boolean;
  allowProtoPropertiesByDefault?: boolean;
}

interface TemplateSpecification {
  main: Function;
  main_d?: Function;
  compiler?: any;
  useData?: boolean;
  useDepths?: boolean;
  usePartial?: boolean;
  useDecorators?: boolean;
  useBlockParams?: boolean;
}
