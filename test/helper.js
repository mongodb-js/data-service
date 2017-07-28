var chai = require('chai');
var assert = require('assert');
var expect = chai.expect;
var es = require('event-stream');
var Connection = require('mongodb-connection-model');

module.exports.chai = chai;
module.exports.assert = assert;
module.exports.expect = expect;
module.exports.eventStream = es;

module.exports.stitchConnection = new Connection({
  hostname: '127.0.0.1',
  port: 8080,
  stitchClientAppId: 'cool-app-aemfj',
  stitchGroupId: '5970f24c5d153afcbb5b2323',
  mongodb_username: 'leaf@tree.com',
  mongodb_password: 'password'
});

module.exports.connection = new Connection({
  hostname: '127.0.0.1',
  port: 27018,
  ns: 'data-service'
});

module.exports.insertTestDocuments = function(client, callback) {
  var collection = client.database.collection('test');
  collection.insertMany([{
    a: 1
  }, {
    a: 2
  }], callback);
};

module.exports.deleteTestDocuments = function(client, callback) {
  var collection = client.database.collection('test');
  collection.deleteMany(callback);
};
