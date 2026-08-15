/**
 * Connection Pooling (keep-alive Agents)
 * @author hiudy
 * @license MIT
 */

import http from 'node:http';
import https from 'node:https';

/**
 * Get (or lazily create) a keep-alive Agent for a given origin.
 *
 * Agents are cached per `protocol + host:port` so sockets are reused across
 * requests to the same origin. A custom `config.agent` always wins and is used
 * as-is (never pooled).
 *
 * @param {string} protocol - 'http:' or 'https:'
 * @param {string} hostKey - origin key (host:port)
 * @param {object} [config] - request/client config
 * @param {Map} pool - per-client agent pool
 * @returns {import('node:http').Agent} Agent
 */
export function getAgent(protocol, hostKey, config, pool) {
    if (config && config.agent) return config.agent;

    const settings = config || {};
    const keepAlive = settings.keepAlive !== false;
    const maxSockets = settings.maxSockets || Infinity;
    const maxFreeSockets = settings.maxFreeSockets || 256;

    const cacheKey = `${protocol}//${hostKey}::ka=${keepAlive}:ms=${maxSockets}:mfs=${maxFreeSockets}`;
    let agent = pool.get(cacheKey);
    if (agent) return agent;

    const ctor = protocol === 'https:' ? https.Agent : http.Agent;
    agent = new ctor({
        keepAlive,
        maxSockets,
        maxFreeSockets,
        // Keep warm sockets alive a bit longer; 0 disables per-request keepalive
        keepAliveMsecs: settings.keepAliveMsecs || 1000
    });
    pool.set(cacheKey, agent);
    return agent;
}

/**
 * Destroy every pooled agent in the map (used by `close()`).
 * @param {Map} pool
 */
export function destroyAgents(pool) {
    for (const agent of pool.values()) {
        try {
            agent.destroy();
        } catch (_) { /* already destroyed */ }
    }
    pool.clear();
}