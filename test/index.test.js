import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import swiftly from '../index.mjs';
import { startServer } from './helpers/server.js';

let srv;

beforeAll(async () => {
    srv = await startServer();
});

afterAll(async () => {
    await srv.close();
});

describe('swiftly main export', () => {
    it('is a factory function', () => {
        expect(typeof swiftly).toBe('function');
    });
    it('exposes the full static API', () => {
        for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'query', 'subscribe', 'scrape', 'batch', 'download', 'on', 'off', 'clearCache', 'getMetrics']) {
            expect(typeof swiftly[m]).toBe('function');
        }
    });
    it('exposes parsing/extraction utilities as statics', () => {
        for (const m of ['parseHTML', 'parseXML', 'parseXMLTree', 'xmlToString', 'parseRSS', 'parseAtom', 'parseSitemap', 'parseCSV', 'toCSV', 'queryJSON', 'extractLinks', 'extractImages', 'extractText', 'extractMeta', 'extractTables', 'extractForms', 'extractJsonLd', 'extractJSON', 'sanitizeHtml', 'htmlToMarkdown']) {
            expect(typeof swiftly[m]).toBe('function');
        }
    });
    it('exposes events and shared client accessor', () => {
        expect(swiftly.events).toBeTruthy();
        expect(typeof swiftly.client).toBe('function');
    });
    it('static calls share a singleton default client', () => {
        expect(swiftly.client()).toBe(swiftly.client());
    });
    it('creates independent instances via the factory', () => {
        const a = swiftly();
        const b = swiftly();
        expect(a).not.toBe(b);
        for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'query', 'subscribe', 'scrape', 'batch', 'download', 'on', 'off', 'clearCache', 'getMetrics']) {
            expect(typeof a[m]).toBe('function');
        }
    });
});

describe('swiftly instance methods', () => {
    it('setBaseURL / setDefaultHeaders / setDebug / getConfig', () => {
        const inst = swiftly({ debug: false });
        inst.setBaseURL(srv.url);
        expect(inst.getConfig().baseURL).toBe(srv.url);
        inst.setDefaultHeaders({ 'X-Global': '1' });
        expect(inst.getConfig().headers['X-Global']).toBe('1');
        inst.setDebug(true);
        expect(inst.getConfig().debug).toBe(true);
    });
    it('parse parses HTML locally on an instance', () => {
        const out = swiftly().parse('<ul><li>a</li><li>b</li></ul>', 'li');
        expect(out.length).toBe(2);
    });
    it('scrape fetches and parses a page', async () => {
        const els = await swiftly().scrape(`${srv.url}/html`, 'h1');
        expect(els.length).toBe(1);
        expect(els[0].content).toBe('Hi');
    });
});

describe('swiftly static network calls', () => {
    it('static get returns parsed JSON', async () => {
        const body = await swiftly.get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
});
