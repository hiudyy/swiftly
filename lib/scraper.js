/**
 * Advanced HTML Scraper
 * @author Cognima
 * @license MIT
 */

class AdvancedHTMLParser {
    constructor(html, options = {}) {
        this.html = typeof html === 'string' ? html : String(html || '');
        this.elementCache = new Map();
        this.debug = options.debug || false;
    }

    querySelector(selector) {
        return this._parseSelector(selector, true);
    }

    querySelectorAll(selector) {
        return this._parseSelector(selector, false);
    }

    _parseSelector(selector, single = false) {
        if (typeof selector !== 'string') {
            return single ? null : [];
        }

        const parts = selector.trim().split(' ').filter(part => part);
        let results = [this.html];

        for (const part of parts) {
            results = this._processSelectorPart(results, part);
            if (!results.length) break;
        }

        const attrMatch = selector.match(/@([a-z-]+)$/i);
        if (attrMatch) {
            results = results.map(el => this._extractAttribute(el, attrMatch[1]));
        }

        return single ? (results[0] || null) : results;
    }

    _processSelectorPart(elements, selector) {
        if (typeof selector !== 'string') {
            return [];
        }

        const results = [];

        const idMatch = selector.match(/^#([\w-]+)/);
        const classMatch = selector.match(/^\.([\w-]+)/);
        const attrMatch = selector.match(/\[([^\]=]+)(?:=([^\]]+))?\]/);

        for (const el of elements) {
            if (typeof el !== 'string') continue;

            if (idMatch) {
                const found = this._getElementById(idMatch[1], el);
                if (found) results.push(found);
            } else if (classMatch) {
                results.push(...this._getElementsByClassName(classMatch[1], el));
            } else if (attrMatch) {
                results.push(...this._getElementsByAttribute(attrMatch[1], attrMatch[2], el));
            } else {
                results.push(...this._getElementsByTagName(selector, el));
            }
        }

        return results;
    }

    _getElementById(id, html = this.html) {
        const cacheKey = `id:${id}`;
        if (this.elementCache.has(cacheKey)) return this.elementCache.get(cacheKey);

        const regex = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
        const match = regex.exec(html);
        const result = match ? this._createElementObject(match[0], match[1]) : null;

        this.elementCache.set(cacheKey, result);
        return result;
    }

    _getElementsByClassName(className, html = this.html) {
        const cacheKey = `class:${className}`;
        if (this.elementCache.has(cacheKey)) return this.elementCache.get(cacheKey);

        const regex = new RegExp(`<[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
        const results = [];
        let match;

        while ((match = regex.exec(html)) !== null) {
            results.push(this._createElementObject(match[0], match[1]));
        }

        this.elementCache.set(cacheKey, results);
        return results;
    }

    _getElementsByAttribute(attrName, attrValue, html = this.html) {
        const regex = attrValue
            ? new RegExp(`<[^>]+${attrName}=["']${attrValue}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi')
            : new RegExp(`<[^>]+${attrName}=["'][^"']+["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');

        const results = [];
        let match;

        while ((match = regex.exec(html)) !== null) {
            results.push(this._createElementObject(match[0], match[1]));
        }

        return results;
    }

    _getElementsByTagName(tag, html = this.html) {
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
        const results = [];
        let match;

        while ((match = regex.exec(html)) !== null) {
            results.push(this._createElementObject(match[0], match[1]));
        }

        return results;
    }

    _extractAttribute(element, attrName) {
        if (!element?.html) return null;
        const match = element.html.match(new RegExp(`${attrName}=["']([^"']+)["']`, 'i'));
        return match ? match[1] : null;
    }

    _createElementObject(fullHtml, content) {
        return {
            html: fullHtml,
            content: content.trim(),
            attributes: this._parseAttributes(fullHtml),
            children: this._getChildren(content)
        };
    }

    _parseAttributes(html) {
        const attrRegex = /(\w+)=["']([^"']+)["']/g;
        const attributes = {};
        let match;

        while ((match = attrRegex.exec(html)) !== null) {
            attributes[match[1]] = match[2];
        }

        return attributes;
    }

    _getChildren(html) {
        const children = [];
        const regex = /<[^>]+>([\s\S]*?)<\/[^>]+>/gi;
        let match;

        while ((match = regex.exec(html)) !== null) {
            if (match[1].trim()) {
                children.push(this._createElementObject(match[0], match[1]));
            }
        }

        return children;
    }
}

export function parseHTML(html, selectors, options = {}) {
    if (Buffer.isBuffer(html)) {
        html = html.toString('utf-8');
    }

    if (typeof html !== 'string') {
        throw new Error(`HTML must be a string or Buffer, got ${typeof html}`);
    }

    if (!html || html.trim().length === 0) {
        if (typeof selectors === 'object' && !Array.isArray(selectors)) {
            const results = {};
            for (const key of Object.keys(selectors)) {
                results[key] = null;
            }
            return results;
        }
        return [];
    }

    const parser = new AdvancedHTMLParser(html, options);

    if (typeof selectors === 'string') {
        return parser.querySelectorAll(selectors);
    }

    if (typeof selectors === 'object' && !Array.isArray(selectors)) {
        const results = {};

        for (const [key, config] of Object.entries(selectors)) {
            if (typeof config === 'string') {
                const attrMatch = config.match(/^(.+)@(\w+)$/);
                if (attrMatch) {
                    const [, sel, attr] = attrMatch;
                    const elements = parser.querySelectorAll(sel);
                    results[key] = elements.map(el => parser._extractAttribute(el, attr));
                } else {
                    results[key] = parser.querySelectorAll(config);
                }
                continue;
            }

            if (typeof config === 'object' && config.selector) {
                const { selector, type = 'text', attr, multiple = true } = config;
                const elements = parser.querySelectorAll(selector);

                let extractedData;
                switch (type) {
                    case 'text':
                        extractedData = elements.map(el => el?.content || '');
                        break;
                    case 'html':
                        extractedData = elements.map(el => el?.html || '');
                        break;
                    case 'attr':
                        extractedData = elements.map(el =>
                            attr ? parser._extractAttribute(el, attr) : null
                        );
                        break;
                    default:
                        extractedData = elements.map(el => el?.content || '');
                }

                results[key] = multiple ? extractedData : (extractedData[0] || null);
                continue;
            }

            results[key] = parser.querySelectorAll(String(config));
        }

        return results;
    }

    if (Array.isArray(selectors)) {
        return selectors.map(sel => parser.querySelectorAll(sel));
    }

    return [];
}