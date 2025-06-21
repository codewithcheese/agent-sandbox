import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkObsidian from '$lib/markdown/remark.ts';

describe('Wikilink parsing with bold formatting', () => {
  const createRemarkProcessor = () => {
    return unified()
      .use(remarkParse)
      .use(remarkObsidian);
  };

  const createFullProcessor = () => {
    return unified()
      .use(remarkParse)
      .use(remarkObsidian)
      .use(remarkRehype, { allowDangerousHtml: true });
  };

  it('should show AST structure for debugging', () => {
    const processor = createRemarkProcessor();
    const ast = processor.runSync(processor.parse('Here is a [[test link]] in plain text.'));
    console.log('Remark AST for plain wikilink:', JSON.stringify(ast, null, 2));
    
    const boldAst = processor.runSync(processor.parse('Here is **[[test link]]** in bold text.'));
    console.log('Remark AST for bold wikilink:', JSON.stringify(boldAst, null, 2));
  });

  it('should parse wikilinks in plain text', () => {
    const processor = createRemarkProcessor();
    const ast = processor.runSync(processor.parse('Here is a [[test link]] in plain text.'));
    
    // Check if the remark AST contains a link node
    const hasLink = JSON.stringify(ast).includes('"type":"link"');
    expect(hasLink).toBe(true);
  });

  it('should parse wikilinks surrounded by bold formatting', () => {
    const processor = createRemarkProcessor();
    const ast = processor.runSync(processor.parse('Here is **[[test link]]** in bold text.'));
    
    // Wikilinks inside bold formatting should be parsed as links
    const hasLink = JSON.stringify(ast).includes('"type":"link"');
    expect(hasLink).toBe(true);
  });

  it('should parse wikilinks with custom text in bold formatting', () => {
    const processor = createRemarkProcessor();
    const ast = processor.runSync(processor.parse('Here is **[[test link|Custom Text]]** in bold.'));
    
    const hasLink = JSON.stringify(ast).includes('"type":"link"');
    const hasCustomText = JSON.stringify(ast).includes('"value":"Custom Text"');
    expect(hasLink).toBe(true);
    expect(hasCustomText).toBe(true);
  });

  it('should parse multiple wikilinks in bold formatting', () => {
    const processor = createRemarkProcessor();
    const ast = processor.runSync(processor.parse('**[[link1]]** and **[[link2]]** both in bold.'));
    
    const astString = JSON.stringify(ast);
    const linkCount = (astString.match(/"type":"link"/g) || []).length;
    expect(linkCount).toBe(2);
  });

  it('should handle mixed bold and plain wikilinks', () => {
    const processor = createRemarkProcessor();
    const ast = processor.runSync(processor.parse('Plain [[link1]] and **[[link2]]** mixed.'));
    
    const astString = JSON.stringify(ast);
    const linkCount = (astString.match(/"type":"link"/g) || []).length;
    expect(linkCount).toBe(2);
  });

  it('should handle nested formatting with wikilinks', () => {
    const processor = createRemarkProcessor();
    const ast = processor.runSync(processor.parse('***[[nested link]]*** with triple emphasis.'));
    
    const hasLink = JSON.stringify(ast).includes('"type":"link"');
    expect(hasLink).toBe(true);
  });

  it('should handle wikilinks in italic text', () => {
    const processor = createRemarkProcessor();
    const ast = processor.runSync(processor.parse('Here is *[[italic link]]* in italic.'));
    
    const hasLink = JSON.stringify(ast).includes('"type":"link"');
    expect(hasLink).toBe(true);
  });
});
