import { config } from '../../config/index.js';
import { memoryStore } from '../memory/memoryStore.js';
import InterviewModel from '../../models/Interview.js';

const COLLECTION = 'interviews';

const defaults = {
  status: 'in_progress',
  questionNumber: 0,
  currentTopic: '',
  primaryTopic: null,
  stageIndex: 0,
  currentQuestion: null,
  questions: [],
  answers: [],
  evaluations: [],
  detectedKnowledgeGaps: [],
  coveredTopics: [],
  followUpCountForCurrentStage: 0,
  finalReport: null,
  reportGeneratedAt: null,
};

export const interviewRepository = {
  async create({ resumeId, interviewType, difficulty }) {
    if (config.useMemoryDb) {
      const doc = memoryStore.insert(COLLECTION, {
        resumeId,
        interviewType,
        difficulty,
        ...defaults,
      });
      return normalize(doc);
    }
    const doc = await InterviewModel.create({ resumeId, interviewType, difficulty });
    return normalize(doc.toObject());
  },

  async findById(id) {
    if (config.useMemoryDb) {
      const doc = memoryStore.findById(COLLECTION, id);
      return doc ? normalize(doc) : null;
    }
    const doc = await InterviewModel.findById(id).lean();
    return doc ? normalize(doc) : null;
  },

  async update(id, patch) {
    if (config.useMemoryDb) {
      const doc = memoryStore.update(COLLECTION, id, patch);
      return doc ? normalize(doc) : null;
    }
    const doc = await InterviewModel.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? normalize(doc) : null;
  },
};

function normalize(doc) {
  return { ...doc, id: String(doc._id) };
}
