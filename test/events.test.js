import { describe, it, expect, vi } from 'vitest';
import { createEventEmitter, events } from '../lib/events.js';

describe('events', () => {
    it('registers and emits events', () => {
        const em = createEventEmitter();
        const fn = vi.fn();
        em.on('foo', fn);
        em.emit('foo', 1, 2);
        expect(fn).toHaveBeenCalledWith(1, 2);
    });

    it('off with no callback removes all listeners', () => {
        const em = createEventEmitter();
        const fn = vi.fn();
        em.on('foo', fn);
        em.off('foo');
        em.emit('foo');
        expect(fn).not.toHaveBeenCalled();
    });

    it('off removes a specific callback', () => {
        const em = createEventEmitter();
        const a = vi.fn();
        const b = vi.fn();
        em.on('foo', a).on('foo', b);
        em.off('foo', a);
        em.emit('foo');
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('once fires a single time', () => {
        const em = createEventEmitter();
        const fn = vi.fn();
        em.once('foo', fn);
        em.emit('foo');
        em.emit('foo');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('exposes event constants', () => {
        expect(events.REQUEST_START).toBe('request:start');
        expect(events.REQUEST_END).toBe('request:end');
    });
});