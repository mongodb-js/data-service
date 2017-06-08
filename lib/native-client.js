'use strict';

const _ = require('lodash');
const async = require('async');
const EventEmitter = require('events');
const connect = require('mongodb-connection-model').connect;
const getInstance = require('mongodb-instance-model').get;
const getIndexes = require('mongodb-index-model').fetch;
const createSampleStream = require('mongodb-collection-sample');
const parseNamespace = require('mongodb-ns');
const translate = require('mongodb-js-errors').translate;
const debug = require('debug')('mongodb-data-service:native-client');

/**
 * The constant for a mongos.
 */
const SHARDED = 'isdbgrid';

/**
 * Error message sustring for view operations.
 */
const VIEW_ERROR = 'is a view, not a collection';

/**
 * The system collection name.
 */
const SYSTEM = 'system';

/**
 * The native client class.
 */
class NativeClient extends EventEmitter {

  /**
   * Instantiate a new NativeClient object.
   *
   * @constructor
   * @param {Connection} model - The Connection model.
   */
  constructor(model) {
    super();
    this.model = model;
  }

  /**
   * Connect to the server.
   *
   * @param {function} done - The callback function.
   * @return {NativeClient}
   */
  connect(done) {
    debug('connecting...');
    this.client = connect(this.model, this.setupListeners.bind(this), (err, database) => {
      if (err) {
        return done(this._translateMessage(err));
      }
      debug('connected!');
      this.database = database;
      this.database.admin().command({ ismaster: 1 }, (error, result) => {
        const ismaster = error ? {} : result;
        this.isWritable = this._isWritable(ismaster);
        this.isMongos = this._isMongos(ismaster);
        done(null, this);
      });
    });
    this.client.on('status', (evt) => this.emit('status', evt));
    return this;
  }

  /**
   * Subscribe to SDAM monitoring events on the mongo client.
   *
   * @param {MongoClient} client - The driver client.
   */
  setupListeners(client) {
    if (client) {
      client.on('serverDescriptionChanged', (evt) => {
        this.emit('serverDescriptionChanged', evt);
      });

      client.on('serverOpening', (evt) => {
        this.emit('serverOpening', evt);
      });

      client.on('serverClosed', (evt) => {
        this.emit('serverClosed', evt);
      });

      client.on('topologyOpening', (evt) => {
        this.emit('topologyOpening', evt);
      });

      client.on('topologyClosed', (evt) => {
        this.emit('topologyClosed', evt);
      });

      client.on('topologyDescriptionChanged', (evt) => {
        this.emit('topologyDescriptionChanged', evt);
      });
    }
  }

  /**
   * Execute a command.
   *
   * @param {String} databaseName - The db name.
   * @param {Object} comm - The command.
   * @param {Function} callback - The callback.
   */
  command(databaseName, comm, callback) {
    var db = this._database(databaseName);
    db.command(comm, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Execute a buildInfo command on the currently connected instance.
   *
   * @param {Function} callback - The callback.
   */
  buildInfo(callback) {
    this.database.admin().command({'buildInfo': 1}, {}, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Execute a hostInfo command on the currently connected instance.
   *
   * @param {Function} callback - The callback.
   */
  hostInfo(callback) {
    this.database.admin().command({'hostInfo': 1}, {}, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Execute a connectionStatus command on the currently connected instance.
   *
   * @param {Function} callback - The callback.
   */
  connectionStatus(callback) {
    // TODO: Don't require admin db...?
    this.database.admin().command({'connectionStatus': 1}, {}, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Execute a usersInfo command on the currently connected instance.
   *
   * @see https://docs.mongodb.com/manual/reference/command/usersInfo/
   *
   * @param {String} authenticationDatabase - The database name.
   * @param {Object} options - The usersInfo options document, with keys:
   *  1.  usersInfo - One of:
   *      - a user name, e.g. 'dba-user', or
   *      - a list of users and databases, e.g. [
   *        {user: 'dba-user1', db: 'candy'},
   *        {user: 'dba-user2', db: 'bar'}
   *      ], or
   *      - the special integer 1, meaning list all users
   *      (can be with showCredentials but not with showPrivileges).
   *  2.  showCredentials (boolean)
   *  3.  showPrivileges (boolean)
   * @param {Function} callback - The callback.
   * @return {null}
   */
  usersInfo(authenticationDatabase, options, callback) {
    if (typeof(options) === 'string') {
      options = {usersInfo: options};
    }
    const usersInfo = {
      usersInfo: options.usersInfo,
      showCredentials: options.showCredentials || false,
      showPrivileges: options.showPrivileges || false
    };
    delete options.usersInfo;
    delete options.showCredentials;
    delete options.showPrivileges;
    const redundantKeys = Object.keys(options);
    if (redundantKeys.length > 0) {
      return callback(new Error('Unexpected keys found in usersInfo options: ' + redundantKeys), null);
    }
    const authDb = this._database(authenticationDatabase);
    authDb.command(usersInfo, {}, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Count the number of documents in the collection for the provided filter
   * and options.
   *
   * @param {string} ns - The namespace to search on.
   * @param {object} filter - The filter.
   * @param {object} options - The query options.
   * @param {function} callback - The callback function.
   */
  count(ns, filter, options, callback) {
    this._collection(ns).count(filter, options, callback);
  }

  /**
   * Get the kitchen sink information about a collection.
   *
   * @param {String} ns - The namespace.
   * @param {Function} callback - The callback.
   */
  collectionDetail(ns, callback) {
    async.parallel({
      stats: this.collectionStats.bind(this, this._databaseName(ns), this._collectionName(ns)),
      indexes: this.indexes.bind(this, ns)
    }, (error, coll) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, this._buildCollectionDetail(ns, coll));
    });
  }

  /**
   * List all collections for a database.
   *
   * @param {String} databaseName - The database name.
   * @param {Object} filter - The filter.
   * @param {Function} callback - The callback.
   */
  listCollections(databaseName, filter, callback) {
    var db = this._database(databaseName);
    db.listCollections(filter, {}).toArray((error, data) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, data);
    });
  }

  /**
   * List all databases on the currently connected instance.
   *
   * @param {Function} callback - The callback.
   */
  listDatabases(callback) {
    this.database.admin().command({'listDatabases': 1}, {}, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result.databases);
    });
  }

  /**
   * Get the stats for all collections in the database.
   *
   * @param {String} databaseName - The database name.
   * @param {Function} callback - The callback.
   */
  collections(databaseName, callback) {
    this.collectionNames(databaseName, (error, names) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      // Filter out system. collections.
      const filteredNames = _.filter(names, (name) => {
        return !name.startsWith(SYSTEM);
      });
      async.parallel(_.map(filteredNames, (name) => {
        return (done) => {
          this.collectionStats(databaseName, name, done);
        };
      }), callback);
    });
  }

  /**
   * Get all the collection names for a database.
   *
   * @param {String} databaseName - The database name.
   * @param {Function} callback - The callback.
   */
  collectionNames(databaseName, callback) {
    this.listCollections(databaseName, {}, (error, collections) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      var names = _.map(collections, (collection) => {
        return collection.name;
      });
      callback(null, names);
    });
  }

  /**
   * Get the currentOp.
   *
   * @param {Boolean} includeAll - if true also list currently idle operations in the result.
   * @param {Function} callback - The callback.
   */
  currentOp(includeAll, callback) {
    this.database.admin().command({'currentOp': 1, '$all': includeAll}, (error, result) => {
      if (error) {
        this._database('admin').collection('$cmd.sys.inprog').findOne({'$all': includeAll}, (error2, result2) => {
          if (error2) {
            return callback(this._translateMessage(error2));
          }
          callback(null, result2);
        });
        return;
      }
      callback(null, result);
    });
  }

  /**
   * Call serverStatus on the admin database.
   *
   * @param {Function} callback - The callback.
   */
  serverStats(callback) {
    this.database.admin().serverStatus((error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Call top on the admin database.
   *
   * @param {Function} callback - The callback.
   */
  top(callback) {
    this.database.admin().command({ 'top': 1 }, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Get the stats for a collection.
   *
   * @param {String} databaseName - The database name.
   * @param {String} collectionName - The collection name.
   * @param {Function} callback - The callback.
   */
  collectionStats(databaseName, collectionName, callback) {
    var db = this._database(databaseName);
    db.command({ collStats: collectionName, verbose: 1 }, (error, data) => {
      if (error && !error.message.includes(VIEW_ERROR)) {
        return callback(this._translateMessage(error));
      }
      callback(null, this._buildCollectionStats(databaseName, collectionName, data || { readonly: true }));
    });
  }

  /**
   * Creates a collection
   *
   * @param {String} ns - The namespace.
   * @param {Object} options - The options.
   * @param {Function} callback - The callback.
   */
  createCollection(ns, options, callback) {
    var collectionName = this._collectionName(ns);
    var db = this._database(this._databaseName(ns));
    db.createCollection(collectionName, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Creates an index
   *
   * @param {String} ns - The namespace.
   * @param {Object} spec - The index specification.
   * @param {Object} options - The options.
   * @param {Function} callback - The callback.
   */
  createIndex(ns, spec, options, callback) {
    this._collection(ns).createIndex(spec, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Get the kitchen sink information about a database and all its collections.
   *
   * @param {String} name - The database name.
   * @param {Function} callback - The callback.
   */
  databaseDetail(name, callback) {
    async.parallel({
      stats: this.databaseStats.bind(this, name),
      collections: this.collections.bind(this, name)
    }, (error, db) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, this._buildDatabaseDetail(name, db));
    });
  }

  /**
   * Get the stats for a database.
   *
   * @param {String} name - The database name.
   * @param {Function} callback - The callback.
   */
  databaseStats(name, callback) {
    var db = this._database(name);
    db.command({ dbStats: 1 }, (error, data) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, this._buildDatabaseStats(data));
    });
  }

  /**
   * Delete a single document from the collection.
   *
   * @param {String} ns - The namespace.
   * @param {Object} filter - The filter.
   * @param {Object} options - The options.
   * @param {Function} callback - The callback.
   */
  deleteOne(ns, filter, options, callback) {
    this._collection(ns).deleteOne(filter, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Deletes multiple documents from the collection.
   *
   * @param {String} ns - The namespace.
   * @param {Object} filter - The filter.
   * @param {Object} options - The options.
   * @param {Function} callback - The callback.
   */
  deleteMany(ns, filter, options, callback) {
    this._collection(ns).deleteMany(filter, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Disconnect the client.
   */
  disconnect() {
    this.database.close();
  }

  /**
   * Drops a collection from a database
   *
   * @param {String} ns - The namespace.
   * @param {Function} callback - The callback.
   */
  dropCollection(ns, callback) {
    this._collection(ns).drop((error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Drops a database
   *
   * @param {String} name - The database name.
   * @param {Function} callback - The callback.
   */
  dropDatabase(name, callback) {
    this._database(this._databaseName(name)).dropDatabase((error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Drops an index from a collection
   *
   * @param {String} ns - The namespace.
   * @param {String} name - The index name.
   * @param {Function} callback - The callback.
   */
  dropIndex(ns, name, callback) {
    this._collection(ns).dropIndex(name, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Execute an aggregation framework pipeline with the provided options on the
   * collection. For more details, see
   * http://mongodb.github.io/node-mongodb-native/2.2/api/Collection.html#aggregate
   *
   * @param {String} ns - The namespace to search on.
   * @param {Object} pipeline - The aggregation pipeline.
   * @param {Object} options - The aggregation options.
   * @param {Function} callback - The callback.
   * @return {(null|AggregationCursor)}
   */
  aggregate(ns, pipeline, options, callback) {
    return this._collection(ns).aggregate(pipeline, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Find documents for the provided filter and options on the collection.
   *
   * @param {String} ns - The namespace to search on.
   * @param {Object} filter - The filter.
   * @param {Object} options - The query options.
   * @param {Function} callback - The callback.
   */
  find(ns, filter, options, callback) {
    this._collection(ns).find(filter, options).toArray((error, documents) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, documents);
    });
  }

  /**
   * Find one document and replace it with the replacement.
   *
   * @param {String} ns - The namespace to search on.
   * @param {Object} filter - The filter.
   * @param {Object} replacement - The replacement doc.
   * @param {Object} options - The query options.
   * @param {Function} callback - The callback.
   */
  findOneAndReplace(ns, filter, replacement, options, callback) {
    this._collection(ns).findOneAndReplace(filter, replacement, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result.value);
    });
  }

  /**
   * Returns explain plan for the provided filter and options on the collection.
   *
   * @param {String} ns - The namespace to search on.
   * @param {Object} filter - The query filter.
   * @param {Object} options - The query options, namely the explain verbosity,
   *                           e.g. {verbosity: 'allPlansExecution'}.
   * @param {Function} callback - The callback function.
   */
  explain(ns, filter, options, callback) {
    // @todo thomasr: driver explain() does not yet support verbosity,
    // once it does, should be passed along from the options object.
    this._collection(ns).find(filter, options).explain((error, explanation) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, explanation);
    });
  }

  /**
   * Get the indexes for the collection.
   *
   * @param {String} ns - The collection namespace.
   * @param {Function} callback - The callback.
   */
  indexes(ns, callback) {
    getIndexes(this.database, ns, (error, data) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, data);
    });
  }

  /**
   * Insert a single document into the database.
   *
   * @param {String} ns - The namespace.
   * @param {Object} doc - The document to insert.
   * @param {Object} options - The options.
   * @param {Function} callback - The callback.
   */
  insertOne(ns, doc, options, callback) {
    this._collection(ns).insertOne(doc, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Inserts multiple documents into the database.
   *
   * @param {String} ns - The namespace.
   * @param {Array} docs - The documents to insert.
   * @param {Object} options - The options.
   * @param {Function} callback - The callback.
   */
  insertMany(ns, docs, options, callback) {
    this._collection(ns).insertMany(docs, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Get the current instance details.
   *
   * @param {function} callback - The callback function.
   */
  instance(callback) {
    getInstance(this.database, (error, data) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, this._buildInstance(data));
    });
  }

  /**
   * Sample documents from the collection.
   *
   * @param {String} ns - The namespace to sample.
   * @param {Object} options - The sampling options.
   *
   * @return {Stream} The sample stream.
   */
  sample(ns, options) {
    var db = this._database(this._databaseName(ns));
    return createSampleStream(db, this._collectionName(ns), options);
  }

  /**
   * Get the collection details for sharded collections.
   *
   * @param {String} ns - The full collection namespace.
   */
  shardedCollectionDetail(ns, callback) {
    this.collectionDetail(ns, (error, data) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      if (!data.sharded) {
        callback(null, data);
      } else {
        async.parallel(_.map(data.shards, (shardStats, shardName) => {
          return this._shardDistribution.bind(this, ns, shardName, data, shardStats);
        }), (err) => {
          if (err) {
            return callback(this._translateMessage(err));
          }
          callback(null, data);
        });
      }
    });
  }

  /**
   * Update a collection.
   *
   * @param {String} ns - The namespace.
   * @param {Object} flags - The flags.
   * @param {Function} callback - The callback.
   */
  updateCollection(ns, flags, callback) {
    var collectionName = this._collectionName(ns);
    var db = this._database(this._databaseName(ns));
    var collMod = { 'collMod': collectionName };
    var command = _.assignIn(collMod, flags);
    db.command(command, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Update a single document in the collection.
   *
   * @param {String} ns - The namespace.
   * @param {Object} filter - The filter.
   * @param {Object} update - The update.
   * @param {Object} options - The options.
   * @param {Function} callback - The callback.
   */
  updateOne(ns, filter, update, options, callback) {
    this._collection(ns).updateOne(filter, update, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Updates multiple documents in the database.
   *
   * @param {String} ns - The namespace.
   * @param {Object} filter - The filter.
   * @param {Object} update - The update.
   * @param {Object} options - The options.
   * @param {Function} callback - The callback.
   */
  updateMany(ns, filter, update, options, callback) {
    this._collection(ns).updateMany(filter, update, options, (error, result) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      callback(null, result);
    });
  }

  /**
   * Merges the shard distribution information into the collection detail.
   *
   * @param {String} ns - The namespace.
   * @param {String} shardName - The shard name.
   * @param {Object} detail - The collection detail.
   * @param {Object} shardStats - The shard stats to merge into.
   * @param {Function} callback - The callback.
   */
  _shardDistribution(ns, shardName, detail, shardStats, callback) {
    var configDb = this._database('config');
    configDb.collection('shards').findOne({ _id: shardName }, (error, shardDoc) => {
      if (error) {
        return callback(this._translateMessage(error));
      }
      configDb.collection('chunks').count({ ns: ns, shard: shardName }, (err, chunkCount) => {
        if (err) {
          return callback(this._translateMessage(err));
        }
        _.assign(shardStats, this._buildShardDistribution(detail, shardStats, shardDoc, chunkCount));
        callback(null);
      });
    });
  }

  /**
   * Builds the collection detail.
   *
   * @param {String} ns - The namespace.
   * @param {Object} data - The collection stats.
   *
   * @returns {Object} The collection detail.
   */
  _buildCollectionDetail(ns, data) {
    return _.assignIn(data.stats, {
      _id: ns,
      name: this._collectionName(ns),
      database: this._databaseName(ns),
      indexes: data.indexes
    });
  }

  /**
   * Build the shard distribution.
   *
   * @param {Object} detail - The collection details.
   * @param {Object} shardStats - The shard stats.
   * @param {Object} shardDoc - The shard doc.
   * @param {Integer} chunkCount - The chunk counts.
   */
  _buildShardDistribution(detail, shardStats, shardDoc, chunkCount) {
    return {
      host: shardDoc.host,
      shardData: shardStats.size,
      shardDocs: shardStats.count,
      estimatedDataPerChunk: shardStats.size / chunkCount,
      estimatedDocsPerChunk: Math.floor(shardStats.count / chunkCount),
      estimatedDataPercent: Math.floor(((shardStats.size / detail.size) || 0) * 10000) / 100,
      estimatedDocPercent: Math.floor(((shardStats.count / detail.count) || 0) * 10000) / 100
    };
  }

  /**
   * @todo: Durran: User JS style for keys, make builder.
   *
   * @param {String} databaseName - The name of the database.
   * @param {String} collectionName - The name of the collection.
   * @param {Object} data - The result of the collStats command.
   *
   * @return {Object} The collection stats.
   */
  _buildCollectionStats(databaseName, collectionName, data) {
    return {
      ns: databaseName + '.' + collectionName,
      name: collectionName,
      database: databaseName,
      is_capped: data.capped,
      max: data.max,
      is_power_of_two: data.userFlags === 1,
      index_sizes: data.indexSizes,
      document_count: data.count,
      document_size: data.size,
      storage_size: data.storageSize,
      index_count: data.nindexes,
      index_size: data.totalIndexSize,
      padding_factor: data.paddingFactor,
      extent_count: data.numExtents,
      extent_last_size: data.lastExtentSize,
      flags_user: data.userFlags,
      flags_system: data.systemFlags,
      max_document_size: data.maxSize,
      sharded: data.sharded || false,
      shards: data.shards || {},
      size: data.size,
      index_details: data.indexDetails || {},
      wired_tiger: data.wiredTiger || {},
      readonly: data.readonly || false
    };
  }

  /**
   * Builds the database detail.
   *
   * @param {String} name - The database name.
   * @param {Object} db - The database statistics.
   *
   * @returns {Object} The database detail.
   */
  _buildDatabaseDetail(name, db) {
    return {
      _id: name,
      name: name,
      stats: db.stats,
      collections: db.collections
    };
  }

  /**
   * @todo: Durran: User JS style for keys, make builder.
   *
   * @param {Object} data - The result of the dbStats command.
   *
   * @return {Object} The database stats.
   */
  _buildDatabaseStats(data) {
    return {
      document_count: data.objects,
      document_size: data.dataSize,
      storage_size: data.storageSize,
      index_count: data.indexes,
      index_size: data.indexSize,
      extent_count: data.numExtents,
      file_size: data.fileSize,
      ns_size: data.nsSizeMB * 1024 * 1024
    };
  }

  /**
   * Build the instance detail.
   *
   * @param {Object} data The data.
   *
   * @returns {Object} The instance detail.
   */
  _buildInstance(data) {
    return _.assignIn(data, {
      _id: `${this.model.hostname}:${this.model.port}`,
      hostname: this.model.hostname,
      port: this.model.port
    });
  }

  /**
   * Get the collection to operate on.
   *
   * @param {string} ns - The namespace.
   * @returns {Collection} The collection.
   */
  _collection(ns) {
    return this._database(this._databaseName(ns)).collection(this._collectionName(ns));
  }

  /**
   * Get the collection name from a namespace.
   *
   * @param {string} ns - The namespace in database.collection format.
   * @returns {string} The collection name.
   */
  _collectionName(ns) {
    return parseNamespace(ns).collection;
  }

  /**
   * Get the database name from a namespace.
   *
   * @param {string} ns - The namespace in database.collection format.
   * @returns {string} The database name.
   */
  _databaseName(ns) {
    return parseNamespace(ns).database;
  }

  /**
   * Get the database for the name.
   *
   * @param {String} name - The database name.
   *
   * @returns {DB} The database object.
   */
  _database(name) {
    return this.database.db(name);
  }

  /**
   * Determine if the ismaster response is for a writable server.
   *
   * @param {Object} ismaster - The ismaster response.
   *
   * @returns {Boolean} If the server is writable.
   */
  _isWritable(ismaster) {
    return ismaster.ismaster === true || this._isMongos(ismaster);
  }

  /**
   * Determine if we are connected to a mongos
   *
   * @param {Object} ismaster - The ismaster response.
   *
   * @returns {Boolean} If the server is a mongos.
   */
  _isMongos(ismaster) {
    return ismaster.msg === SHARDED;
  }

  /**
   * Translates the error message to something human readable.
   *
   * @param {Error} error - The error.
   *
   * @returns {Error} The error with message translated.
   */
  _translateMessage(error) {
    var mapping = translate(error);
    if (mapping) {
      error.message = mapping.message;
    }
    return error;
  }
}

module.exports = NativeClient;
