import { build } from 'esbuild';

const common = {
    bundle: true,
    platform: 'node',
    target: 'node14',
    sourcemap: true,
    logLevel: 'info'
};

// CommonJS bundle (used by `require('swiftly')`)
await build({
    ...common,
    entryPoints: ['index.mjs'],
    outfile: 'dist/index.cjs',
    format: 'cjs',
    banner: { js: "'use strict';" }
});

// ESM bundle (used by `import swiftly from 'swiftly'`)
await build({
    ...common,
    entryPoints: ['index.mjs'],
    outfile: 'dist/index.mjs',
    format: 'esm'
});

console.log('✅ Build complete (dist/index.cjs, dist/index.mjs)');