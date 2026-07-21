import { describe, expect, it } from 'vitest';
import { parseCatalogCsv, parseCsv, normalizeCode } from '../../integrations/catalog/csv-import';

const HEADER = 'Product Code,Barcode,Product Name,Price,Website URL,Image URL,Arabic Keywords,Needs Size/Color,English Keywords,Variant Requirement,Search Text';

describe('parseCsv', () => {
  it('handles quoted fields with commas and embedded quotes', () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\n1,2,3');
    expect(rows[0]).toEqual(['a', 'b,c', 'say "hi"']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });
});

describe('normalizeCode', () => {
  it('strips leading zeros to canonical identity', () => {
    expect(normalizeCode('000000010001821004')).toBe('10001821004');
    expect(normalizeCode('10001821004')).toBe('10001821004');
    expect(normalizeCode('0')).toBe('0');
  });
});

describe('parseCatalogCsv', () => {
  it('preserves every catalog signal including size/color and variant requirements', () => {
    const csv = [
      HEADER,
      '00010001821004,8680583033676,RANFORCE DUVET SET,250.5,https://x.example/p,img,"مفرش, طقم",Yes,"duvet, set",size+color,search words',
    ].join('\n');
    const { rows, problems } = parseCatalogCsv(csv);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.product_code).toBe('10001821004');
    expect(r.barcode).toBe('8680583033676');
    expect(r.price).toBe(250.5);
    expect(r.arabic_keywords).toEqual(['مفرش', 'طقم']);
    expect(r.english_keywords).toEqual(['duvet', 'set']);
    expect(r.needs_size_color).toBe('Yes');
    expect(r.variant_requirement).toBe('size+color');
    expect(r.search_text).toBe('search words');
  });

  it('rejects duplicate codes (first wins) and reports them', () => {
    const csv = [HEADER, 'A1,,First,10,,,,,,,', 'A1,,Second,20,,,,,,,'].join('\n');
    const { rows, problems } = parseCatalogCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].product_name).toBe('First');
    expect(problems.some((p) => p.includes('duplicate'))).toBe(true);
  });

  it('treats zero/invalid prices as missing, never as a real price', () => {
    const csv = [HEADER, 'B1,,Thing,0,,,,,,,', 'B2,,Thing2,abc,,,,,,,'].join('\n');
    const { rows } = parseCatalogCsv(csv);
    expect(rows[0].price).toBeNull();
    expect(rows[1].price).toBeNull();
  });
});
