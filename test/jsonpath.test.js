import { describe, it, expect } from 'vitest';
import { queryJSON } from '../lib/jsonpath.js';

const DATA = {
    user: { name: 'Ana', age: 30, address: { city: 'Lisbon' } },
    items: [
        { id: 1, name: 'One', price: 10 },
        { id: 2, name: 'Two', price: 20 }
    ],
    tags: ['a', 'b', 'c']
};

describe('jsonpath', () => {
    it('dot access', () => {
        expect(queryJSON(DATA, 'user.name')).toBe('Ana');
        expect(queryJSON(DATA, 'user.address.city')).toBe('Lisbon');
    });

    it('bracket notation and indexes', () => {
        expect(queryJSON(DATA, 'items[0].name')).toBe('One');
        expect(queryJSON(DATA, 'items[1].price')).toBe(20);
        expect(queryJSON(DATA, 'tags[-1]')).toBe('c');
    });

    it('wildcards map over arrays', () => {
        expect(queryJSON(DATA, 'items[*].name')).toEqual(['One', 'Two']);
        expect(queryJSON(DATA, 'tags[*]')).toEqual(['a', 'b', 'c']);
    });

    it('quoted bracket keys', () => {
        const weird = { 'key-with-dash': { value: 42 } };
        expect(queryJSON(weird, "['key-with-dash'].value")).toBe(42);
    });

    it('returns fallback on missing path', () => {
        expect(queryJSON(DATA, 'user.missing', 'none')).toBe('none');
        expect(queryJSON(DATA, 'items[*].missing', null)).toBe(null);
    });
});