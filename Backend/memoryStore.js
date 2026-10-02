import { randomUUID } from 'crypto';

// Simple in-process collection store, keyed by collection name.
// Mirrors just enough of a Mongo-like API for our repositories to use.
const collections = new Map();

function getCollection(name) {
  if (!collections.has(name)) collections.set(name, new Map());
  return collections.get(name);
}

export const memoryStore = {
  insert(collectionName, doc) {
    const col = getCollection(collectionName);
    const _id = randomUUID();
    const now = new Date();
    const record = { _id, ...doc, createdAt: now, updatedAt: now };
    col.set(_id, record);
    return record;
  },

  findById(collectionName, id) {
    const col = getCollection(collectionName);
    return col.get(id) || null;
  },

  update(collectionName, id, patch) {
    const col = getCollection(collectionName);
    const existing = col.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date() };
    col.set(id, updated);
    return updated;
  },

  // exposed for debugging/tests only
  _dump(collectionName) {
    return Array.from(getCollection(collectionName).values());
  },
};
