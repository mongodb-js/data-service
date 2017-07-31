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
    this._getCollection(ns).count(filter, options)
      .then((number) => {
        callback(null, number);
      }).catch((err) => {
        callback(err);
      });
  }

  find(ns, filter, options, callback) {
    this._getCollection(ns).find(filter, options)
      .then((results) => {
        callback(null, results);
      }).catch((err) => {
        callback(err);
      });
  }

  aggregate(ns, pipeline, options, callback) {
    this._getCollection(ns).aggregate(pipeline)
      .then((results) => {
        callback(null, results);
      }).catch((err) => {
        callback(err);
      });
  }

  deleteOne(ns, doc, options, callback) {
    this._getCollection(ns).deleteOne(doc)
      .then((result) => {
        callback(null, result);
      }).catch((err) => {
        callback(err);
      });
  }

  insertOne(ns, doc, options, callback) {
    this._getCollection(ns).insertOne(doc)
      .then((result) => {
        callback(null, result);
      }).catch((err) => {
        callback(err);
      });
  }

  _getCollection(ns) {
    const namespace = toNS(ns);
    const db = this.stitchClient.service('mongodb', 'mongodb1').db(namespace.database);
    return db.collection(namespace.collection);
  }
}

module.exports = WebClient;
