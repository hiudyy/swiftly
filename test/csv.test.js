import { describe, it, expect } from 'vitest';
import { parseCSV, toCSV } from '../lib/csv.js';

const SAMPLE = `name,age,city
Ana,30,Lisbon
Bob,25,"Porto, PT"
"Carla ""C""",28,"New
York"`;

describe('csv', () => {
    it('parses headers, quotes, embedded delimiters and newlines', () => {
        const rows = parseCSV(SAMPLE);
        expect(rows.length).toBe(3);
        expect(rows[0]).toEqual({ name: 'Ana', age: '30', city: 'Lisbon' });
        expect(rows[1].city).toBe('Porto, PT');
        expect(rows[2].name).toBe('Carla "C"');
        expect(rows[2].city).toBe('New\nYork');
    });

    it('header:false returns arrays', () => {
        const rows = parseCSV('a,b\n1,2', { header: false });
        expect(rows).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('custom delimiter', () => {
        const rows = parseCSV('a;b\n1;2', { delimiter: ';' });
        expect(rows[0]).toEqual({ a: '1', b: '2' });
    });

    it('skips empty lines', () => {
        const rows = parseCSV('a,b\n\n\n1,2\n', { header: true });
        expect(rows.length).toBe(1);
    });

    it('toCSV escapes values and round-trips', () => {
        const csv = toCSV([{ name: 'Ana', city: 'Porto, PT' }, { name: 'Carla', city: 'New\nYork' }]);
        const parsed = parseCSV(csv);
        expect(parsed[0].city).toBe('Porto, PT');
        expect(parsed[1].city).toBe('New\nYork');
    });

    it('toCSV without header / array rows', () => {
        expect(toCSV([['a', 'b'], ['1', '2']], { header: false })).toBe('a,b\r\n1,2');
    });
});