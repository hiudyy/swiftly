import { describe, it, expect } from 'vitest';
import { queryJSON } from '../lib/jsonpath.js';

describe('jsonpath.queryJSON', () => {
    const data = {
        user: { name: 'Ada', address: { city: 'London' } },
        items: [
            { id: 1, price: 10 },
            { id: 2, price: 20 }
        ],
        tags: ['a', 'b', 'c']
    };

    it('dot access', () => {
        expect(queryJSON(data, 'user.name')).toBe('Ada');
        expect(queryJSON(data, 'user.address.city')).toBe('London');
    });
    it('bracket notation and indexes', () => {
        expect(queryJSON(data, 'items[0].price')).toBe(10);
        expect(queryJSON(data, 'items[1].id')).toBe(2);
    });
    it('negative indexes', () => {
        expect(queryJSON(data, 'items[-1].id')).toBe(2);
    });
    it('wildcards map over arrays', () => {
        expect(queryJSON(data, 'items[*].price')).toEqual([10, 20]);
        expect(queryJSON(data, 'items[*].id')).toEqual([1, 2]);
    });
    it('quoted bracket keys', () => {
        expect(queryJSON({ 'a b': { c: 1 } }, '["a b"].c')).toBe(1);
    });
    it('returns fallback on missing path', () => {
        expect(queryJSON(data, 'user.missing', 'def')).toBe('def');
    });
    it('returns default undefined fallback when none given', () => {
        expect(queryJSON(data, 'nope.here')).toBeUndefined();
    });
    it('returns the fallback for an empty path', () => {
        expect(queryJSON(data, '')).toBeUndefined();
        expect(queryJSON(data, '.')).toBeUndefined();
    });
    it('returns an array when multiple results match', () => {
        expect(queryJSON(data, 'tags[*]')).toEqual(['a', 'b', 'c']);
    });
    it('handles nested wildcard over objects', () => {
        const d = { a: { x: 1 }, b: { x: 2 } };
        expect(queryJSON(d, '*')).toEqual([{ x: 1 }, { x: 2 }]);
    });
    it('returns null when traversing into non-object', () => {
        expect(queryJSON(data, 'user.name.first')).toBeUndefined();
    });
    it('handles array as root', () => {
        expect(queryJSON([10, 20, 30], '[1]')).toBe(20);
    });
    it('handles top-level property that is an array', () => {
        expect(queryJSON(data, 'tags[0]')).toBe('a');
    });
    it('wildcard over object values that are arrays', () => {
        const d = { g1: [1, 2], g2: [3, 4] };
        expect(queryJSON(d, '*[*]')).toEqual([1, 2, 3, 4]);
    });
});
