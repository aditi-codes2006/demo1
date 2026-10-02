import mongoose from 'mongoose';
import { config } from '../config/index.js';

export async function connectDb() {
  if (config.useMemoryDb) {
    console.log('[db] MONGODB_URI not set — using in-memory store (dev/test mode).');
    return;
  }
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log('[db] Connected to MongoDB.');
  } catch (err) {
    console.error('[db] Failed to connect to MongoDB, falling back to in-memory store:', err.message);
    config.useMemoryDb = true;
  }
}
