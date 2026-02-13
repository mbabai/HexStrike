import { randomUUID } from 'crypto';
import { Collection, MongoClient } from 'mongodb';
import { ReplayDoc } from '../types';
import { MemoryDb } from './memoryDb';

const LOG_PREFIX = '[hexstrike]';
const DEFAULT_DB_NAME = 'HexStrike';
const DEFAULT_COLLECTION_NAME = 'games';
const DEFAULT_LOCAL_URI = 'mongodb://localhost:27017';
const MAX_LIST_LIMIT = 500;

type ReplayCreatePayload = Omit<ReplayDoc, 'id' | 'createdAt' | 'updatedAt'>;

type StoreMode = 'mongo' | 'memory';

interface MongoReplayDoc extends ReplayDoc {
  _id?: unknown;
}

const normalizeString = (value: unknown): string => `${value ?? ''}`.trim();

const resolveEnvValue = (...keys: string[]): string => {
  for (const key of keys) {
    const value = normalizeString(process.env[key]);
    if (value) return value;
  }
  return '';
};

const toDate = (value: unknown, fallback: Date): Date => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return fallback;
};

const toReplayDoc = (doc: MongoReplayDoc): ReplayDoc => {
  const now = new Date();
  return {
    id: normalizeString(doc.id),
    sourceGameId: normalizeString(doc.sourceGameId),
    sourceMatchId: normalizeString(doc.sourceMatchId) || undefined,
    players: Array.isArray(doc.players) ? doc.players : [],
    matchOutcome: doc.matchOutcome,
    sharePath: normalizeString(doc.sharePath) || undefined,
    state: doc.state,
    createdAt: toDate(doc.createdAt, now),
    updatedAt: toDate(doc.updatedAt, now),
  };
};

const buildSharePath = (id: string) => `/?g=${encodeURIComponent(id)}`;

export class GameHistoryStore {
  private readonly fallbackDb: MemoryDb;

  private readonly dbName: string;

  private readonly collectionName: string;

  private readonly nodeEnv: string;

  private readonly localUri: string;

  private readonly prodUri: string;

  private readonly localUriSource: string;

  private readonly prodUriSource: string;

  private client: MongoClient | null = null;

  private collection: Collection<MongoReplayDoc> | null = null;

  private initializePromise: Promise<void> | null = null;

  private mode: StoreMode = 'memory';

  constructor(fallbackDb: MemoryDb) {
    this.fallbackDb = fallbackDb;
    this.dbName = normalizeString(process.env.MONGODB_DB_NAME) || DEFAULT_DB_NAME;
    this.collectionName = normalizeString(process.env.MONGODB_GAMES_COLLECTION) || DEFAULT_COLLECTION_NAME;
    this.nodeEnv = normalizeString(process.env.NODE_ENV).toLowerCase() || 'development';
    this.localUri =
      resolveEnvValue('MONGODB_LOCAL_URI', 'MONGODB_DEV_URI', 'MONGODB_URI_LOCAL') || DEFAULT_LOCAL_URI;
    this.prodUri = resolveEnvValue(
      'MONGODB_PROD_URI',
      'MONGODB_ATLAS_CONNECTION_STRING',
      'MONGODB_ATLAS_URI',
      'MONGODB_URI',
      'MongoDB-Atlas-ConnectionString',
    );
    this.localUriSource = resolveEnvValue('MONGODB_LOCAL_URI')
      ? 'MONGODB_LOCAL_URI'
      : resolveEnvValue('MONGODB_DEV_URI')
        ? 'MONGODB_DEV_URI'
        : resolveEnvValue('MONGODB_URI_LOCAL')
          ? 'MONGODB_URI_LOCAL'
          : 'default';
    this.prodUriSource = resolveEnvValue('MONGODB_PROD_URI')
      ? 'MONGODB_PROD_URI'
      : resolveEnvValue('MONGODB_ATLAS_CONNECTION_STRING')
        ? 'MONGODB_ATLAS_CONNECTION_STRING'
        : resolveEnvValue('MONGODB_ATLAS_URI')
          ? 'MONGODB_ATLAS_URI'
          : resolveEnvValue('MONGODB_URI')
            ? 'MONGODB_URI'
            : resolveEnvValue('MongoDB-Atlas-ConnectionString')
              ? 'MongoDB-Atlas-ConnectionString'
              : 'unset';
  }

  getMode(): StoreMode {
    return this.mode;
  }

  private resolveMongoUri(): string {
    if (this.nodeEnv === 'production') {
      return this.prodUri;
    }
    return this.localUri;
  }

  private async initializeMongo(): Promise<void> {
    const uri = this.resolveMongoUri();
    if (!uri) {
      console.warn(`${LOG_PREFIX} game-history:mongo skipped (missing URI), using memory store`);
      this.mode = 'memory';
      return;
    }
    try {
      this.client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 4000,
      } as any);
      await this.client.connect();
      const db = this.client.db(this.dbName);
      const existing = await db
        .listCollections({ name: this.collectionName }, { nameOnly: true })
        .toArray();
      if (!existing.length) {
        await db.createCollection(this.collectionName);
      }
      this.collection = db.collection<MongoReplayDoc>(this.collectionName);
      await this.collection.createIndex({ id: 1 }, { unique: true });
      await this.collection.createIndex({ sourceGameId: 1 }, { unique: true });
      await this.collection.createIndex({ createdAt: -1 });
      this.mode = 'mongo';
      console.log(
        `${LOG_PREFIX} game-history:mongo connected (${this.nodeEnv}) db=${this.dbName} collection=${this.collectionName} uriSource=${this.nodeEnv === 'production' ? this.prodUriSource : this.localUriSource}`,
      );
    } catch (err) {
      this.client = null;
      this.collection = null;
      this.mode = 'memory';
      const message = err instanceof Error ? err.message : `${err}`;
      console.warn(`${LOG_PREFIX} game-history:mongo unavailable (${message}), using memory store`);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeMongo();
    }
    await this.initializePromise;
  }

  private async findMongoById(id: string): Promise<ReplayDoc | undefined> {
    if (!this.collection) return undefined;
    const doc = await this.collection.findOne({ id });
    return doc ? toReplayDoc(doc) : undefined;
  }

  private async findMongoByGameId(sourceGameId: string): Promise<ReplayDoc | undefined> {
    if (!this.collection) return undefined;
    const doc = await this.collection.findOne({ sourceGameId });
    return doc ? toReplayDoc(doc) : undefined;
  }

  async findReplay(id: string): Promise<ReplayDoc | undefined> {
    const replayId = normalizeString(id);
    if (!replayId) return undefined;
    await this.ensureInitialized();
    if (this.mode === 'mongo') {
      const mongoReplay = await this.findMongoById(replayId);
      if (mongoReplay) return mongoReplay;
    }
    return this.fallbackDb.findReplay(replayId);
  }

  async findReplayByGameId(gameId: string): Promise<ReplayDoc | undefined> {
    const sourceGameId = normalizeString(gameId);
    if (!sourceGameId) return undefined;
    await this.ensureInitialized();
    if (this.mode === 'mongo') {
      const mongoReplay = await this.findMongoByGameId(sourceGameId);
      if (mongoReplay) return mongoReplay;
    }
    return this.fallbackDb.findReplayByGameId(sourceGameId);
  }

  async listReplays(limit = 200): Promise<ReplayDoc[]> {
    const safeLimit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit || 1)));
    await this.ensureInitialized();
    if (this.mode === 'mongo' && this.collection) {
      const docs = await this.collection
        .find({}, { sort: { createdAt: -1 }, limit: safeLimit })
        .toArray();
      return docs.map((doc) => toReplayDoc(doc));
    }
    return this.fallbackDb.listReplays(safeLimit);
  }

  async createReplay(payload: ReplayCreatePayload): Promise<ReplayDoc> {
    await this.ensureInitialized();
    if (this.mode === 'mongo' && this.collection) {
      const existing = await this.findMongoByGameId(payload.sourceGameId);
      if (existing) return existing;
      const now = new Date();
      const id = randomUUID();
      const replay: ReplayDoc = {
        ...payload,
        id,
        sharePath: normalizeString(payload.sharePath) || buildSharePath(id),
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.collection.insertOne(replay);
        return replay;
      } catch (err) {
        const duplicate = (err as { code?: number } | null)?.code === 11000;
        if (duplicate) {
          const winner = await this.findMongoByGameId(payload.sourceGameId);
          if (winner) return winner;
        }
        throw err;
      }
    }
    const created = await this.fallbackDb.createReplay(payload);
    if (!created.sharePath) {
      created.sharePath = buildSharePath(created.id);
      created.updatedAt = new Date();
    }
    return created;
  }
}
