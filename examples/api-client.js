// Real-world API client pattern
import swiftly from '../index.mjs';

const api = swiftly({
    baseURL: 'https://jsonplaceholder.typicode.com',
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' }
});

const users = await api.get('/users');
const me = users[0];
console.log('USER ->', me.name, `<${me.email}>`);

const posts = await api.get(`/users/${me.id}/posts`);
console.log('POSTS ->', posts.length, 'posts by', me.name);

// Attach an auth-style header via interceptor
api.interceptors.request.use((cfg) => {
    cfg.headers = { ...cfg.headers, Authorization: 'Bearer token' };
    return cfg;
});
console.log('Interceptor attached');