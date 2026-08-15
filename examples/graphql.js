// GraphQL query support
import swiftly from '../index.mjs';

// Using a public GraphQL endpoint
const result = await swiftly.query('https://countries.trevorblades.com', {
    query: `query {
        continent(code: "SA") {
            name
            countries { name }
        }
    }`
});

console.log('GRAPHQL ->', JSON.stringify(result, null, 2).slice(0, 200));