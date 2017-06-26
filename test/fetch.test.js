var assert = require('assert');
var Connection = require('mongodb-connection-model');
var connect = Connection.connect;
var fetch = require('../').fetch;
var runner = require('mongodb-runner');
var debug = require('debug')('mongodb-data-service:test:fetch');

describe('mongodb-data-service#fetch', function() {
  describe('local', function() {
    var db;
    before(function(done) {
      this.timeout(20000);
      runner.start({}, done);
    });
    after(function() {
      if (db) {
        db.close();
      }
    });
    it('should connect to `localhost:27017`', function(done) {
      var model = Connection.from('mongodb://localhost:27017');
      connect(model, null, function(err, _db) {
        if (err) {
          return done(err);
        }
        db = _db;
        done();
      });
    });
    it('should get instance details', function(done) {
      assert(db);
      fetch(db, function(err, res) {
        if (err) {
          return done(err);
        }
        debug('instance details', JSON.stringify(res, null, 2));
        done();
      });
    });
    it('should not close the db after getting instance details', function(done) {
      assert(db);
      fetch(db, function(err) {
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

  /**
   * @todo (imlucas) After mongodb-tools rewrite, http://npm.im/mongodb-runner
   * will be able to properly spin up deployments w authentication.
   */
  it.skip('should get instance details for john doe', function(done) {
    var connection = Connection.from('john:doe@localhost:30000/admin?authMechanism=MONGODB-CR');
    connect(connection, null, function(err, db) {
      if (err) {
        return done(err);
      }
      fetch(db, function(_err, res) {
        if (_err) {
          return done(_err);
        }
        debug('instance details', JSON.stringify(res, null, 2));
        done();
      });
    });
  });
});
