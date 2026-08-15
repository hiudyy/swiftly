import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.js'],
        coverage: {
            provider: 'v8',
            include: ['lib/**/*.js'],
            exclude: ['lib/index.js', 'lib/agent.js'],
            thresholds: {
                lines: 85,
                branches: 74,
                functions: 84,
                statements: 83
            }
        }
    }
});
