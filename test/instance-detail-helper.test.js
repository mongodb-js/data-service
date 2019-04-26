const assert = require('assert');
const Connection = require('mongodb-connection-model');
const connect = Connection.connect;
const { getInstance } = require('../lib/instance-detail-helper');
const helper = require('./helper');
const DataService = require('../lib/data-service');

describe('mongodb-data-service#instance', function() {
  describe('local', function() {
    let client;
    let db;
    it('should connect to `localhost:27018`', function(done) {
      const model = Connection.from('mongodb://localhost:27018/data-service');
      connect(
        model,
        null,
        function(err, _client) {
          if (err) {
            return done(err);
          }
          client = _client;
          db = client.db('data-service');
          done();
        }
      );
    });
    it('should not close the db after getting instance details', function(done) {
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

    describe('views', function() {
      var service = new DataService(helper.connection);
      before(function(done) {
        service.connect(function(err) {
          if (err) return done(err);
          helper.insertTestDocuments(service.client, function() {
            done();
          });
        });
      });

      after(function(done) {
        helper.deleteTestDocuments(service.client, function() {
          done();
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

      it('includes the view details in instance details', function(done) {
        service.instance({}, function(err, res) {
          if (err) return done(err);

          console.log('res', res);
          done();
        });
      });

      it('drops the view', function(done) {
        service.dropView('data-service.myView', done);
      });
    });
  });
});
