// Swiftly — comprehensive isolated benchmark lab.
//
// Every measurement runs in its OWN child process (dedicated worker), so no
// library's GC/CPU activity leaks into another's numbers. The HTTP server also
// runs in a dedicated child process. Result: latency + throughput + CPU +
// memory + GC metrics per (scenario × client), at N from 1 to 1,000,000.
//
//   npm run bench           default deep run (isolated, up to 100K requests)
//   npm run bench:deep      adds the 1M tier + concurrency sweep
//   npm run bench:quick     lightweight in-process smoke (ISOLATE=0)
//
// TOTAL CONTROL (environment variables):
//   SWIFTLY_BENCH_N            base requests per scenario            (default 400)
//   SWIFTLY_BENCH_C            concurrency (workers)                 (default 25)
//   SWIFTLY_BENCH_ROUNDS       best-of rounds                        (default 3)
//   SWIFTLY_BENCH_WARMUP       warmup requests (discarded)           (default 40)
//   SWIFTLY_BENCH_LATENCY      server latency ms for Phase A         (default 0)
//   SWIFTLY_BENCH_SCENARIOS    comma list, e.g. "1,3,15" or "all"
//   SWIFTLY_BENCH_HOST         external base URL (skips local server)
//   SWIFTLY_BENCH_UNDICI       "0" disables the swiftly-on-undici rows
//   SWIFTLY_BENCH_PROFILE      "0" skips the library profile section
//   SWIFTLY_BENCH_ISOLATE      "0" = in-process quick mode (limited metrics)
//   SWIFTLY_BENCH_GC           "0" disables --expose-gc / --trace-gc
//   SWIFTLY_BENCH_SCALE        N sweep: "1,10,100,1e3,1e4,1e5" (1e6 via DEEP)
//   SWIFTLY_BENCH_1M           "1" adds the 1,000,000 tier
//   SWIFTLY_BENCH_LATENCIES    server latency tiers: "0,1,10,50,100"
//   SWIFTLY_BENCH_CONCURRENCIES C sweep (DEEP only): "1,8,25,100,250"
//   SWIFTLY_BENCH_STRESS_N     sustained memory/GC stress requests   (default 50000)
//   SWIFTLY_BENCH_DEEP         "1" enables 1M + concurrency sweep
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getJob, resolveSpec } from './ops.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const SERVER_FILE = fileURLToPath(new URL('./server.js', import.meta.url));
const WORKER_FILE = fileURLToPath(new URL('./worker.js', import.meta.url));

// ---------------------------------------------------------------------------
// Configuration & environment overrides
// ---------------------------------------------------------------------------
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const list = (v, def) => String((v == null || String(v).trim() === '') ? def : v).split(',').map(s => s.trim()).filter(Boolean);
const toN = (s) => { const f = parseFloat(s); return Number.isFinite(f) ? Math.round(f) : null; };

const CFG = {
    N: num(process.env.SWIFTLY_BENCH_N, 400),
    C: num(process.env.SWIFTLY_BENCH_C, 25),
    rounds: num(process.env.SWIFTLY_BENCH_ROUNDS, 3),
    warmup: num(process.env.SWIFTLY_BENCH_WARMUP, 40),
    latency: num(process.env.SWIFTLY_BENCH_LATENCY, 0),
    scenarios: (process.env.SWIFTLY_BENCH_SCENARIOS || 'all').trim(),
    host: (process.env.SWIFTLY_BENCH_HOST || '').trim(),
    undici: (process.env.SWIFTLY_BENCH_UNDICI ?? '1').trim() !== '0',
    profile: (process.env.SWIFTLY_BENCH_PROFILE ?? '1').trim() !== '0',
    isolate: (process.env.SWIFTLY_BENCH_ISOLATE ?? '1').trim() !== '0',
    gc: (process.env.SWIFTLY_BENCH_GC ?? '1').trim() !== '0',
    deep: (process.env.SWIFTLY_BENCH_DEEP ?? '0').trim() === '1',
    oneM: (process.env.SWIFTLY_BENCH_1M ?? '0').trim() === '1',
    stressN: num(process.env.SWIFTLY_BENCH_STRESS_N, 50000),
    scale: list(process.env.SWIFTLY_BENCH_SCALE, '1,10,100,1e3,1e4,1e5').map(toN).filter(n => n != null),
    latencies: list(process.env.SWIFTLY_BENCH_LATENCIES, '0,1,10,50,100').map(toN).filter(n => n != null),
    concurrencies: list(process.env.SWIFTLY_BENCH_CONCURRENCIES, '1,8,25,100,250').map(toN).filter(n => n != null)
};
if (CFG.deep || CFG.oneM) {
    if (!CFG.scale.includes(1e6)) CFG.scale.push(1e6);
}

// Optional competitors — only to detect availability (not measured here).
const load = async (name, getter) => { try { return { name, mod: await getter() }; } catch { return null; } };
const [axios, got, nodeFetch, superagent, ky, cheerio] = (await Promise.all([
    load('axios', () => import('axios').then(m => m.default)),
    load('got', () => import('got').then(m => m.default)),
    load('node-fetch', () => import('node-fetch').then(m => m.default)),
    load('superagent', () => import('superagent').then(m => m.default)),
    load('ky', () => import('ky').then(m => m.default)),
    load('cheerio', () => import('cheerio').then(m => m.load))
])).map(x => x && x.mod);
let undici;
try { undici = await import('undici'); } catch {}

const A = axios, G = got, NF = nodeFetch, SA = superagent, KY = ky, $ = cheerio, U = undici;

// ---------------------------------------------------------------------------
// Dedicated server child management
// ---------------------------------------------------------------------------
async function startServer(latencyMs = 0) {
    const child = spawn(process.execPath, [SERVER_FILE], {
        stdio: ['ignore', 'pipe', 'inherit'],
        env: { ...process.env, BENCH_SERVER_LATENCY: String(latencyMs) }
    });
    const base = await new Promise((resolve, reject) => {
        let buf = '';
        const onData = (c) => {
            buf += c;
            const m = buf.match(/PORT (\d+)/);
            if (m) resolve(`http://127.0.0.1:${m[1]}`);
        };
        child.stdout.on('data', onData);
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`server exited (${code})`)));
        setTimeout(() => reject(new Error('server start timeout')), 10000).unref?.();
    });
    return { child, base };
}
const stopServer = (s) => { try { s.child.kill('SIGTERM'); } catch (_) {} };

// ---------------------------------------------------------------------------
// Isolated worker runner
// ---------------------------------------------------------------------------
function parseTraceGc(stderr) {
    // --trace-gc lines end with "… 1.2 / 3.4 ms …" (paused / total).
    let events = 0, pausedMs = 0, totalMs = 0;
    for (const line of stderr.split('\n')) {
        if (!/Scavenge|Mark-sweep|IncrementalMarking/.test(line)) continue;
        const m = line.match(/(\d+\.?\d*) \/ (\d+\.?\d*) ms/);
        if (!m) continue;
        events++;
        pausedMs += parseFloat(m[1]);
        totalMs += parseFloat(m[2]);
    }
    return { gcEvents: events, gcPausedMs: pausedMs, gcTotalMs: totalMs };
}

function runWorker(job) {
    return new Promise((resolve) => {
        const execArgv = [];
        if (CFG.gc) execArgv.push('--expose-gc');
        if (CFG.gc && CFG.isolate) execArgv.push('--trace-gc');
        const child = spawn(process.execPath, execArgv.concat([WORKER_FILE]), { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '', err = '';
        child.stdout.on('data', (c) => (out += c));
        child.stderr.on('data', (c) => (err += c));
        const timeoutMs = Math.min(3600e3, Math.max(120e3, Math.ceil((job.n / Math.max(job.c, 1)) * 1000) * 1.5));
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.once('error', () => { clearTimeout(timer); resolve({ ...job, error: 'spawn failed' }); });
        child.on('close', () => {
            clearTimeout(timer);
            const lines = out.trim().split('\n').filter(Boolean);
            let result = null;
            for (let i = lines.length - 1; i >= 0; i--) {
                try { result = JSON.parse(lines[i]); break; } catch (_) {}
            }
            if (!result || result.error) {
                resolve({
                    ...job,
                    error: result && result.error
                        ? String(result.error).split('\n')[0]
                        : `worker crashed (stderr: ${err.trim().slice(0, 160) || 'empty'})`
                });
                return;
            }
            if (CFG.gc) {
                // --trace-gc may write to stdout (before the JSON line) or stderr.
                const traceFromOut = lines.slice(0, -1).join('\n');
                Object.assign(result, parseTraceGc(traceFromOut + '\n' + err));
            }
            resolve(result);
        });
        child.stdin.end(JSON.stringify(job));
    });
}

// ---------------------------------------------------------------------------
// In-process quick mode (SWIFTLY_BENCH_ISOLATE=0)
// ---------------------------------------------------------------------------
async function runOneInProc(op, N, C) {
    const times = new Array(N);
    let idx = 0;
    const start = performance.now();
    const per = Math.floor(N / C);
    const extra = N - per * C;
    const workers = [];
    const mk = (count) => (async () => {
        for (let i = 0; i < count; i++) {
            const t0 = performance.now();
            await op(idx);
            times[idx++] = performance.now() - t0;
        }
    })();
    for (let w = 0; w < extra; w++) workers.push(mk(per + 1));
    for (let w = extra; w < C; w++) workers.push(mk(per));
    await Promise.all(workers);
    return { elapsed: performance.now() - start, times };
}

async function measureInProcess(job) {
    const { scenario, row, n, c, rounds, warmup, base } = job;
    try {
        const { modules, build } = getJob(scenario, row);
        const libs = {};
        for (const [key, spec] of Object.entries(modules)) {
            const mod = await import(resolveSpec(spec));
            libs[key] = key === 'swiftly' ? (mod.default || mod) : mod;
        }
        const op = build(libs, { base });
    if (warmup > 0) await runOneInProc(op, warmup, Math.min(c, 8));

    let maxLag = 0;
    let peakRss = 0;
    let lastTick = performance.now();
    const lagTimer = setInterval(() => {
        const now = performance.now();
        const lag = now - lastTick;
        if (lag > maxLag) maxLag = lag;
        lastTick = now;
        const rss = process.memoryUsage().rss;
        if (rss > peakRss) peakRss = rss;
    }, 5);

    const cpuStart = process.cpuUsage();
    const heapStart = process.memoryUsage().heapUsed;
    const wallStart = performance.now();
    let best = Infinity, bestTimes = null;
    for (let r = 0; r < rounds; r++) {
        const { elapsed, times } = await runOneInProc(op, n, c);
        if (elapsed < best) { best = elapsed; bestTimes = times; }
    }
    const wallMs = performance.now() - wallStart;
    clearInterval(lagTimer);
    const cpu = process.cpuUsage(cpuStart);
    const mem = process.memoryUsage();
    const lat = percentiles(bestTimes);
    return {
        scenario, row, op: row, n, c, rounds,
        rps: n / (best / 1000),
        elapsedMs: best,
        ...lat,
        cpuUserMs: cpu.user / 1000,
        cpuSysMs: cpu.system / 1000,
        cpuPct: wallMs > 0 ? (cpu.user + cpu.system) / 1000 / wallMs * 100 : 0,
        heapStart,
        heapDeltaPerOp: (mem.heapUsed - heapStart) / n,
        rssEnd: mem.rss,
        peakRss,
        maxLag,
        gcEvents: 0, gcPausedMs: 0, gcTotalMs: 0,
        inProcess: true
    };
    } catch (err) {
        return { scenario, row, n, c, rounds, error: String((err && err.stack) || err).split('\n')[0] };
    }
}

function percentiles(times) {
    const sorted = times.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const p = (q) => sorted[Math.min(n - 1, Math.floor((q / 100) * n))];
    const mean = times.reduce((s, x) => s + x, 0) / n;
    let sq = 0;
    for (const t of times) sq += (t - mean) * (t - mean);
    const stdev = Math.sqrt(sq / n);
    return {
        mean, min: sorted[0], max: sorted[n - 1],
        p50: p(50), p95: p(95), p99: p(99), p999: p(99.9),
        stdev, cv: mean > 0 ? (stdev / mean) * 100 : 0
    };
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------
const fmt = (v, digits = 1) => (v == null || !Number.isFinite(v)) ? '—' : v.toFixed(digits);
const fmtInt = (v) => (v == null || !Number.isFinite(v)) ? '—' : Math.round(v).toLocaleString();
const fmtBytes = (b) => {
    if (b == null || !Number.isFinite(b)) return '—';
    const abs = Math.abs(b);
    if (abs < 1024) return `${b.toFixed(0)} B`;
    if (abs < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
};

const W = 30;
const rowLabel = (name) => (name.length > W - 3 ? name.slice(0, W - 3) : name);
function latencyTable(title, rows) {
    console.log(`\n${title}`);
    console.log(`┌${'─'.repeat(W)}┬${'─'.repeat(11)}┬${'─'.repeat(10)}┬${'─'.repeat(10)}┬${'─'.repeat(10)}┬${'─'.repeat(10)}┬${'─'.repeat(10)}┬${'─'.repeat(10)}┬${'─'.repeat(10)}┬${'─'.repeat(9)}┐`);
    console.log(`│ ${'client'.padEnd(W - 2)}│${'req/s'.padStart(10)}│${'mean ms'.padStart(9)}│${'p50 ms'.padStart(9)}│${'p95 ms'.padStart(9)}│${'p99 ms'.padStart(9)}│${'p999'.padStart(9)}│${'min ms'.padStart(9)}│${'max ms'.padStart(9)}│${'CV %'.padStart(8)}│`);
    console.log(`├${'─'.repeat(W)}┼${'─'.repeat(11)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(9)}┤`);
    const sorted = [...rows].sort((a, b) => (b.rps || 0) - (a.rps || 0));
    for (const r of sorted) {
        const star = r.row === 'swiftly' ? '*' : ' ';
        if (r.error) {
            console.log(`│${star} ${rowLabel(r.row).padEnd(W - 3)}│${'ERR'.padStart(10)}${' '.repeat(83)}│`);
            continue;
        }
        console.log(`│${star} ${rowLabel(r.row).padEnd(W - 3)}│${fmtInt(r.rps).padStart(10)}│${fmt(r.mean, 3).padStart(9)}│${fmt(r.p50, 3).padStart(9)}│${fmt(r.p95, 3).padStart(9)}│${fmt(r.p99, 3).padStart(9)}│${fmt(r.p999, 3).padStart(9)}│${fmt(r.min, 3).padStart(9)}│${fmt(r.max, 3).padStart(9)}│${fmt(r.cv, 1).padStart(8)}│`);
    }
    console.log(`└${'─'.repeat(W)}┴${'─'.repeat(11)}┴${'─'.repeat(10)}┴${'─'.repeat(10)}┴${'─'.repeat(10)}┴${'─'.repeat(10)}┴${'─'.repeat(10)}┴${'─'.repeat(10)}┴${'─'.repeat(10)}┴${'─'.repeat(9)}┘`);
}

function resourceTable(title, rows) {
    console.log(`\n${title}`);
    console.log(`┌${'─'.repeat(W)}┬${'─'.repeat(10)}┬${'─'.repeat(13)}┬${'─'.repeat(12)}┬${'─'.repeat(11)}┬${'─'.repeat(11)}┬${'─'.repeat(12)}┬${'─'.repeat(11)}┐`);
    console.log(`│ ${'client'.padEnd(W - 2)}│${'CPU %'.padStart(9)}│${'heap Δ/op'.padStart(12)}│${'peak RSS'.padStart(11)}│${'GC ev'.padStart(10)}│${'GC ms'.padStart(10)}│${'max lag ms'.padStart(11)}│${'ops/s'.padStart(10)}│`);
    console.log(`├${'─'.repeat(W)}┼${'─'.repeat(10)}┼${'─'.repeat(13)}┼${'─'.repeat(12)}┼${'─'.repeat(11)}┼${'─'.repeat(11)}┼${'─'.repeat(12)}┼${'─'.repeat(11)}┤`);
    const sorted = [...rows].sort((a, b) => (b.rps || 0) - (a.rps || 0));
    for (const r of sorted) {
        const star = r.row === 'swiftly' ? '*' : ' ';
        if (r.error) {
            console.log(`│${star} ${rowLabel(r.row).padEnd(W - 3)}│${('ERR ' + r.error.slice(0, 40)).padStart(10)}${' '.repeat(72)}│`);
            continue;
        }
        console.log(`│${star} ${rowLabel(r.row).padEnd(W - 3)}│${fmt(r.cpuPct, 1).padStart(9)}│${fmtBytes(r.heapDeltaPerOp).padStart(12)}│${fmtBytes(r.peakRss ?? r.maxRSS).padStart(11)}│${fmtInt(r.gcEvents).padStart(10)}│${fmt(r.gcPausedMs, 1).padStart(10)}│${fmt(r.maxLag, 2).padStart(11)}│${fmtInt(r.rps).padStart(10)}│`);
    }
    console.log(`└${'─'.repeat(W)}┴${'─'.repeat(10)}┴${'─'.repeat(13)}┴${'─'.repeat(12)}┴${'─'.repeat(11)}┴${'─'.repeat(11)}┴${'─'.repeat(12)}┴${'─'.repeat(11)}┘`);
}

// ---------------------------------------------------------------------------
// Scenario metadata (row names must match benchmarks/ops.js keys)
// ---------------------------------------------------------------------------
const S = {
    core: ['swiftly', 'swiftly (undici)', 'undici', 'axios', 'got'],
    all: []
};
const SCENARIOS = [
    { id: 1, title: 'Simple JSON GET', n: () => CFG.N, c: () => CFG.C, rows: () => [
        { row: 'swiftly', when: true },
        { row: 'swiftly (undici)', when: CFG.undici && U },
        { row: 'raw http (ceiling)', when: true },
        { row: 'axios', when: A },
        { row: 'got', when: G },
        { row: 'node-fetch', when: NF },
        { row: 'superagent', when: SA },
        { row: 'undici', when: U }
    ] },
    { id: 2, title: 'POST JSON (serialization)', n: () => CFG.N, c: () => CFG.C, rows: () => [
        { row: 'swiftly', when: true },
        { row: 'swiftly (undici)', when: CFG.undici && U },
        { row: 'raw http (ceiling)', when: true },
        { row: 'axios', when: A },
        { row: 'got', when: G },
        { row: 'node-fetch', when: NF },
        { row: 'superagent', when: SA },
        { row: 'undici', when: U }
    ] },
    { id: 3, title: 'gzip decompression', n: () => CFG.N, c: () => CFG.C, rows: () => [
        { row: 'swiftly', when: true },
        { row: 'swiftly (undici)', when: CFG.undici && U },
        { row: 'raw + gunzip (ceiling)', when: true },
        { row: 'got', when: G },
        { row: 'superagent', when: SA },
        { row: 'node-fetch (auto)', when: NF },
        { row: 'undici (fetch)', when: U },
        { row: 'ky', when: KY }
    ] },
    { id: 4, title: 'Large JSON (100 KB) parsing', n: () => 200, c: () => CFG.C, rows: () => [
        { row: 'swiftly', when: true },
        { row: 'swiftly (undici)', when: CFG.undici && U },
        { row: 'raw + JSON.parse (ceiling)', when: true },
        { row: 'axios', when: A },
        { row: 'got', when: G },
        { row: 'superagent', when: SA },
        { row: 'undici', when: U },
        { row: 'ky', when: KY }
    ] },
    { id: 5, title: 'HTML scraper (multi-selector)', n: () => 200, c: () => CFG.C, rows: () => [
        { row: 'swiftly (parseHTML)', when: true },
        { row: 'swiftly (undici + parseHTML)', when: CFG.undici && U },
        { row: 'axios + cheerio', when: A && $ },
        { row: 'got + cheerio', when: G && $ },
        { row: 'superagent + cheerio', when: SA && $ },
        { row: 'node-fetch + cheerio', when: NF && $ },
        { row: 'ky + cheerio', when: KY && $ },
        { row: 'undici + cheerio', when: U && $ }
    ] },
    { id: 6, title: 'batch (8 parallel GETs per call)', n: () => 60, c: () => CFG.C, rpsScale: 8, rows: () => [
        { row: 'swiftly (batch)', when: true },
        { row: 'swiftly (undici + batch)', when: CFG.undici && U },
        { row: 'axios (Promise.all)', when: A },
        { row: 'got (Promise.all)', when: G },
        { row: 'node-fetch (all)', when: NF },
        { row: 'superagent (all)', when: SA },
        { row: 'ky (all)', when: KY },
        { row: 'undici (all)', when: U }
    ] },
    { id: 7, title: 'download (binary 1 KB → Buffer)', n: () => CFG.N, c: () => CFG.C, rows: () => [
        { row: 'swiftly (download)', when: true },
        { row: 'swiftly (undici + download)', when: CFG.undici && U },
        { row: 'node-fetch (arrayBuffer)', when: NF },
        { row: 'axios (arraybuffer)', when: A },
        { row: 'got (buffer)', when: G },
        { row: 'superagent (buffer)', when: SA },
        { row: 'ky (arrayBuffer)', when: KY },
        { row: 'undici (arrayBuffer)', when: U }
    ] },
    { id: 8, title: 'retries (each fails once, recovers)', n: () => 150, c: () => CFG.C, rows: () => [
        { row: 'swiftly (retry)', when: true },
        { row: 'swiftly (undici + retry)', when: CFG.undici && U },
        { row: 'axios + retry loop', when: A },
        { row: 'got (retry)', when: G },
        { row: 'node-fetch + retry loop', when: NF },
        { row: 'superagent (.retry)', when: SA },
        { row: 'ky + retry loop', when: KY },
        { row: 'undici + retry loop', when: U }
    ] },
    { id: 9, title: 'rate limiting (high limit → overhead only)', n: () => CFG.N, c: () => CFG.C, rows: () => [
        { row: 'swiftly (rate-limited)', when: true },
        { row: 'swiftly (undici + rate-limit)', when: CFG.undici && U },
        { row: 'axios + limiter', when: A },
        { row: 'got + limiter', when: G },
        { row: 'node-fetch + limiter', when: NF },
        { row: 'superagent + limiter', when: SA },
        { row: 'ky + limiter', when: KY },
        { row: 'undici + limiter', when: U }
    ] },
    { id: 10, title: 'mixed workload (GET+POST+text+scrape+download)', n: () => 250, c: () => CFG.C, rows: () => [
        { row: 'swiftly (mixed)', when: true },
        { row: 'swiftly (undici + mixed)', when: CFG.undici && U },
        { row: 'axios (mixed)', when: A },
        { row: 'got (mixed)', when: G },
        { row: 'node-fetch (mixed)', when: NF },
        { row: 'superagent (mixed)', when: SA },
        { row: 'ky (mixed)', when: KY },
        { row: 'undici (mixed)', when: U }
    ] },
    { id: 11, title: 'COMPLEX: e-commerce checkout (5-step flow)', n: () => 100, c: () => CFG.C, rpsScale: 5, rows: () => [
        { row: 'swiftly (flow)', when: true },
        { row: 'swiftly (undici + flow)', when: CFG.undici && U },
        { row: 'axios (flow)', when: A },
        { row: 'got (flow)', when: G },
        { row: 'node-fetch (flow)', when: NF },
        { row: 'superagent (flow)', when: SA },
        { row: 'undici (flow)', when: U }
    ] },
    { id: 12, title: 'COMPLEX: paginated aggregation (5 pages/flow)', n: () => 80, c: () => CFG.C, rpsScale: 5, rows: () => [
        { row: 'swiftly (pagination)', when: true },
        { row: 'swiftly (undici + pagination)', when: CFG.undici && U },
        { row: 'axios (pagination)', when: A },
        { row: 'got (pagination)', when: G },
        { row: 'node-fetch (pagination)', when: NF },
        { row: 'superagent (pagination)', when: SA },
        { row: 'undici (pagination)', when: U }
    ] },
    { id: 13, title: 'COMPLEX: scraping at scale (fetch + parse + extract)', n: () => 60, c: () => CFG.C, rows: () => [
        { row: 'swiftly (scrape-at-scale)', when: true },
        { row: 'swiftly (undici + scale)', when: CFG.undici && U },
        { row: 'got + cheerio (scale)', when: G && $ },
        { row: 'axios + cheerio (scale)', when: A && $ },
        { row: 'undici + cheerio (scale)', when: U && $ },
        { row: 'node-fetch + cheerio (scale)', when: NF && $ }
    ] },
    { id: 14, title: 'Parsing & extraction toolkit (HTML+XML+CSV+JSONPath)', n: () => 150, c: () => CFG.C, rows: () => [
        { row: 'swiftly (HTML parse)', when: true },
        { row: 'swiftly undici (HTML parse)', when: CFG.undici && U },
        { row: 'swiftly (full 6-parser suite)', when: true },
        { row: 'got + cheerio (extract)', when: G && $ },
        { row: 'axios + cheerio (extract)', when: A && $ },
        { row: 'undici + cheerio (extract)', when: U && $ }
    ] },
    { id: 15, title: 'Connection reuse (keepAlive pooling)', n: () => CFG.N, c: () => CFG.C, rows: () => [
        { row: 'swiftly (keepAlive)', when: true },
        { row: 'swiftly (no pool)', when: true },
        { row: 'swiftly (undici keepAlive)', when: CFG.undici && U },
        { row: 'undici (keepAlive)', when: U },
        { row: 'undici (default)', when: U },
        { row: 'axios (keepAlive)', when: A }
    ] },
    { id: 16, title: 'Transport matrix (node:http vs optional undici)', n: () => CFG.N, c: () => CFG.C, rows: () => [
        { row: 'swiftly (node:http)', when: true },
        { row: 'swiftly (undici)', when: CFG.undici && U },
        { row: 'raw http (ceiling)', when: true },
        { row: 'undici (raw)', when: U }
    ] }
];

// ---------------------------------------------------------------------------
// Library profile (in-process, not a measurement)
// ---------------------------------------------------------------------------
async function libraryProfile() {
    const { gzipSync } = await import('node:zlib');
    const rows = [
        ['dist/index.cjs', fs.existsSync(path.join(ROOT, 'dist/index.cjs')) ? fs.readFileSync(path.join(ROOT, 'dist/index.cjs')) : null],
        ['dist/index.mjs', fs.existsSync(path.join(ROOT, 'dist/index.mjs')) ? fs.readFileSync(path.join(ROOT, 'dist/index.mjs')) : null],
        ['index.mjs (ESM entry)', fs.readFileSync(path.join(ROOT, 'index.mjs'))],
        ['lib/ (all source)', Buffer.concat(fs.readdirSync(path.join(ROOT, 'lib')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(ROOT, 'lib', f))))]
    ].filter(([, b]) => b);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const depCount = Object.keys(pkg.dependencies || {}).length;
    const kb = (n) => n == null ? '—' : `${(n / 1024).toFixed(1)} KB`;
    const withGzip = rows.map(([name, b]) => [name, b.length, gzipSync(b).length]);
    const totalRaw = withGzip.reduce((s, r) => s + r[1], 0);
    const swiftly = await import('../index.mjs');
    console.log('\n=== Library profile ===');
    console.log('┌───────────────────────────┬──────────┬───────────┬──────────┐');
    console.log('│ artifact                  │   raw    │   gzip    │   % size │');
    console.log('├───────────────────────────┼──────────┼───────────┼──────────┤');
    for (const [name, raw, gz] of withGzip) {
        const pct = ((raw / totalRaw) * 100).toFixed(1).padStart(5);
        console.log(`│ ${name.padEnd(26)}│ ${kb(raw).padStart(8)}│ ${kb(gz).padStart(9)}│ ${pct}% │`);
    }
    console.log('└───────────────────────────┴──────────┴───────────┴──────────┘');
    console.log(`  Total (raw):        ${kb(totalRaw)}`);
    console.log(`  Runtime deps:       ${depCount}`);
    console.log(`  Exported API:       ${Object.keys(swiftly.default || swiftly).filter(k => k !== 'client' && k !== 'events').length} static methods + instance API`);
    console.log(`  Transports:         node:http (default)${U ? ' + optional undici' : ''}`);
    console.log(`  Bundle:             ESM + CJS dual build, tree-shakeable`);
    console.log(`  TypeScript:         bundled index.d.ts + JSDoc`);
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------
const tStart = Date.now();
let server = CFG.host
    ? null
    : await startServer(CFG.latency);
let base = CFG.host.replace(/\/+$/, '') || server.base;
const serverChild = server && server.child;

if (server) {
    console.log(`Dedicated benchmark server: ${server.base}  (latency: ${CFG.latency} ms)`);
} else {
    console.log(`External benchmark host: ${base}  (local server skipped)`);
}
if (CFG.profile) await libraryProfile();

console.log('\nSwiftly benchmark lab — isolated processes, best-of-' + CFG.rounds + ' rounds');
console.log(`Control: N=${CFG.N}  C=${CFG.C}  rounds=${CFG.rounds}  warmup=${CFG.warmup}  isolate=${CFG.isolate ? 'on' : 'off(quick)'}  gc=${CFG.gc ? 'on' : 'off'}  undici-rows=${CFG.undici ? 'on' : 'off'}`);
console.log('* = this library\n');

// One job = one isolated measurement.
async function measureRow(scenario, row, overrides = {}) {
    const n = overrides.n ?? scenario.n();
    const c = overrides.c ?? scenario.c();
    const rounds = n >= 100000 ? 1 : Math.min(CFG.rounds, n >= 10000 ? 2 : CFG.rounds);
    const warmup = Math.min(CFG.warmup, Math.max(0, Math.floor(n)));
    const job = { scenario: scenario.id, row, n, c, rounds, warmup, base: overrides.base ?? base };
    const res = CFG.isolate ? await runWorker(job) : await measureInProcess(job);
    if (res.rps && scenario.rpsScale) res.rps *= scenario.rpsScale;
    return res;
}

// PHASE A — the 16 scenarios
const selected = CFG.scenarios === 'all' ? SCENARIOS : SCENARIOS.filter(s => new Set(CFG.scenarios.split(',').map(x => parseInt(x, 10)).filter(n => !Number.isNaN(n))).has(s.id));
console.log(`Phase A — scenarios: ${selected.map(s => s.id).join(', ')} (${selected.length}/${SCENARIOS.length})`);

const winners = [];
for (const scenario of selected) {
    const rows = scenario.rows().filter(r => r.when).map(r => r.row);
    const results = [];
    for (const row of rows) {
        results.push(await measureRow(scenario, row));
    }
    const ok = results.filter(r => !r.error);
    latencyTable(`${scenario.id}. ${scenario.title} — latency`, ok);
    resourceTable(`${scenario.id}. ${scenario.title} — resources`, results);
    if (ok.length) {
        const winner = [...ok].sort((a, b) => b.rps - a.rps)[0];
        winners.push({ scenario: scenario.id, title: scenario.title, winner: winner.row, swiftRps: ok.find(r => r.row === 'swiftly')?.rps ?? null });
    }
}

// PHASE B — latency profile (dedicated server respawned per tier)
if (!CFG.host && selected.length > 0) {
    console.log(`\nPhase B — latency profile (server latency tiers: ${CFG.latencies.join(', ')} ms)`);
    const coreRows = S.core.filter(r =>
        r === 'swiftly' ? true :
        r === 'swiftly (undici)' ? (CFG.undici && U) :
        r === 'undici' ? U :
        r === 'axios' ? A :
        r === 'got' ? G : false
    );
    for (const latencyMs of CFG.latencies) {
        if (server && server.child) stopServer(server);
        const srv = await startServer(latencyMs);
        server.base = srv.base;
        server.child = srv.child;
        const results = [];
        for (const row of coreRows) {
            const res = await measureRow({ id: 1, n: () => CFG.N, c: () => CFG.C }, row, { base: server.base, n: Math.min(CFG.N * 2, 2000) });
            results.push(res);
        }
        latencyTable(`B. latency ${latencyMs} ms — latency`, results.filter(r => !r.error));
    }
    if (server && server.child) stopServer(server);
    const srv = await startServer(CFG.latency);
    server.base = srv.base;
    server.child = srv.child;
    base = srv.base;
}

// PHASE C — scale profile (N from 1 to 1M)
if (selected.some(s => s.id === 1)) {
    console.log(`\nPhase C — scale profile (N sweep: ${CFG.scale.join(', ')} requests)`);
    const coreRows = S.core.filter(r => {
        if (r.includes('undici')) return CFG.undici && U;
        if (r === 'axios') return A;
        if (r === 'got') return G;
        if (r === 'undici') return U;
        return true;
    });
    for (const n of CFG.scale) {
        const c = Math.min(CFG.C, n);
        const results = [];
        for (const row of coreRows) {
            const res = await measureRow({ id: 1, n: () => n, c: () => c }, row, { n, c });
            results.push(res);
        }
        latencyTable(`C. N=${n.toLocaleString()} — latency`, results.filter(r => !r.error));
        resourceTable(`C. N=${n.toLocaleString()} — resources`, results);
    }
}

// PHASE D — concurrency sweep (DEEP only)
if (CFG.deep && selected.some(s => s.id === 1)) {
    console.log(`\nPhase D — concurrency sweep (C: ${CFG.concurrencies.join(', ')})`);
    const n = 5000;
    const coreRows = ['swiftly', 'swiftly (undici)', 'undici'];
    for (const c of CFG.concurrencies) {
        const results = [];
        for (const row of coreRows) {
            if (row.includes('undici') && !(CFG.undici && U)) continue;
            const res = await measureRow({ id: 1, n: () => n, c: () => c }, row, { n, c });
            results.push(res);
        }
        latencyTable(`D. concurrency C=${c} — latency`, results.filter(r => !r.error));
    }
}

// PHASE E — sustained memory/GC stress
if (selected.some(s => s.id === 1)) {
    console.log(`\nPhase E — sustained memory/GC stress (N=${CFG.stressN.toLocaleString()})`);
    const coreRows = ['swiftly', 'swiftly (undici)', 'undici', 'axios'].filter(r => !r.includes('undici') || (CFG.undici && U)).filter(r => r !== 'axios' || A);
    const results = [];
    for (const row of coreRows) {
        const res = await measureRow({ id: 1, n: () => CFG.stressN, c: () => CFG.C }, row, { n: CFG.stressN, c: CFG.C, rounds: 1 });
        results.push(res);
    }
    resourceTable(`E. memory & GC — N=${CFG.stressN.toLocaleString()}`, results);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Summary ===');
if (winners.length) {
    const isSwiftly = (name) => name === 'swiftly' || String(name).startsWith('swiftly');
    // Every plain swiftly row runs on node:http; only names with "(undici" use it.
    const swiftlyWins = winners.filter(w => isSwiftly(w.winner));
    const nodeHttpWins = swiftlyWins.filter(w => !String(w.winner).includes('(undici')).length;
    const undiciWinsTotal = swiftlyWins.length - nodeHttpWins;
    const undiciLibWins = winners.filter(w => w.winner === 'undici' || w.winner === 'undici (raw)' || w.winner === 'undici (default)').length;
    console.log(`  Scenarios run:      ${winners.length}`);
    console.log(`  Swiftly wins:       ${swiftlyWins.length}  (${nodeHttpWins} node:http + ${undiciWinsTotal} undici transport)`);
    console.log(`  Undici wins:        ${undiciLibWins}`);
    console.log(`  Total wall time:    ${((Date.now() - tStart) / 1000).toFixed(0)}s`);
    console.log('');
    for (const w of winners) {
        const swiftRow = w.swiftRps != null ? `  [swiftly ${Math.round(w.swiftRps).toLocaleString()} req/s]` : '';
        console.log(`  #${String(w.scenario).padStart(2)} ${w.title.slice(0, 48).padEnd(48)} winner: ${w.winner}${swiftRow}`);
    }
} else {
    console.log(`  Total wall time:    ${((Date.now() - tStart) / 1000).toFixed(0)}s`);
}

if (serverChild) stopServer(server);
process.exit(0);