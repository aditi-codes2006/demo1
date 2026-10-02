import { getLlmProvider } from '../llm/provider.js';
import { config } from '../config/index.js';
import { computeScores, findMatchingProject, weightedAverage, round1 } from './scoreEngine.js';

const TECHNICAL_WEIGHT = (decisionType) => (decisionType === 'FOLLOW_UP' ? 1.5 : 1);

function buildTopicPayload(interview, resume, scores) {
  const resumeProjects = resume?.parsed?.projects || [];
  const topics = [];

  for (const [topic, entries] of scores.perTopicStats.entries()) {
    const project = findMatchingProject(topic, resumeProjects);
    const understandingScore = round1(
      weightedAverage(entries.map((e) => ({ value: e.points, weight: TECHNICAL_WEIGHT(e.question.decisionType) })))
    );
    topics.push({
      topic,
      isProject: Boolean(project),
      techStack: project?.techStack || [],
      understandingScore,
      questions: entries.map((e) => ({
        index: e.question.index,
        questionText: e.question.text,
        answerText: (interview.answers.find((a) => a.questionIndex === e.question.index) || {}).text || '',
        score: e.points,
        stage: e.question.stage,
        decisionType: e.question.decisionType,
        understandingLevel: e.evaluation.understandingLevel,
        feedback: e.evaluation.feedback,
        strengths: e.evaluation.strengths,
        gaps: e.evaluation.gaps,
      })),
    });
  }
  return topics;
}

// --- Deterministic fallbacks, used whenever the LLM/mock provider omits or
// malforms a field, so the report is always complete and specific to THIS
// interview even if narrative generation partially fails. ---------------

function extractGapPhrases(gapStrings = []) {
  const phrases = new Set();
  for (const g of gapStrings) {
    const m = g.match(/limited discussion of (.+?)\.?$/i);
    if (m) {
      m[1].split(',').forEach((part) => phrases.add(part.trim().replace(/^and\s+/, '')));
    }
  }
  return Array.from(phrases);
}

function fallbackProjectAssessment(topic, understandingScore, techStack, questions = []) {
  const stackNote = techStack.length ? ` (${techStack.join(', ')})` : '';
  const gapPhrases = extractGapPhrases(questions.flatMap((q) => q.gaps || [])).slice(0, 2);
  const strengthWords = Array.from(
    new Set(questions.flatMap((q) => q.strengths || []).map((s) => s.toLowerCase()))
  ).slice(0, 2);

  if (understandingScore >= 7.5) {
    return (
      `Demonstrated strong understanding of ${topic}${stackNote}` +
      (strengthWords.length ? `, including ${strengthWords.join(' and ')}` : '') +
      '.' +
      (gapPhrases.length ? ` Could still strengthen discussion of ${gapPhrases.join(' and ')}.` : '')
    );
  }
  if (understandingScore >= 5) {
    return (
      `Showed moderate understanding of ${topic}${stackNote}` +
      (strengthWords.length ? `, including ${strengthWords.join(' and ')}` : '') +
      `; could strengthen discussion of ${gapPhrases.join(' and ') || 'trade-offs and implementation detail'}.`
    );
  }
  return `Project understanding could be strengthened for ${topic}${stackNote} — discussion lacked ${gapPhrases.join(' and ') || 'concrete technical depth on how it was built'}.`;
}

function fallbackQuestionAssessment(evaluation) {
  return evaluation.feedback || 'No detailed feedback available for this answer.';
}

const TOPIC_KEYWORD_ADVICE = [
  { pattern: /nlp|tf-?idf|cosine|embedding|semantic|vector/i, advice: 'Revise TF-IDF, embeddings, semantic similarity, and vector databases — be ready to explain trade-offs between them.' },
  { pattern: /system design|scalab|load balanc|cach/i, advice: 'Practice designing scalable REST APIs and review basic load balancing and caching concepts.' },
  { pattern: /react|frontend|ui/i, advice: 'Review React state management and component design patterns, and practice explaining rendering trade-offs.' },
  { pattern: /node|express|backend|api/i, advice: 'Revisit backend API design: request validation, error handling, and how you structured routes/services.' },
  { pattern: /mongo|database|sql/i, advice: 'Review database schema design choices and be ready to justify why you picked that data model.' },
  { pattern: /gemini|openai|llm|generative|agent/i, advice: 'Revisit your LLM integration: prompt design, error handling, and cost/latency trade-offs — practice explaining the "why" behind each choice.' },
];

function adviceForTopic(topic, techStack = []) {
  const haystack = `${topic} ${techStack.join(' ')}`;
  const match = TOPIC_KEYWORD_ADVICE.find((t) => t.pattern.test(haystack));
  return match ? match.advice : `Revisit the implementation details of ${topic} — be ready to explain the "why" behind each design choice, not just the "what".`;
}

function fallbackRecommendations(categoryScores, topics) {
  const recs = [];

  const weakTopics = topics
    .filter((t) => t.understandingScore < 6)
    .sort((a, b) => a.understandingScore - b.understandingScore)
    .slice(0, 2);

  for (const t of weakTopics) {
    const gapPhrases = extractGapPhrases(t.questions.flatMap((q) => q.gaps || [])).slice(0, 2);
    recs.push({
      topic: t.topic,
      reason:
        `Answers on ${t.topic} averaged ${t.understandingScore}/10` +
        (gapPhrases.length ? `, with limited discussion of ${gapPhrases.join(' and ')}.` : ', indicating limited technical depth.'),
      action: adviceForTopic(t.topic, t.techStack),
    });
  }

  // Even when a topic's OVERALL average looks fine, call out specific weak
  // individual answers (e.g. aced everything except the system-design
  // question) rather than hiding them behind a good average.
  if (weakTopics.length === 0) {
    const weakQuestions = topics
      .flatMap((t) => t.questions.filter((q) => q.score < 6).map((q) => ({ ...q, topicName: t.topic, techStack: t.techStack })))
      .sort((a, b) => a.score - b.score)
      .slice(0, 2);

    for (const q of weakQuestions) {
      const gapPhrases = extractGapPhrases(q.gaps || []).slice(0, 2);
      const stageLabel = (q.stage || '').replace(/_/g, ' ').toLowerCase();
      recs.push({
        topic: `${q.topicName}${stageLabel ? ` — ${stageLabel}` : ''}`,
        reason: `The ${stageLabel || 'related'} answer scored ${q.score}/10` + (gapPhrases.length ? `, missing ${gapPhrases.join(' and ')}.` : '.'),
        action: adviceForTopic(`${q.topicName} ${stageLabel}`, q.techStack),
      });
    }
  }

  if (categoryScores.communication < 6) {
    recs.push({
      topic: 'Communication',
      reason: 'Answers were often brief and lacked structured reasoning.',
      action: 'Practice answering technical questions using a structured approach: concept → reasoning → example.',
    });
  }

  if (categoryScores.problemSolving < 6) {
    recs.push({
      topic: 'Problem Solving',
      reason: 'Several answers moved to conclusions without walking through the reasoning or trade-offs.',
      action: 'Before answering, briefly state the problem, your options, and why you picked one — out loud, every time.',
    });
  }

  if (recs.length === 0) {
    recs.push({
      topic: 'Depth on follow-ups',
      reason: 'Overall performance was solid across the interview, with no significant gaps detected.',
      action: 'Keep practicing explaining edge cases and limitations of your projects to sharpen depth even further.',
    });
  }

  return recs.slice(0, 4);
}

function fallbackStrengthsWeaknesses(categoryScores) {
  const LABELS = {
    technicalKnowledge: 'technical knowledge',
    projectUnderstanding: 'project understanding',
    problemSolving: 'problem solving',
    communication: 'communication',
    confidence: 'confidence and consistency',
  };
  const strengths = [];
  const weaknesses = [];
  for (const [key, score] of Object.entries(categoryScores)) {
    if (score >= 7) strengths.push(`Strong ${LABELS[key]} (${score}/10).`);
    else if (score < 5.5) weaknesses.push(`${LABELS[key][0].toUpperCase()}${LABELS[key].slice(1)} could be strengthened (${score}/10).`);
  }
  if (strengths.length === 0) strengths.push('Engaged with every question and completed the full interview.');
  if (weaknesses.length === 0) weaknesses.push('No major weaknesses stood out — focus on maintaining this consistency.');
  return { strengths, weaknesses };
}

function fallbackKnowledgeGaps(interview, topics) {
  const gaps = new Set((interview.detectedKnowledgeGaps || []).filter(Boolean));
  topics
    .filter((t) => t.understandingScore < 5 && gaps.size === 0)
    .forEach((t) => gaps.add(`Project understanding could be strengthened for ${t.topic}.`));
  return Array.from(gaps).slice(0, 8);
}

function fallbackSummary(interview, resume, scores) {
  const band = scores.overallScore >= 7.5 ? 'strong' : scores.overallScore >= 5.5 ? 'solid' : 'developing';
  return (
    `${resume.parsed?.name || 'The candidate'} completed a ${interview.difficulty} ${interview.interviewType} interview ` +
    `(${interview.questions.length} questions) with an overall score of ${scores.overallScore}/10, reflecting ${band} performance. ` +
    `Strongest area: ${Object.entries(scores.categoryScores).sort((a, b) => b[1] - a[1])[0][0]}. ` +
    `Recommended focus area: ${Object.entries(scores.categoryScores).sort((a, b) => a[1] - b[1])[0][0]}.`
  );
}

export async function generateFinalReport({ interview, resume }) {
  const scores = computeScores(interview, resume);
  const topics = buildTopicPayload(interview, resume, scores);

  const llm = getLlmProvider();
  let narrative = {};
  try {
    narrative = await llm.generateReport({
      resume: resume.parsed,
      interviewType: interview.interviewType,
      difficulty: interview.difficulty,
      categoryScores: scores.categoryScores,
      overallScore: scores.overallScore,
      topics,
      detectedKnowledgeGaps: interview.detectedKnowledgeGaps,
    });
  } catch {
    narrative = {}; // fall through to deterministic fallbacks below
  }

  const { strengths: fbStrengths, weaknesses: fbWeaknesses } = fallbackStrengthsWeaknesses(scores.categoryScores);

  const projectAssessment = topics.map((t) => ({
    project: t.topic,
    understandingScore: t.understandingScore,
    assessment:
      narrative.projectAssessments?.[t.topic] ||
      fallbackProjectAssessment(t.topic, t.understandingScore, t.techStack, t.questions),
  }));

  const questionAnalysis = interview.questions.map((q, i) => {
    const evaluation = interview.evaluations.find((e) => e.questionIndex === q.index);
    return {
      questionNumber: i + 1,
      topic: q.topic,
      score: evaluation ? round1(evaluation.score) : null,
      assessment: narrative.questionAssessments?.[q.index] || fallbackQuestionAssessment(evaluation || {}),
    };
  });

  const recommendations =
    Array.isArray(narrative.recommendations) && narrative.recommendations.length > 0
      ? narrative.recommendations
      : fallbackRecommendations(scores.categoryScores, topics);

  const report = {
    overallScore: scores.overallScore,
    categoryScores: scores.categoryScores,
    strengths: Array.isArray(narrative.strengths) && narrative.strengths.length ? narrative.strengths : fbStrengths,
    weaknesses: Array.isArray(narrative.weaknesses) && narrative.weaknesses.length ? narrative.weaknesses : fbWeaknesses,
    knowledgeGaps:
      Array.isArray(narrative.knowledgeGaps) && narrative.knowledgeGaps.length
        ? narrative.knowledgeGaps
        : fallbackKnowledgeGaps(interview, topics),
    projectAssessment,
    questionAnalysis,
    recommendations,
    interviewSummary: narrative.interviewSummary || fallbackSummary(interview, resume, scores),
    // Subtle developer/debug indicator only — never rendered in the normal
    // user-facing dashboard, and never part of the narrative prose above.
    _debug: { llmProvider: config.useMockLlm ? 'mock' : 'openai' },
  };

  return report;
}
