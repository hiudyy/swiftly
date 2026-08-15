// Swiftly benchmark — isolated measurement worker.
// Runs ONE job (scenario × row) in a dedicated process and prints a single JSON
// line to stdout. Spawned with --expose-gc (and --trace-gc when requested) so
// memory/GC metrics reflect only this row's code path.
import v8 from 'node:v8';
import { performance } from 'node:perf_hooks';
import { getJob, resolveSpec } from './ops.js';

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (c) => (data += c));
        process.stdin.on('end', () => resolve(data));
    });
}

// Integer distribution: exactly N ops across C workers.
async function runOne(fn, N, C, onSample) {
    const times = new Array(N);
    let idx = 0;
    const start = performance.now();
    const per = Math.floor(N / C);
    const extra = N - per * C;
    const workers = [];
    for (let w = 0; w < extra; w++) {
        workers.push((async () => {
            for (let i = 0; i < per + 1; i++) {
                const t0 = performance.now();
                await fn(idx);
                times[idx++] = performance.now() - t0;
                if (onSample) onSample();
            }
        })());
    }
    for (let w = extra; w < C; w++) {
        workers.push((async () => {
            for (let i = 0; i < per; i++) {
                const t0 = performance.now();
                await fn(idx);
                times[idx++] = performance.now() - t0;
                if (onSample) onSample();
            }
        })());
    }
    await Promise.all(workers);
    return { elapsed: performance.now() - start, times };
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
        mean,
        min: sorted[0],
        max: sorted[n - 1],
        p50: p(50),
        p95: p(95),
        p99: p(99),
        p999: p(99.9),
        stdev,
        cv: mean > 0 ? (stdev / mean) * 100 : 0
    };
}

const gcNow = () => { if (typeof global.gc === 'function') { global.gc(); return true; } return false; };

async function main() {
    const raw = await readStdin();
    const job = JSON.parse(raw);
    const { scenario, row, n, c, rounds, warmup, base } = job;

    const { modules, build } = getJob(scenario, row);
    const libs = {};
    for (const [key, spec] of Object.entries(modules)) {
        const mod = await import(resolveSpec(spec));
        // The swiftly entry ships its API as the default export; ops.js builds
        // call swiftly.get/post/batch/download and swiftly({...}) directly.
        libs[key] = key === 'swiftly' ? (mod.default || mod) : mod;
    }
    const op = build(libs, { base });
    const opName = row === 'swiftly' ? `swiftly (${scenario})` : row;

    // Force a GC before the baseline so heap deltas reflect only the run.
    gcNow();
    const heapStart = v8.getHeapStatistics().used_heap_size;

    // Warm up connections + JIT so measured rounds are stable.
    if (warmup > 0) await runOne(op, warmup, Math.min(c, 8));

    // Event-loop lag + RSS peak sampling during the measured rounds only.
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
    const wallStart = performance.now();
    let best = Infinity, bestTimes = null;
    for (let r = 0; r < rounds; r++) {
        const { elapsed, times } = await runOne(op, n, c);
        if (elapsed < best) { best = elapsed; bestTimes = times; }
    }
    const wallMs = performance.now() - wallStart;
    clearInterval(lagTimer);
    const cpu = process.cpuUsage(cpuStart);
    gcNow();
    const heapEnd = v8.getHeapStatistics().used_heap_size;
    const mem = process.memoryUsage();

    const lat = percentiles(bestTimes);
    const elapsedMs = best;
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const cpuPct = wallMs > 0 ? (cpuMs / wallMs) * 100 : 0;

    const result = {
        scenario, row, op: opName,
        n, c, rounds,
        rps: n / (elapsedMs / 1000),
        elapsedMs,
        ...lat,
        cpuUserMs: cpu.user / 1000,
        cpuSysMs: cpu.system / 1000,
        cpuPct, // per core (user+sys) over the measured rounds wall time
        heapStart, heapEnd,
        heapDeltaPerOp: (heapEnd - heapStart) / n, // retained bytes/op after forced GC
        rssEnd: mem.rss,
        peakRss, // sampled peak RSS during measured rounds (bytes)
        maxLag // worst event-loop stall (ms)
    };

    process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((err) => {
    process.stdout.write(JSON.stringify({ error: String((err && err.stack) || err) }) + '\n');
    process.exit(1);
});