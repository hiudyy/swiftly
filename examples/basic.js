// Basic usage examples
import swiftly from '../index.mjs';

// GET - resolves with the parsed JSON body
const todo = await swiftly.get('https://jsonplaceholder.typicode.com/todos/1');
console.log('GET ->', todo.title);

// POST with JSON body
const created = await swiftly.post('https://jsonplaceholder.typicode.com/posts', {
    title: 'Hello',
    body: 'World',
    userId: 1
});
console.log('POST ->', created.id);

// PUT
const updated = await swiftly.put('https://jsonplaceholder.typicode.com/posts/1', {
    title: 'Updated',
    body: 'Body',
    userId: 1
});
console.log('PUT ->', updated.title);

// DELETE
const deleted = await swiftly.delete('https://jsonplaceholder.typicode.com/posts/1');
console.log('DELETE ->', deleted);

// PATCH
const patched = await swiftly.patch('https://jsonplaceholder.typicode.com/posts/1', { title: 'Patched' });
console.log('PATCH ->', patched.title);