import { getLlmProvider } from '../llm/provider.js';

export async function evaluateAnswer({ question, answer, resume, interviewType, difficulty, primaryTopic }) {
  const llm = getLlmProvider();
  const result = await llm.evaluateAnswer({
    question: question.text,
    topic: question.topic,
    stage: question.stage,
    answer,
    resume: resume.parsed,
    interviewType,
    difficulty,
    primaryTopic,
  });

  // Defensive defaults in case a provider returns a partial/malformed object —
  // keeps the orchestrator's decision logic from breaking on bad LLM output.
  return {
    score: typeof result.score === 'number' ? result.score : 5,
    feedback: result.feedback || '',
    strengths: Array.isArray(result.strengths) ? result.strengths : [],
    gaps: Array.isArray(result.gaps) ? result.gaps : [],
    understandingLevel: ['shallow', 'moderate', 'deep'].includes(result.understandingLevel)
      ? result.understandingLevel
      : 'moderate',
    suggestedDecision: ['FOLLOW_UP', 'NEW_TOPIC'].includes(result.suggestedDecision)
      ? result.suggestedDecision
      : 'NEW_TOPIC',
  };
}
