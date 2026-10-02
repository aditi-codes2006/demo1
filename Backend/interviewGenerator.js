import { getLlmProvider } from '../llm/provider.js';
import { selectPrimaryTopic } from './topicSelector.js';
import { QUESTION_STAGES } from '../constants/interviewOptions.js';

// Builds a compact history array the LLM can use to understand how the
// candidate has answered so far (so follow-ups reference the actual answer,
// not just the topic name).
function buildHistory(interview) {
  return interview.questions.map((q, idx) => ({
    questionIndex: q.index,
    questionText: q.text,
    stage: q.stage,
    answerText: interview.answers.find((a) => a.questionIndex === idx)?.text || null,
    evaluation: interview.evaluations.find((e) => e.questionIndex === idx) || null,
  }));
}

export async function generateFirstQuestion({ resume, interviewType, difficulty }) {
  const llm = getLlmProvider();
  const primaryTopic = selectPrimaryTopic(resume);
  const stage = QUESTION_STAGES[0];

  const result = await llm.generateQuestion({
    resume: resume.parsed,
    interviewType,
    difficulty,
    primaryTopic,
    stage,
    decision: 'FIRST',
    lastEvaluation: null,
    lastAnswerText: null,
    history: [],
  });

  return { ...result, decisionType: 'FIRST', stage, primaryTopic };
}

export async function generateNextQuestion({ resume, interview, decision, lastEvaluation, lastAnswerText }) {
  const llm = getLlmProvider();
  const primaryTopic = interview.primaryTopic;

  // decision === 'FOLLOW_UP' -> stay on the same stage, probe deeper.
  // decision === 'NEW_TOPIC' -> advance to the next stage in the progression
  // (still the SAME primary topic — this is depth progression, not a topic
  // switch, per the product requirement that the whole interview walk
  // resume → project → technology → implementation → weakness → system design).
  const currentStageIndex = interview.stageIndex;
  const nextStageIndex =
    decision === 'FOLLOW_UP' ? currentStageIndex : Math.min(currentStageIndex + 1, QUESTION_STAGES.length - 1);
  const stage = QUESTION_STAGES[nextStageIndex];

  const result = await llm.generateQuestion({
    resume: resume.parsed,
    interviewType: interview.interviewType,
    difficulty: interview.difficulty,
    primaryTopic,
    stage,
    decision,
    lastEvaluation,
    lastAnswerText,
    history: buildHistory(interview),
  });

  return { ...result, decisionType: decision, stage, stageIndex: nextStageIndex, primaryTopic };
}
