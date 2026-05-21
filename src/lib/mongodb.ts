import { MongoClient, type Db } from "mongodb";

const globalMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

function getMongoClientPromise(): Promise<MongoClient> {
  if (globalMongo._mongoClientPromise) {
    return globalMongo._mongoClientPromise;
  }

  const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO;
  if (!mongoUri) {
    return Promise.reject(
      new Error("Missing MongoDB connection string. Set MONGODB_URI or MONGO."),
    );
  }

  const promise = new MongoClient(mongoUri, {
    tls: true,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  }).connect();

  globalMongo._mongoClientPromise = promise;
  return promise;
}

export async function getDatabase(): Promise<Db> {
  const client = await getMongoClientPromise();
  const configuredDatabase = process.env.MONGODB_DB;

  if (configuredDatabase) {
    return client.db(configuredDatabase);
  }

  return client.db();
}
