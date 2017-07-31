const { StitchClient } = require('mongodb-stitch');
const toNS = require('mongodb-ns');

class WebClient {
  constructor(model) {
    this.model = model;
  }

  connect(callback) {
    var baseUrl = `http://${this.model.hostname}:${this.model.port}`;
    this.stitchClient = new StitchClient(this.model.stitchClientAppId, { baseUrl: baseUrl });
    this.stitchClient
      .login(this.model.mongodb_username, this.model.mongodb_password)
      .then(() => {
        callback(null, this.stitchClient);
      }).catch((err) => {
        callback(err);
      });
  }

  count(ns, filter, options, callback) {
    const namespace = toNS(ns);
    const db = this.stitchClient.service('mongodb', 'mongodb1').db(namespace.database);
    const collection = db.collection(namespace.collection);
    collection.count(filter, options)
      .then((number) => {
        callback(null, number);
      }).catch((err) => {
        callback(err);
      });
  }
}

module.exports = WebClient;
