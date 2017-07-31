var helper = require('./helper');

var expect = helper.expect;

var WebClient = require('../lib/web-client');

describe('WebClient', function() {
  this.slow(10000);
  this.timeout(20000);
  var client = new WebClient(helper.stitchConnection);

  describe('#connect', function() {
    it('yields a Stitch Client', function(done) {
      client.connect(function(error, stitchClient) {
        expect(error).to.equal(null);
        expect(stitchClient.authedId()).to.not.equal(undefined);
        done();
      });
    });
  });

  describe('#count', function() {
    it('yields the error and the count', function(done) {
      client.count('data-service.test', {}, {}, function(error, count) {
        expect(error).to.equal(null);
        expect(count).to.equal(0);
        done();
      });
    });
  });

  describe('#find', function() {
    it('yields the error and the results to the callback', function(done) {
      client.find('data-service.test', {}, {}, function(error, results) {
        expect(error).to.equal(null);
        expect(results.length).to.equal(0);
        done();
      });
    });
  });
});
