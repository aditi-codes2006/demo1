import mongoose from 'mongoose';

const QuestionSchema = new mongoose.Schema(
  {
    index: Number,
    text: String,
    topic: String,
    targetSkill: String,
    stage: String, // one of QUESTION_STAGES — which depth-stage this question targets
    decisionType: { type: String, enum: ['FIRST', 'FOLLOW_UP', 'NEW_TOPIC'] },
  },
  { _id: false }
);

const AnswerSchema = new mongoose.Schema(
  {
    questionIndex: Number,
    text: String,
  },
  { _id: false }
);

const EvaluationSchema = new mongoose.Schema(
  {
    questionIndex: Number,
    score: Number,
    feedback: String,
    strengths: [String],
    gaps: [String],
    understandingLevel: { type: String, enum: ['shallow', 'moderate', 'deep'] },
    suggestedDecision: { type: String, enum: ['FOLLOW_UP', 'NEW_TOPIC'] },
  },
  { _id: false }
);

const InterviewSchema = new mongoose.Schema(
  {
    resumeId: { type: String, required: true },
    interviewType: { type: String, required: true },
    difficulty: { type: String, required: true },
    status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
    questionNumber: { type: Number, default: 0 },
    currentTopic: { type: String, default: '' },
    // The single resume entity (project/experience/skill) the whole
    // interview is anchored on — selected once at start, reused every turn.
    primaryTopic: { type: mongoose.Schema.Types.Mixed, default: null },
    stageIndex: { type: Number, default: 0 },
    currentQuestion: { type: QuestionSchema, default: null },
    questions: { type: [QuestionSchema], default: [] },
    answers: { type: [AnswerSchema], default: [] },
    evaluations: { type: [EvaluationSchema], default: [] },
    detectedKnowledgeGaps: { type: [String], default: [] },
    coveredTopics: { type: [String], default: [] },
    followUpCountForCurrentStage: { type: Number, default: 0 },
    finalReport: { type: mongoose.Schema.Types.Mixed, default: null },
    reportGeneratedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Interview', InterviewSchema);
