/**
 * Time saver for when tests fail or misbehave. `mocha -r test/diagnostic-header.js`
 * will eval this file before running tests so its just displayed by default
 * instead of having to look it up manually.
 */
console.log({
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    mongodb: require('mongodb/package.json').version,
    'mongodb-core': require('mongodb-core/package.json').version
  }
});
