const assert = require('assert');
const Connection = require('mongodb-connection-model');
const connect = Connection.connect;
const { getInstance } = require('../lib/instance-detail-helper');
const helper = require('./helper');
const DataService = require('../lib/data-service');
const { promisify } = require('util');
const _ = require('lodash');

describe('mongodb-data-service#instance', function() {
  describe('local', function() {
    let client;
    let model;

    before(async() => {
      model = await Connection.from(
        'mongodb://localhost:27018/data-service'
      );
    });

    describe('connecting', () => {
      after(function(done) {
        client.close(true, done);
      });
      it('should connect to `localhost:27018`', async() => {
        const [ _client ] = await connect(
          model,
          null
        );
        client = _client;
      });
    });

    describe('after connecting', () => {
      before(async() => {
        const [ _client ] = await connect(
          model,
          null
        );
        client = _client;
      });
      after(function(done) {
        client.close(true, done);
      });

      it('should not close the db after getting instance details', (done) => {
        const db = client.db('data-service');

        assert(db);
        getInstance(client, db, function(err) {
          if (err) {
            return done(err);
          }
          db.admin().ping(function(_err, pingResult) {
            if (_err) {
              done(_err);
            }
            done(null, pingResult);
          });
        });
      });
    });

    if (process.env.MONGODB_TOPOLOGY !== 'cluster') {
      describe('views', function() {
        const service = new DataService(helper.connection);
        let instanceDetails;
        before(async() => {
          await service.connect();

          const runInsertDocuments = promisify(helper.insertTestDocuments);
          await runInsertDocuments(service.client);
        });

        after(function(done) {
          helper.deleteTestDocuments(service.client, function() {
            service.disconnect(function() {
              done();
            });
          });
        });

        it('creates a new view', function(done) {
          service.createView(
            'myView',
            'data-service.test',
            [{ $project: { a: 0 } }],
            {},
            function(err) {
              if (err) return done(err);
              done();
            }
          );
        });

        it('gets the instance details', function(done) {
          service.instance({}, function(err, res) {
            if (err) return done(err);
            instanceDetails = res;
            done();
          });
        });

        it('includes the view details in instance details', function() {
          const viewInfo = _.find(instanceDetails.collections, [
            '_id',
            'data-service.myView'
          ]);
          assert.deepEqual(viewInfo, {
            _id: 'data-service.myView',
            name: 'myView',
            database: 'data-service',
            readonly: true,
            collation: null,
            type: 'view',
            view_on: 'test',
            pipeline: [{ $project: { a: 0 } }]
          });
        });

        it('drops the view', function(done) {
          service.dropView('data-service.myView', done);
        });
      });
    }
  });
});
