import { describe, it, expect } from 'vitest';
import { parseCSV, toCSV } from '../lib/csv.js';

describe('csv.parseCSV', () => {
    it('parses headers, quotes, embedded delimiters and newlines', () => {
        const text = 'name,age,city\n"Doe, John",30,"New\nYork"';
        expect(parseCSV(text)).toEqual([{ name: 'Doe, John', age: '30', city: 'New\nYork' }]);
    });
    it('header:false returns arrays', () => {
        expect(parseCSV('a,b\n1,2', { header: false })).toEqual([['a', 'b'], ['1', '2']]);
    });
    it('supports a custom delimiter', () => {
        expect(parseCSV('a;b\n1;2', { delimiter: ';' })).toEqual([{ a: '1', b: '2' }]);
    });
    it('skips empty lines by default', () => {
        const text = 'a,b\n1,2\n\n3,4\n';
        expect(parseCSV(text)).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
    });
    it('keeps empty lines when skipEmptyLines is false', () => {
        const text = 'a,b\n1,2\n\n3,4';
        const rows = parseCSV(text, { skipEmptyLines: false });
        expect(rows.length).toBe(3);
        expect(rows[1]).toEqual({ a: '', b: null });
    });
    it('handles escaped quotes inside quoted fields', () => {
        expect(parseCSV('a\n"he said ""hi"""')).toEqual([{ a: 'he said "hi"' }]);
    });
    it('handles CRLF line endings', () => {
        expect(parseCSV('a,b\r\n1,2')).toEqual([{ a: '1', b: '2' }]);
    });
    it('returns empty array for empty input', () => {
        expect(parseCSV('')).toEqual([]);
        expect(parseCSV('   ')).toEqual([]);
    });
    it('accepts a Buffer', () => {
        expect(parseCSV(Buffer.from('a,b\n1,2'))).toEqual([{ a: '1', b: '2' }]);
    });
    it('trims header names', () => {
        expect(parseCSV('  name  ,  age \n1,2')).toEqual([{ name: '1', age: '2' }]);
    });
    it('uses null for missing trailing columns', () => {
        expect(parseCSV('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: null }]);
    });
    it('handles a single column', () => {
        expect(parseCSV('x\n1\n2')).toEqual([{ x: '1' }, { x: '2' }]);
    });
    it('handles a single unquoted field as a header-only row', () => {
        expect(parseCSV('hello')).toEqual([]);
        expect(parseCSV('hello', { header: false })).toEqual([['hello']]);
    });
});

describe('csv.toCSV', () => {
    it('serializes objects with a header row', () => {
        expect(toCSV([{ a: 1, b: 2 }])).toBe('a,b\r\n1,2');
    });
    it('serializes multiple object rows', () => {
        expect(toCSV([{ a: 1 }, { a: 2 }])).toBe('a\r\n1\r\n2');
    });
    it('escapes values containing delimiter/quotes/newlines', () => {
        expect(toCSV([{ a: 'x,y', b: 'he said "hi"' }])).toBe('a,b\r\n"x,y","he said ""hi"""');
    });
    it('serializes array rows', () => {
        expect(toCSV([['a', 'b'], ['1', '2']], { header: false })).toBe('a,b\r\n1,2');
    });
    it('serializes arrays with header keys from first row', () => {
        expect(toCSV([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2');
    });
    it('supports a custom delimiter', () => {
        expect(toCSV([{ a: 1, b: 2 }], { delimiter: ';' })).toBe('a;b\r\n1;2');
    });
    it('returns empty string for empty input', () => {
        expect(toCSV([])).toBe('');
        expect(toCSV(null)).toBe('');
    });
    it('omits header when header:false with objects', () => {
        expect(toCSV([{ a: 1, b: 2 }], { header: false })).toBe('1,2');
    });
    it('round-trips parsed data', () => {
        const data = [{ name: 'A', age: '1' }, { name: 'B', age: '2' }];
        expect(parseCSV(toCSV(data))).toEqual(data);
    });
    it('escapes fields containing newlines', () => {
        expect(toCSV([{ a: 'line1\nline2' }])).toBe('a\r\n"line1\nline2"');
    });
});
