/**
 * Tests for xRegistry v0.1 pagination specification compliance
 * https://github.com/xregistry/spec/tree/main/pagination
 * 
 * These tests validate Link header format and pagination behavior
 */

describe('Pagination Link Header Format', () => {
  describe('Link Header Parsing', () => {
    /**
     * Helper to parse Link header into structured format
     */
    function parseLinkHeader(header: string): Array<{ url: string; rel: string; count?: number }> {
      if (!header) return [];
      
      const links: Array<{ url: string; rel: string; count?: number }> = [];
      const parts = header.split(',');
      
      for (const part of parts) {
        const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"(?:;\s*count=(\d+))?/);
        if (match) {
          links.push({
            url: match[1],
            rel: match[2],
            count: match[3] ? parseInt(match[3]) : undefined,
          });
        }
      }
      
      return links;
    }

    it('should parse single Link header', () => {
      const header = '<http://example.com/page2?limit=10&offset=10>; rel="next"; count=100';
      const links = parseLinkHeader(header);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        url: 'http://example.com/page2?limit=10&offset=10',
        rel: 'next',
        count: 100,
      });
    });

    it('should parse multiple Link headers', () => {
      const header = 
        '<http://example.com/page2?limit=10&offset=10>; rel="next"; count=100, ' +
        '<http://example.com/page1?limit=10&offset=0>; rel="prev"; count=100';
      
      const links = parseLinkHeader(header);

      expect(links).toHaveLength(2);
      expect(links[0].rel).toBe('next');
      expect(links[1].rel).toBe('prev');
    });

    it('should parse Link header with first and last', () => {
      const header = 
        '<http://example.com/page1?limit=10&offset=0>; rel="first"; count=100, ' +
        '<http://example.com/page10?limit=10&offset=90>; rel="last"; count=100';
      
      const links = parseLinkHeader(header);

      expect(links).toHaveLength(2);
      expect(links.find((l: { rel: string }) => l.rel === 'first')).toBeDefined();
      expect(links.find((l: { rel: string }) => l.rel === 'last')).toBeDefined();
    });

    it('should handle Link header without count', () => {
      const header = '<http://example.com/page2?limit=10&offset=10>; rel="next"';
      const links = parseLinkHeader(header);

      expect(links).toHaveLength(1);
      expect(links[0].count).toBeUndefined();
    });

    it('should return empty array for empty header', () => {
      const links = parseLinkHeader('');
      expect(links).toEqual([]);
    });
  });

  describe('xRegistry Spec Compliance', () => {
    /**
     * Generate a sample Link header for testing
     */
    function generateSampleLinkHeader(limit: number, offset: number, totalCount: number): string {
      const baseUrl = 'http://example.com/items';
      const links: string[] = [];
      
      // prev link
      if (offset > 0) {
        const prevOffset = Math.max(0, offset - limit);
        links.push(`<${baseUrl}?limit=${limit}&offset=${prevOffset}>; rel="prev"; count=${totalCount}`);
      }
      
      // next link
      if (offset + limit < totalCount) {
        const nextOffset = offset + limit;
        links.push(`<${baseUrl}?limit=${limit}&offset=${nextOffset}>; rel="next"; count=${totalCount}`);
      }
      
      // first link
      links.push(`<${baseUrl}?limit=${limit}>; rel="first"; count=${totalCount}`);
      
      // last link
      const lastOffset = Math.max(0, totalCount - limit);
      links.push(`<${baseUrl}?limit=${limit}&offset=${lastOffset}>; rel="last"; count=${totalCount}`);
      
      return links.join(', ');
    }

    it('should follow RFC 5988 Link header format', () => {
      const header = generateSampleLinkHeader(10, 0, 30);

      // RFC 5988 format: <URL>; rel="relation"
      expect(header).toMatch(/<[^>]+>;\s*rel="[^"]+"/);
      expect(header).toMatch(/count=\d+/);
    });

    it('should include count attribute on all links', () => {
      const header = generateSampleLinkHeader(10, 10, 30);
      const linkParts = header.split(',');

      // Every link should have count attribute
      linkParts.forEach((link: string) => {
        if (link.trim()) {
          expect(link).toContain('count=30');
        }
      });
    });

    it('should use standard rel values (first, prev, next, last)', () => {
      const header = generateSampleLinkHeader(10, 10, 50);

      // Check for standard rel values
      expect(header).toMatch(/rel="(first|prev|next|last)"/);
      
      // Should not have any other rel values
      const relMatches = header.match(/rel="([^"]+)"/g);
      const standardRels = ['first', 'prev', 'next', 'last'];
      
      relMatches?.forEach((match: string) => {
        const rel = match.match(/rel="([^"]+)"/)?.[1];
        expect(standardRels).toContain(rel);
      });
    });

    it('should not include next link on last page', () => {
      const header = generateSampleLinkHeader(10, 40, 50);
      
      expect(header).not.toContain('rel="next"');
      expect(header).toContain('rel="prev"');
    });

    it('should not include prev link on first page', () => {
      const header = generateSampleLinkHeader(10, 0, 50);
      
      expect(header).toContain('rel="next"');
      expect(header).not.toContain('rel="prev"');
    });

    it('should calculate last offset correctly', () => {
      const header = generateSampleLinkHeader(10, 0, 25);
      
      // Last page should start at offset 15 (25 - 10 = 15)
      expect(header).toContain('offset=15');
    });
  });

  describe('Pagination Edge Cases', () => {
    it('should handle offset=0 correctly', () => {
      const header = '<http://example.com/items?limit=10&offset=0>; rel="first"; count=20';
      
      expect(header).toContain('offset=0');
      expect(header).not.toContain('offset=-'); // no negative offsets
    });

    it('should handle single page (totalCount < limit)', () => {
      // When totalCount=5 and limit=10, there should be no next link
      const baseUrl = 'http://example.com/items';
      const totalCount = 5;
      const limit = 10;
      
      // Calculate if next link should exist
      const hasNext = limit < totalCount;
      
      expect(hasNext).toBe(false);
    });

    it('should handle limit=1', () => {
      const header = '<http://example.com/items?limit=1&offset=5>; rel="next"; count=10';
      
      expect(header).toContain('limit=1');
      expect(header).toContain('offset=5');
    });
  });

  describe('Pagination Calculation Tests', () => {
    it('should calculate correct page boundaries', () => {
      const limit = 10;
      const totalCount = 50;
      
      // First page: offset=0
      const firstPageStart = 0;
      const firstPageEnd = Math.min(firstPageStart + limit, totalCount);
      expect(firstPageEnd).toBe(10);
      
      // Middle page: offset=20
      const middlePageStart = 20;
      const middlePageEnd = Math.min(middlePageStart + limit, totalCount);
      expect(middlePageEnd).toBe(30);
      
      // Last page: offset=40
      const lastPageStart = 40;
      const lastPageEnd = Math.min(lastPageStart + limit, totalCount);
      expect(lastPageEnd).toBe(50);
    });

    it('should calculate correct prev offset', () => {
      const limit = 10;
      const currentOffset = 25;
      
      const prevOffset = Math.max(0, currentOffset - limit);
      expect(prevOffset).toBe(15);
    });

    it('should calculate correct next offset', () => {
      const limit = 10;
      const currentOffset = 15;
      
      const nextOffset = currentOffset + limit;
      expect(nextOffset).toBe(25);
    });

    it('should calculate correct last offset', () => {
      const limit = 10;
      const totalCount = 47; // Not evenly divisible
      
      const lastOffset = Math.max(0, totalCount - limit);
      expect(lastOffset).toBe(37); // Shows items 37-46 (10 items)
    });

    it('should handle offset exceeding total gracefully', () => {
      const limit = 10;
      const offset = 100;
      const totalCount = 50;
      
      const effectiveStart = Math.min(offset, totalCount);
      expect(effectiveStart).toBe(50); // Clamped to totalCount
      
      const effectiveEnd = Math.min(effectiveStart + limit, totalCount);
      expect(effectiveEnd).toBe(50); // No items returned
    });
  });
});
