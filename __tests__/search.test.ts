import {
  getSearchTermsFromQuery,
  getWheresFromOptions,
} from '@/photo/db';

describe('Search', () => {
  describe('terms', () => {
    it('splits on whitespace and lowercases', () => {
      expect(getSearchTermsFromQuery('  Tokyo   Night '))
        .toStrictEqual(['tokyo', 'night']);
    });
    it('removes duplicates', () => {
      expect(getSearchTermsFromQuery('red RED car'))
        .toStrictEqual(['red', 'car']);
    });
    it('caps the number of terms', () => {
      expect(getSearchTermsFromQuery('a b c d e f g h i j'))
        .toHaveLength(8);
    });
  });
  describe('wheres', () => {
    it('requires every term, in any order', () => {
      const { wheres, wheresValues } =
        getWheresFromOptions({ query: 'night tokyo' });
      expect(wheres.match(/ILIKE/g)).toHaveLength(2);
      expect(wheresValues).toStrictEqual(['%night%', '%tokyo%']);
    });
    it('searches tags and location', () => {
      const { wheres } = getWheresFromOptions({ query: 'tokyo' });
      expect(wheres).toContain('ARRAY_TO_STRING(tags');
      expect(wheres).toContain('location_name');
    });
    it('escapes LIKE wildcards', () => {
      const { wheresValues } = getWheresFromOptions({ query: '100% f_2' });
      expect(wheresValues).toStrictEqual(['%100\\%%', '%f\\_2%']);
    });
    it('numbers values after other filters', () => {
      const { wheres, wheresValues } = getWheresFromOptions({
        query: 'street',
        tag: 'tokyo',
      });
      expect(wheres).toContain('ILIKE $1');
      expect(wheres).toContain('$2=ANY(tags)');
      expect(wheresValues).toStrictEqual(['%street%', 'tokyo']);
    });
  });
});
