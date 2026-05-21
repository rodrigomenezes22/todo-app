import { MongoClient, type Db } from "mongodb";

const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO;

if (!mongoUri) {
  throw new Error(
    "Missing MongoDB connection string. Set MONGODB_URI or MONGO.",
  );
}

const globalMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

const mongoClientPromise =
  globalMongo._mongoClientPromise ??
  new MongoClient(mongoUri, {
    tls: true,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  }).connect();

globalMongo._mongoClientPromise = mongoClientPromise;

export async function getDatabase(): Promise<Db> {
  const client = await mongoClientPromise;
  const configuredDatabase = process.env.MONGODB_DB;

  if (configuredDatabase) {
    return client.db(configuredDatabase);
  }

  return client.db();
}
