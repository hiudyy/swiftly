import swiftly, { events, type Config, type ClientInstance } from 'swiftly';

// Factory
const client: ClientInstance = swiftly({ baseURL: 'https://example.com' });

// Methods
client.get('https://api.example.com/users/1');
client.post('/users', { name: 'Ada' });
client.put('/users/1', { name: 'Grace' });
client.patch('/users/1', { age: 36 });
client.delete('/users/1');
client.head('/health');
client.options('/resource');
client.download('/file.zip');

// Static API
swiftly.get('https://api.example.com', { timeout: 1000 });
swiftly.post('/posts', { title: 'x' });
swiftly.batch([{ method: 'get', url: '/a' }, { method: 'get', url: '/b' }]);
swiftly.scrape('https://example.com', '.title');
swiftly.query('https://api.example.com/graphql', { query: '{ users { id } }' });

// Config helpers
client.setBaseURL('https://example.com');
client.setTimeout(5000);
client.setDebug(false);
const cfg: Config = client.getConfig();

// Events
client.on('request:end', () => {});
client.off('request:end');
const e: string = events.REQUEST_END;

// Interceptors
client.interceptors.request.use((c) => c);
client.interceptors.response.use((res) => res);

// Static accessors
const shared = swiftly.client();
const metrics = shared.getMetrics();