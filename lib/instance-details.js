const { ReadPreference } = require('mongodb');
const { isEnterprise, getGenuineMongoDB, getDataLake } = require('mongodb-build-info');
const { isNotAuthorized } = require('mongodb-js-errors');
const { get, union, unionBy } = require('lodash');
const toNS = require('mongodb-ns');
const util = require('util');

async function fetchInstanceDetails(client) {
  const adminDb = client.db('admin');

  const [
    connectionStatus,
    cmdLineOpts,
    rawHostInfo,
    rawBuildInfo,
    listedDatabases,
  ] = await Promise.all([
    adminDb.command({ connectionStatus: 1, showPrivileges: true }),
    adminDb.command({ getCmdLineOpts: 1 }).catch(ignoreNotAuthorized(null)),
    adminDb.command({ hostInfo: 1 }).catch(ignoreNotAuthorized({})),
    adminDb.command({ buildInfo: 1 }).catch(ignoreNotAuthorized({})),
    adminDb.command({ listDatabases: 1 }).catch(ignoreNotAuthorized(null))
  ]);

  const databases = await fetchDatabases(
    client,
    connectionStatus,
    listedDatabases
  );

  return {
    build: adaptBuildInfo(rawBuildInfo),
    dataLake: buildDataLakeInfo(rawBuildInfo),
    genuineMongoDB: buildGenuineMongoDBInfo(rawBuildInfo, cmdLineOpts),
    host: adaptHostInfo(rawHostInfo),
    databases: databases
  };
}

function isMongosLocalException(err) {
  if (!err) {
    return false;
  }
  var msg = err.message || err.err || JSON.stringify(err);
  return new RegExp('database through mongos').test(msg);
}

function ignoreNotAuthorized(fallback) {
  return (err) => {
    if (isNotAuthorized(err)) {
      debug('ignoring not authorized error and returning fallback value:', {err, fallback});
      return fallback;
    }

    return Promise.reject(err)
  };
}

function ignoreMongosLocalException(fallback) {
  return (err) => {
    if (isMongosLocalException(err)) {
      debug('ignoring mongos action on local db error and returning fallback value:', {
        err,
        fallback
      });
      return fallback;
    }

    return Promise.reject(err)
  };
}

function adaptHostInfo(rawHostInfo) {
  return {
    system_time: get(rawHostInfo, 'system.currentTime'),
    hostname: get(rawHostInfo, 'system.hostname') || 'unknown',
    os: get(rawHostInfo, 'os.name'),
    os_family: (get(rawHostInfo, 'os.type') || '').toLowerCase(),
    kernel_version: get(rawHostInfo, 'os.version'),
    kernel_version_string: get(rawHostInfo, 'extra.versionString'),
    memory_bits:
      parseInt(get(rawHostInfo, 'system.memSizeMB') || 0, 10) * 1024 * 1024,
    memory_page_size: get(rawHostInfo, 'extra.pageSize'),
    arch: get(rawHostInfo, 'system.cpuArch'),
    cpu_cores: get(rawHostInfo, 'system.numCores'),
    cpu_cores_physical: get(rawHostInfo, 'extra.physicalCores'),
    cpu_scheduler: get(rawHostInfo, 'extra.scheduler'),
    cpu_frequency:
      parseInt(get(rawHostInfo, 'extra.cpuFrequencyMHz') || 0, 10) * 1000000,
    cpu_string: get(rawHostInfo, 'extra.cpuString'),
    cpu_bits: get(rawHostInfo, 'system.cpuAddrSize'),
    machine_model: get(rawHostInfo, 'extra.model'),
    feature_numa: get(rawHostInfo, 'system.numaEnabled'),
    feature_always_full_sync: get(rawHostInfo, 'extra.alwaysFullSync'),
    feature_nfs_async: get(rawHostInfo, 'extra.nfsAsync')
  };
}

function adaptBuildInfo(rawBuildInfo) {
  return {
    version: rawBuildInfo.version,
    commit: rawBuildInfo.gitVersion,
    commit_url: rawBuildInfo.gitVersion ?
      `https://github.com/mongodb/mongo/commit/${rawBuildInfo.gitVersion}` : '',
    flags_loader: rawBuildInfo.loaderFlags,
    flags_compiler: rawBuildInfo.compilerFlags,
    allocator: rawBuildInfo.allocator,
    javascript_engine: rawBuildInfo.javascriptEngine,
    debug: rawBuildInfo.debug,
    for_bits: rawBuildInfo.bits,
    max_bson_object_size: rawBuildInfo.maxBsonObjectSize,

    // Cover both cases of detecting enterprise module, see SERVER-18099.
    enterprise_module: isEnterprise(rawBuildInfo),
    query_engine: rawBuildInfo.queryEngine ? rawBuildInfo.queryEngine : null
  };
}

function buildGenuineMongoDBInfo(buildInfo, cmdLineOpts) {
  const {
    isGenuine,
    serverName
  } = getGenuineMongoDB(buildInfo, cmdLineOpts);

  return {
    isGenuine,
    dbType: serverName
  };
}

function buildDataLakeInfo(buildInfo) {
  const { isDataLake, dlVersion } = getDataLake(buildInfo);

  return {
    isDataLake,
    version: dlVersion
  };
}

async function fetchDatabases(client, connectionStatus, listedDatabases) {

  const privileges = extractPrivilegesByDatabaseAndCollection(connectionStatus);
  const databaseNames = getDatabaseNames(
    client,
    listedDatabases,
    privileges
  );

  const databases = (
    await Promise.all(
      databaseNames.map((name) => fetchDatabase(client, name, privileges))
    )
  )
    .filter(Boolean)
    .filter(({ name }) => name);

  return databases;
}

function extractPrivilegesByDatabaseAndCollection(connectionStatus) {
  const privileges = get(
    connectionStatus,
    'authInfo.authenticatedUserPrivileges', []);

  const databases = {};

  for (const privilege of privileges) {
    const {db, collection} = (privilege || {}).resource || {};
    databases[db] = {[collection || '']: privilege.actions || []};
  }

  return databases;
}

function getDatabaseNames(
  client,
  listedDatabases,
  privileges
) {
  const connectionDatabase = get(client, 's.options.dbName', 'test');

  const listedDatabaseNames = (
    (listedDatabases || {}).databases || []
  ).map(({name}) => name);

  // we pull in the database names listed among the user privileges.
  // this accounts for situations where a user would not have rights to listDatabases
  // on the cluster but is authorized to perform actions on specific databases.
  const databasesFromPrivileges = Object.keys(privileges);

  return union(
    [connectionDatabase],
    listedDatabaseNames,
    databasesFromPrivileges
  )
  .filter(
    (databaseName) => (
      !!databaseName &&
      !isSystemDatabase(databaseName)
    )
  );
}

async function fetchDatabase(client, dbName, privileges = {}) {
  const db = client.db(dbName);

  /**
   * @note: Durran: For some reason the listCollections call does not take into
   *  account the read preference that was set on the db instance - it only looks
   *  in the passed options: https://github.com/mongodb/node-mongodb-native/blob/2.2/lib/db.js#L671
   */
  const readPreference = get(db, 's.readPreference', ReadPreference.PRIMARY);

  const [database, rawCollections] = await Promise.all([
    db.command({ dbStats: 1 })
      .catch(ignoreNotAuthorized({
        db: dbName
      }))
      .then(adaptDatabaseInfo),

    db.listCollections({}, { readPreference })
      .toArray()
      .catch(ignoreNotAuthorized([]))
      .catch(ignoreMongosLocalException([]))
  ]);

  const listedCollections = rawCollections
    .map((rawCollection) => ({ db: dbName, ...rawCollection }))

  const collectionsFromPrivileges =
    Object.keys(privileges[dbName] || {})
      .filter(Boolean)
      .filter((name) => !isSystemCollection(name))
      .map((name) => ({
        db: dbName,
        name
      }));

  const collections = unionBy(
    listedCollections,
    collectionsFromPrivileges,
    'name'
  )
    .filter(Boolean)
    .filter(({name, db}) => name && db)
    .map(adaptCollectionInfo);

  return {
    ...database,
    collections
  };
}

function isSystemCollection(name) {
  return name.startsWith('system.');
}

function isSystemDatabase(name) {
  return name === 'config' ||
    name === 'local' ||
    name === 'admin'
}

function adaptDatabaseInfo(databaseStats = {}) {
  return {
    _id: databaseStats.db,
    name: databaseStats.db,
    document_count: databaseStats.objects || 0,
    storage_size: databaseStats.storageSize || 0,
    index_count: databaseStats.indexes || 0,
    index_size: databaseStats.indexSize || 0
  };
}

function adaptCollectionInfo(rawCollectionInfo) {
  const ns = toNS(rawCollectionInfo.db + '.' + rawCollectionInfo.name);
  return {
    _id: ns.toString(),
    name: ns.collection,
    database: ns.database,
    readonly: get(rawCollectionInfo, 'info.readOnly', false),
    collation: get(rawCollectionInfo, 'options.collation', null),
    type: get(rawCollectionInfo, 'type', 'collection'),
    view_on: get(rawCollectionInfo, 'options.viewOn', undefined),
    pipeline: get(rawCollectionInfo, 'options.pipeline', undefined)
  };
}

module.exports = {
  getInstance: util.callbackify(fetchInstanceDetails)
};
