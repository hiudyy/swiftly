import { describe, it, expect, vi } from 'vitest';
import { createEventEmitter, events } from '../lib/events.js';

describe('events.EventEmitter', () => {
    it('registers and emits events', () => {
        const em = createEventEmitter();
        const spy = vi.fn();
        em.on('foo', spy);
        em.emit('foo', 1, 2);
        expect(spy).toHaveBeenCalledWith(1, 2);
    });
    it('returns this from on (chainable)', () => {
        const em = createEventEmitter();
        expect(em.on('a', () => {})).toBe(em);
    });
    it('off with no callback removes all listeners', () => {
        const em = createEventEmitter();
        const spy = vi.fn();
        em.on('foo', spy);
        em.off('foo');
        em.emit('foo');
        expect(spy).not.toHaveBeenCalled();
    });
    it('off removes a specific callback', () => {
        const em = createEventEmitter();
        const a = vi.fn();
        const b = vi.fn();
        em.on('foo', a);
        em.on('foo', b);
        em.off('foo', a);
        em.emit('foo');
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });
    it('once fires a single time', () => {
        const em = createEventEmitter();
        const spy = vi.fn();
        em.once('foo', spy);
        em.emit('foo');
        em.emit('foo');
        expect(spy).toHaveBeenCalledTimes(1);
    });
    it('hasListeners reflects state', () => {
        const em = createEventEmitter();
        expect(em.hasListeners('foo')).toBe(false);
        em.on('foo', () => {});
        expect(em.hasListeners('foo')).toBe(true);
        em.off('foo');
        expect(em.hasListeners('foo')).toBe(false);
    });
    it('emit returns false when no listeners', () => {
        const em = createEventEmitter();
        expect(em.emit('nope')).toBe(false);
    });
    it('emit returns true when all handlers succeed', () => {
        const em = createEventEmitter();
        em.on('x', () => {});
        expect(em.emit('x')).toBe(true);
    });
    it('emit returns false when a handler throws and emits error', () => {
        const em = createEventEmitter();
        const errSpy = vi.fn();
        em.on('error', errSpy);
        em.on('x', () => { throw new Error('boom'); });
        expect(em.emit('x')).toBe(false);
        expect(errSpy).toHaveBeenCalled();
    });
    it('does not recurse infinitely on error during error handler', () => {
        const em = createEventEmitter();
        em.on('x', () => { throw new Error('boom'); });
        em.on('error', () => { throw new Error('nested'); });
        expect(() => em.emit('x')).not.toThrow();
    });
    it('supports multiple listeners', () => {
        const em = createEventEmitter();
        const a = vi.fn();
        const b = vi.fn();
        em.on('x', a);
        em.on('x', b);
        em.emit('x', 5);
        expect(a).toHaveBeenCalledWith(5);
        expect(b).toHaveBeenCalledWith(5);
    });
});

describe('events constants', () => {
    it('exposes event name constants', () => {
        expect(events.REQUEST_START).toBe('request:start');
        expect(events.REQUEST_END).toBe('request:end');
        expect(events.REQUEST_ERROR).toBe('request:error');
        expect(events.RETRY_ATTEMPT).toBe('retry:attempt');
        expect(events.CACHE_HIT).toBe('cache:hit');
        expect(events.CACHE_MISS).toBe('cache:miss');
        expect(events.RATE_LIMIT).toBe('rate:limit');
        expect(events.REDIRECT).toBe('redirect');
        expect(events.CIRCUIT_OPEN).toBe('circuit:open');
        expect(events.CIRCUIT_CLOSE).toBe('circuit:close');
        expect(events.ABORT).toBe('abort');
    });
});
