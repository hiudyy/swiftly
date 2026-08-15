import { describe, it, expect } from 'vitest';
import {
    SwiftlyError,
    ValidationError,
    RequestError,
    ResponseError,
    CircuitBreakerError,
    TimeoutError,
    AbortError
} from '../lib/errors.js';

describe('errors', () => {
    it('SwiftlyError carries code and context', () => {
        const e = new SwiftlyError('msg', 'CODE', { a: 1 });
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(SwiftlyError);
        expect(e.name).toBe('SwiftlyError');
        expect(e.code).toBe('CODE');
        expect(e.context).toEqual({ a: 1 });
        expect(e.message).toBe('msg');
    });
    it('ValidationError', () => {
        const e = new ValidationError('bad');
        expect(e).toBeInstanceOf(SwiftlyError);
        expect(e.name).toBe('ValidationError');
        expect(e.code).toBe('VALIDATION_ERROR');
    });
    it('RequestError', () => {
        const e = new RequestError('req');
        expect(e.name).toBe('RequestError');
        expect(e.code).toBe('REQUEST_ERROR');
    });
    it('ResponseError carries response', () => {
        const resp = { status: 500 };
        const e = new ResponseError('resp', resp);
        expect(e.name).toBe('ResponseError');
        expect(e.code).toBe('RESPONSE_ERROR');
        expect(e.response).toBe(resp);
        expect(e.context.response).toBe(resp);
    });
    it('CircuitBreakerError carries domain', () => {
        const e = new CircuitBreakerError('open', 'example.com');
        expect(e.name).toBe('CircuitBreakerError');
        expect(e.code).toBe('CIRCUIT_BREAKER_ERROR');
        expect(e.domain).toBe('example.com');
        expect(e.context.domain).toBe('example.com');
    });
    it('TimeoutError carries type', () => {
        const e = new TimeoutError('timeout', 'response');
        expect(e.name).toBe('TimeoutError');
        expect(e.code).toBe('TIMEOUT_ERROR');
        expect(e.type).toBe('response');
        expect(e.context.type).toBe('response');
    });
    it('AbortError', () => {
        const e = new AbortError();
        expect(e.name).toBe('AbortError');
        expect(e.code).toBe('ABORT_ERROR');
    });
});
