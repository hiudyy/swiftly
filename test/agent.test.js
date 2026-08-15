import { describe, it, expect } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { getAgent, destroyAgents } from '../lib/agent.js';

describe('agent', () => {
    it('returns an http.Agent for http protocol', () => {
        const pool = new Map();
        const a = getAgent('http:', 'localhost:80', {}, pool);
        expect(a).toBeInstanceOf(http.Agent);
    });
    it('returns an https.Agent for https protocol', () => {
        const pool = new Map();
        const a = getAgent('https:', 'localhost:443', {}, pool);
        expect(a).toBeInstanceOf(https.Agent);
    });
    it('caches agents per protocol+hostKey+config', () => {
        const pool = new Map();
        const a1 = getAgent('http:', 'localhost:80', { keepAlive: true }, pool);
        const a2 = getAgent('http:', 'localhost:80', { keepAlive: true }, pool);
        expect(a1).toBe(a2);
        expect(pool.size).toBe(1);
    });
    it('creates distinct agents for different configs', () => {
        const pool = new Map();
        const a1 = getAgent('http:', 'localhost:80', { maxSockets: 10 }, pool);
        const a2 = getAgent('http:', 'localhost:80', { maxSockets: 20 }, pool);
        expect(a1).not.toBe(a2);
    });
    it('prefers a custom config.agent as-is (never pooled)', () => {
        const pool = new Map();
        const custom = new http.Agent();
        const a = getAgent('http:', 'localhost:80', { agent: custom }, pool);
        expect(a).toBe(custom);
        expect(pool.size).toBe(0);
    });
    it('respects keepAlive:false', () => {
        const pool = new Map();
        const a = getAgent('http:', 'localhost:80', { keepAlive: false }, pool);
        expect(a.keepAlive).toBe(false);
    });
    it('applies maxSockets and maxFreeSockets', () => {
        const pool = new Map();
        const a = getAgent('http:', 'localhost:80', { maxSockets: 5, maxFreeSockets: 2 }, pool);
        expect(a.maxSockets).toBe(5);
        expect(a.maxFreeSockets).toBe(2);
    });
    it('destroyAgents destroys and clears the pool', () => {
        const pool = new Map();
        const a = getAgent('http:', 'localhost:80', {}, pool);
        expect(typeof a.destroy).toBe('function');
        destroyAgents(pool);
        expect(pool.size).toBe(0);
    });
    it('destroyAgents tolerates already-destroyed agents', () => {
        const pool = new Map();
        const a = getAgent('http:', 'localhost:80', {}, pool);
        a.destroy();
        expect(() => destroyAgents(pool)).not.toThrow();
    });
});
