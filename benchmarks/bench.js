// HTTP client performance benchmark against a local server.
// Run with: npm run bench
import http from 'node:http';
import { Agent as HttpAgent } from 'node:http';
import { performance } from 'node:perf_hooks';
import swiftly from '../index.mjs';

let axios;
let got;
try { axios = (await import('axios')).default; } catch {}
try { got = (await import('got')).default; } catch {}

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: 'x'.repeat(64) }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const agent = new HttpAgent({ keepAlive: true, maxSockets: 32 });

const N = 500;
const CONCURRENCY = 25;
const ROUNDS = 3;

const rawFn = () => new Promise((resolve, reject) => {
    http.get(base + '/', { agent }, (res) => {
        res.resume();
        res.on('end', resolve);
    }).on('error', reject);
});
const swiftlyFn = () => swiftly.get(base + '/', { cache: { enabled: false }, deduplicate: false });
const axiosFn = () => axios ? axios.get(base + '/', { httpAgent: agent }) : null;
const gotFn = () => got ? got(base + '/') : null;

const clients = [
    { name: 'swiftly', fn: swiftlyFn },
    { name: 'raw http', fn: rawFn },
    axios ? { name: 'axios', fn: axiosFn } : null,
    got ? { name: 'got', fn: gotFn } : null
].filter(Boolean);

async function runOne(fn) {
    const start = performance.now();
    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) {
        workers.push((async () => {
            for (let i = 0; i < N / CONCURRENCY; i++) await fn();
        })());
    }
    await Promise.all(workers);
    return performance.now() - start;
}

// Best time per client across interleaved rounds (fair warm-up).
const best = {};
for (let round = 0; round < ROUNDS; round++) {
    for (const c of clients) {
        const t = await runOne(c.fn);
        if (!(c.name in best) || t < best[c.name]) best[c.name] = t;
    }
}

await new Promise((r) => server.close(r));

console.log('\n=== HTTP client benchmark ===');
console.log(`Concurrency: ${CONCURRENCY} | Requests/round: ${N} | Best of ${ROUNDS} rounds\n`);
console.log('┌──────────┬───────────┬───────────┐');
console.log('│ client   │  req/s    │  ms/req   │');
console.log('├──────────┼───────────┼───────────┤');
const sorted = clients
    .map((c) => ({ name: c.name, ms: best[c.name], rps: N / (best[c.name] / 1000), lat: best[c.name] / N }))
    .sort((a, b) => a.ms - b.ms);
for (const r of sorted) {
    console.log(`│ ${r.name.padEnd(9)}│ ${Math.round(r.rps).toString().padStart(9)}│ ${r.lat.toFixed(3).padStart(9)}│`);
}
console.log('└──────────┴───────────┴───────────┘');
const fastest = sorted[0];
const runner = sorted[1];
if (runner) {
    console.log(`\nFastest: ${fastest.name} — ${(runner.ms / fastest.ms).toFixed(2)}x faster than ${runner.name}`);
}