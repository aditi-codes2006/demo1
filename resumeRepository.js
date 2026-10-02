import { config } from '../../config/index.js';
import { memoryStore } from '../memory/memoryStore.js';
import ResumeModel from '../../models/Resume.js';

const COLLECTION = 'resumes';

export const resumeRepository = {
  async create({ fileName, rawText }) {
    if (config.useMemoryDb) {
      const doc = memoryStore.insert(COLLECTION, {
        fileName,
        rawText,
        parsed: null,
        status: 'uploaded',
      });
      return normalize(doc);
    }
    const doc = await ResumeModel.create({ fileName, rawText, status: 'uploaded' });
    return normalize(doc.toObject());
  },

  async findById(id) {
    if (config.useMemoryDb) {
      const doc = memoryStore.findById(COLLECTION, id);
      return doc ? normalize(doc) : null;
    }
    const doc = await ResumeModel.findById(id).lean();
    return doc ? normalize(doc) : null;
  },

  async saveParsedData(id, parsed) {
    if (config.useMemoryDb) {
      const doc = memoryStore.update(COLLECTION, id, { parsed, status: 'parsed' });
      return doc ? normalize(doc) : null;
    }
    const doc = await ResumeModel.findByIdAndUpdate(
      id,
      { parsed, status: 'parsed' },
      { new: true }
    ).lean();
    return doc ? normalize(doc) : null;
  },

  async markFailed(id) {
    if (config.useMemoryDb) {
      return memoryStore.update(COLLECTION, id, { status: 'failed' });
    }
    return ResumeModel.findByIdAndUpdate(id, { status: 'failed' }, { new: true }).lean();
  },
};

// Ensures both Mongo (_id as ObjectId) and memory (_id as uuid string) docs
// expose a consistent shape to the rest of the app.
function normalize(doc) {
  return { ...doc, id: String(doc._id) };
}
