import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockProvider } from '../src/llm/mockProvider.js';
import { generateFinalReport } from '../src/services/reportGenerator.js';

const PRIMARY_TOPIC = {
  kind: 'project',
  name: 'AI College Assistant',
  description: 'React + Gemini API chatbot for student queries',
  techStack: ['React', 'Gemini'],
};

const STRONG_ANSWER =
  'I built the AI College Assistant using React on the frontend and the Gemini API on the backend, ' +
  'because it let students ask free-form questions about deadlines and courses without needing a rigid menu. ' +
  'The core problem was that students couldn\'t quickly find scattered information across multiple college portals.';

const WEAK_ANSWER = 'idk it just worked fine';

test('1. weak vs strong answers produce meaningfully different scores', async () => {
  const strong = await mockProvider.evaluateAnswer({
    answer: STRONG_ANSWER,
    question: 'Walk me through your AI College Assistant project.',
    topic: PRIMARY_TOPIC.name,
    stage: 'UNDERSTANDING',
    primaryTopic: PRIMARY_TOPIC,
  });
  const weak = await mockProvider.evaluateAnswer({
    answer: WEAK_ANSWER,
    question: 'Walk me through your AI College Assistant project.',
    topic: PRIMARY_TOPIC.name,
    stage: 'UNDERSTANDING',
    primaryTopic: PRIMARY_TOPIC,
  });
  assert.ok(strong.score >= 7.5, `expected strong answer score >= 7.5, got ${strong.score}`);
  assert.ok(weak.score <= 5, `expected weak answer score <= 5, got ${weak.score}`);
  assert.ok(strong.score - weak.score >= 3, 'expected a substantial score gap between weak and strong answers');
  // No fixed 8.0 fallback: a genuinely strong answer isn't clamped to exactly 8.
  assert.notEqual(strong.score, 8);
});

test('2. different answers produce different feedback text', async () => {
  const a = await mockProvider.evaluateAnswer({
    answer: STRONG_ANSWER,
    question: 'Walk me through your AI College Assistant project.',
    topic: PRIMARY_TOPIC.name,
    stage: 'UNDERSTANDING',
    primaryTopic: PRIMARY_TOPIC,
  });
  const b = await mockProvider.evaluateAnswer({
    answer: WEAK_ANSWER,
    question: 'Walk me through your AI College Assistant project.',
    topic: PRIMARY_TOPIC.name,
    stage: 'UNDERSTANDING',
    primaryTopic: PRIMARY_TOPIC,
  });
  assert.notEqual(a.feedback, b.feedback);
  assert.doesNotMatch(a.feedback, /^Clear, well-reasoned answer, with concrete detail\.$/);
});

test('3. a weak answer creates a topic-specific knowledge gap (not a generic string)', async () => {
  const result = await mockProvider.evaluateAnswer({
    answer: WEAK_ANSWER,
    question: 'Suppose this had to support 10,000 concurrent users — what would break first?',
    topic: PRIMARY_TOPIC.name,
    stage: 'SYSTEM_DESIGN',
    primaryTopic: PRIMARY_TOPIC,
  });
  assert.ok(result.gaps.length > 0, 'expected at least one gap for a weak answer');
  assert.match(result.gaps[0], /AI College Assistant/);
  // SYSTEM_DESIGN + a Gemini/LLM-flavored topic should surface domain-specific
  // scalability concepts, not a generic "needs more detail" gap.
  assert.match(result.gaps[0], /rate limit|caching|bottleneck/i);
});

test('6. identical canned feedback is not returned across multiple different questions', async () => {
  const answers = [
    STRONG_ANSWER,
    WEAK_ANSWER,
    'I chose Gemini because it handled natural language well, though I also considered a simpler keyword search approach, but that would not have handled paraphrased questions as well.',
    'react is a frontend library',
  ];
  const feedbacks = [];
  for (const answer of answers) {
    const result = await mockProvider.evaluateAnswer({
      answer,
      question: 'Tell me more.',
      topic: PRIMARY_TOPIC.name,
      stage: 'TECHNICAL_DECISION',
      primaryTopic: PRIMARY_TOPIC,
    });
    feedbacks.push(result.feedback);
  }
  assert.equal(new Set(feedbacks).size, feedbacks.length, `expected all distinct feedback, got: ${JSON.stringify(feedbacks)}`);
});

function buildMixedInterview() {
  const questions = [
    { index: 0, text: 'Walk me through it.', topic: PRIMARY_TOPIC.name, stage: 'UNDERSTANDING', decisionType: 'FIRST' },
    { index: 1, text: 'Why Gemini?', topic: PRIMARY_TOPIC.name, stage: 'TECHNICAL_DECISION', decisionType: 'NEW_TOPIC' },
    { index: 2, text: 'Biggest challenge?', topic: PRIMARY_TOPIC.name, stage: 'CHALLENGE', decisionType: 'NEW_TOPIC' },
  ];
  const answers = [
    { questionIndex: 0, text: STRONG_ANSWER },
    { questionIndex: 1, text: WEAK_ANSWER },
    { questionIndex: 2, text: 'not sure, maybe more testing' },
  ];
  const evaluations = [
    { questionIndex: 0, score: 8.7, feedback: 'Strong answer.', strengths: ['clear reasoning'], gaps: [], understandingLevel: 'deep', suggestedDecision: 'NEW_TOPIC' },
    { questionIndex: 1, score: 2.5, feedback: 'Too brief.', strengths: [], gaps: ['AI College Assistant: limited discussion of trade-offs, limitations, concrete implementation detail.'], understandingLevel: 'shallow', suggestedDecision: 'FOLLOW_UP' },
    { questionIndex: 2, score: 2.8, feedback: 'Too brief.', strengths: [], gaps: ['AI College Assistant: limited discussion of trade-offs, limitations, concrete implementation detail.'], understandingLevel: 'shallow', suggestedDecision: 'FOLLOW_UP' },
  ];
  return {
    id: 'test-interview',
    resumeId: 'test-resume',
    interviewType: 'ProjectDeepDive',
    difficulty: 'Medium',
    status: 'completed',
    questions,
    answers,
    evaluations,
    detectedKnowledgeGaps: evaluations.flatMap((e) => e.gaps),
    coveredTopics: [PRIMARY_TOPIC.name],
    primaryTopic: PRIMARY_TOPIC,
  };
}

function buildResume() {
  return {
    id: 'test-resume',
    status: 'parsed',
    parsed: {
      name: 'Test Candidate',
      skills: ['React', 'Gemini'],
      projects: [{ name: PRIMARY_TOPIC.name, description: PRIMARY_TOPIC.description, techStack: PRIMARY_TOPIC.techStack }],
      experience: [],
    },
  };
}

test('4. project assessment is populated using the actual resume project discussed', async () => {
  const report = await generateFinalReport({ interview: buildMixedInterview(), resume: buildResume() });
  assert.equal(report.projectAssessment.length, 1);
  assert.equal(report.projectAssessment[0].project, 'AI College Assistant');
  assert.ok(report.projectAssessment[0].understandingScore > 0);
  assert.ok(report.projectAssessment[0].assessment.length > 0);
});

test('5. recommendations reflect actual detected weaknesses', async () => {
  const report = await generateFinalReport({ interview: buildMixedInterview(), resume: buildResume() });
  assert.ok(report.recommendations.length > 0);
  const allText = JSON.stringify(report.recommendations).toLowerCase();
  assert.match(allText, /ai college assistant/);
  // Should not be the generic "solid performance, no gaps" placeholder given weak answers exist.
  assert.doesNotMatch(allText, /no significant gaps detected/);
});

test('7. final report remains complete even if the report-narrative LLM call fails', async () => {
  // Monkey-patch the mock provider's generateReport to simulate an LLM failure.
  const original = mockProvider.generateReport;
  mockProvider.generateReport = async () => {
    throw new Error('simulated LLM failure');
  };
  try {
    const report = await generateFinalReport({ interview: buildMixedInterview(), resume: buildResume() });
    assert.ok(typeof report.overallScore === 'number');
    assert.ok(report.categoryScores && Object.keys(report.categoryScores).length === 5);
    assert.ok(Array.isArray(report.strengths) && report.strengths.length > 0);
    assert.ok(Array.isArray(report.weaknesses) && report.weaknesses.length > 0);
    assert.ok(Array.isArray(report.knowledgeGaps));
    assert.ok(Array.isArray(report.projectAssessment) && report.projectAssessment.length > 0);
    assert.ok(Array.isArray(report.questionAnalysis) && report.questionAnalysis.length === 3);
    assert.ok(Array.isArray(report.recommendations) && report.recommendations.length > 0);
    assert.ok(typeof report.interviewSummary === 'string' && report.interviewSummary.length > 0);
  } finally {
    mockProvider.generateReport = original;
  }
});

test('report never exposes the internal "mock report generated heuristically" disclosure in user-facing text', async () => {
  const report = await generateFinalReport({ interview: buildMixedInterview(), resume: buildResume() });
  const userFacingText = JSON.stringify({
    strengths: report.strengths,
    weaknesses: report.weaknesses,
    knowledgeGaps: report.knowledgeGaps,
    projectAssessment: report.projectAssessment,
    questionAnalysis: report.questionAnalysis,
    recommendations: report.recommendations,
    interviewSummary: report.interviewSummary,
  }).toLowerCase();
  assert.doesNotMatch(userFacingText, /heuristically|no live llm configured/);
  // Debug info, if present, must be a separate, clearly-marked field.
  if (report._debug) {
    assert.ok('llmProvider' in report._debug);
  }
});
