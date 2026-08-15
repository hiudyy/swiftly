#!/usr/bin/env node

/**
 * Swiftly CLI
 * @author hiudy
 * @license MIT
 */

import swiftly from '../index.mjs';
import { isValidUrl } from '../lib/utils.js';

const usage = `
Swiftly CLI - Lightweight HTTP Client

Usage:
  swiftly <method> <url> [options]

Methods:
  get     Perform GET request
  post    Perform POST request
  put     Perform PUT request
  patch   Perform PATCH request
  delete  Perform DELETE request
  scrape  Scrape content from URL

Options:
  --data, -d       Data to send with request (JSON)
  --selector, -s   CSS selector for scraping
  --headers, -h    Custom headers (JSON format)
  --timeout, -t    Request timeout in ms
  --quiet, -q      Suppress request logs

Examples:
  swiftly get https://api.example.com
  swiftly post https://api.example.com -d '{"key": "value"}'
  swiftly scrape https://example.com -s '.main-content'
`;

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2 || args.includes('--help')) {
        console.log(usage);
        process.exit(0);
    }

    const method = args[0].toLowerCase();
    const url = args[1];

    if (!isValidUrl(url)) {
        console.error('Error: Invalid URL');
        process.exit(1);
    }

    const options = parseOptions(args.slice(2));

    try {
        let response;

        if (method === 'scrape') {
            if (!options.selector) {
                console.error('Error: Selector is required for scraping');
                process.exit(1);
            }
            response = await swiftly.scrape(url, options.selector, options);
        } else {
            switch (method) {
                case 'get':
                    response = await swiftly.get(url, options);
                    break;
                case 'post':
                    response = await swiftly.post(url, options.data, options);
                    break;
                case 'put':
                    response = await swiftly.put(url, options.data, options);
                    break;
                case 'patch':
                    response = await swiftly.patch(url, options.data, options);
                    break;
                case 'delete':
                    response = await swiftly.delete(url, options);
                    break;
                default:
                    console.error('Error: Invalid method');
                    process.exit(1);
            }
        }

        console.log(JSON.stringify(response, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

function parseOptions(args) {
    const options = { debug: false };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--data':
            case '-d':
                try {
                    options.data = JSON.parse(args[++i]);
                } catch {
                    options.data = args[i];
                }
                break;
            case '--selector':
            case '-s':
                options.selector = args[++i];
                break;
            case '--headers':
            case '-h':
                try {
                    options.headers = JSON.parse(args[++i]);
                } catch {
                    console.error('Error: Invalid headers format');
                    process.exit(1);
                }
                break;
            case '--timeout':
            case '-t':
                options.timeout = parseInt(args[++i], 10);
                break;
            case '--quiet':
            case '-q':
                options.debug = false;
                break;
        }
    }

    return options;
}

main().catch(console.error);