import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses simple rows and ignores blank lines and BOM', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted commas, escaped quotes and newlines', () => {
    expect(parseCsv('"Pérez, Ana","dice ""hola""","l1\nl2"')).toEqual([
      ['Pérez, Ana', 'dice "hola"', 'l1\nl2'],
    ]);
  });

  it('keeps empty trailing cells', () => {
    expect(parseCsv('a,b,\n')).toEqual([['a', 'b', '']]);
  });
});
