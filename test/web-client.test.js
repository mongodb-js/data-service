var helper = require('./helper');

var expect = helper.expect;

var WebClient = require('../lib/web-client');

describe('WebClient', function() {
  this.slow(10000);
  this.timeout(20000);
  var client = new WebClient(helper.stitchConnection);

  describe('#connect', function() {
    it('Yields a Stitch Client', function(done) {
      client.connect(function(stitchClient) {
        expect(stitchClient.authedId()).to.not.equal(undefined);
        done();
      });
    });
  });
});
