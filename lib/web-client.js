const {StitchClient} = require('mongodb-stitch');

class WebClient {
  constructor(model) {
    this.model = model;
  }

  connect(callback) {
    var baseUrl = `http://${this.model.hostname}:${this.model.port}`;
    var sitchClient = new StitchClient(this.model.stitchClientAppId, {baseUrl: baseUrl});
    sitchClient
      .login(this.model.mongodb_username, this.model.mongodb_password)
      .then(() => {
        callback(sitchClient);
      }).catch((err) => {
        console.log(err);
        callback(sitchClient);
      });
  }
}

module.exports = WebClient;
