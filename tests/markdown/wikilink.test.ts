import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkObsidian from '$lib/markdown/remark.ts';

describe('Wikilink parsing', () => {
  const createProcessor = () => {
    return unified()
      .use(remarkParse)
      .use(remarkObsidian);
  };

  const hasLink = (ast: any) => JSON.stringify(ast).includes('"type":"link"');
  const hasUrl = (ast: any, url: string) => JSON.stringify(ast).includes(`"url":"${url}"`);
  const hasText = (ast: any, text: string) => JSON.stringify(ast).includes(`"value":"${text}"`);

  describe('Basic wikilink syntax', () => {
    it('should parse basic page links', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page')).toBe(true);
    });

    it('should parse pages with spaces', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page With Spaces]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page With Spaces')).toBe(true);
    });

    it('should parse heading links', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page#heading]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page#heading')).toBe(true);
    });

    it('should parse block references', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page#^block-id]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page#^block-id')).toBe(true);
    });

  });

  describe('Display text (titles) with pipe character', () => {
    it('should parse basic display text', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page|Display Text]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page')).toBe(true);
      expect(hasText(ast, 'Display Text')).toBe(true);
    });

    it('should parse display text with numbers', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page|Chapter 1]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page')).toBe(true);
      expect(hasText(ast, 'Chapter 1')).toBe(true);
    });

    it('should parse display text with parentheses', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page|Display (with parentheses)]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page')).toBe(true);
      expect(hasText(ast, 'Display (with parentheses)')).toBe(true);
    });

    it('should parse display text with special characters', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page|Display: & More?]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page')).toBe(true);
      expect(hasText(ast, 'Display: & More?')).toBe(true);
    });

    it('should parse heading links with display text', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page#heading|Custom Title]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page#heading')).toBe(true);
      expect(hasText(ast, 'Custom Title')).toBe(true);
    });

    it('should parse block references with display text', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page#^block|See this block]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page#^block')).toBe(true);
      expect(hasText(ast, 'See this block')).toBe(true);
    });

    it('should parse file paths with display text', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[folder/Page|Short Name]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'folder/Page')).toBe(true);
      expect(hasText(ast, 'Short Name')).toBe(true);
    });

    it('should handle empty display text', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page|]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page')).toBe(true);
      // Empty display text should not create a text node
    });
  });

  describe('Character support', () => {
    it('should handle underscores in block IDs', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page#^block_id]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page#^block_id')).toBe(true);
    });

    it('should handle mixed characters in block IDs', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('[[Page#^block-with_underscore]]'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page#^block-with_underscore')).toBe(true);
    });
  });

  describe('Formatting interaction', () => {
    it('should parse wikilinks in bold text', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('**[[Page]]**'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page')).toBe(true);
    });

    it('should parse wikilinks in italic text', () => {
      const processor = createProcessor();
      const ast = processor.runSync(processor.parse('*[[Page]]*'));
      
      expect(hasLink(ast)).toBe(true);
      expect(hasUrl(ast, 'Page')).toBe(true);
    });
  });
});
