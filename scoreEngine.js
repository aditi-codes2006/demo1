// Deterministic, unit-testable scoring layer. This is intentionally NOT an
// average of the raw per-question scores — it's a weighted composite built
// from several independent signals (understanding level, follow-up recovery,
// topic type, consistency across answers). The LLM (or mock provider) is
// only asked to narrate around these numbers, never to invent them — see
// reportGenerator.js for how the two are combined.

const UNDERSTANDING_TO_POINTS = { shallow: 3, moderate: 6, deep: 9 };

function mean(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDev(nums) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = mean(nums.map((n) => (n - m) ** 2));
  return Math.sqrt(variance);
}

function clamp(n, min = 0, max = 10) {
  return Math.max(min, Math.min(max, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Which resume "project" (if any) a question's topic corresponds to.
function findMatchingProject(topic, resumeProjects) {
  return (resumeProjects || []).find((p) => p.name === topic);
}

/**
 * @param {object} interview - interview document (questions, answers, evaluations, coveredTopics, interviewType)
 * @param {object} resume - resume document (parsed.projects, parsed.skills)
 * @returns {object} { categoryScores, overallScore, perTopicStats, consistency }
 */
export function computeScores(interview, resume) {
  const evaluations = interview.evaluations || [];
  const questions = interview.questions || [];
  const resumeProjects = resume?.parsed?.projects || [];

  const evalByIndex = new Map(evaluations.map((e) => [e.questionIndex, e]));

  // Per-question derived point value (1-10). Prefers the evaluator's actual
  // continuous per-answer score (the real "evidence") — only falls back to
  // the coarse understandingLevel bucket if a provider returns no score at
  // all, so genuinely different answers produce genuinely different points
  // instead of collapsing onto {3, 6, 9}.
  const points = questions.map((q) => {
    const ev = evalByIndex.get(q.index);
    if (!ev) return null;
    const base = typeof ev.score === 'number' ? ev.score : UNDERSTANDING_TO_POINTS[ev.understandingLevel] ?? 5;
    return { question: q, evaluation: ev, points: clamp(base) };
  }).filter(Boolean);

  // --- technicalKnowledge: weighted toward Technical/AIML/FullStack-flavored
  // topics and toward follow-up questions (which probe deeper).
  const technicalWeight = (q) => (q.decisionType === 'FOLLOW_UP' ? 1.5 : 1);
  const technicalKnowledge = weightedAverage(
    points.map((p) => ({ value: p.points, weight: technicalWeight(p.question) }))
  );

  // --- projectUnderstanding: only from questions whose topic matches an
  // actual resume project, weighted so follow-ups (depth probes) count more.
  const projectPoints = points.filter((p) => findMatchingProject(p.question.topic, resumeProjects));
  const projectUnderstanding = projectPoints.length
    ? weightedAverage(projectPoints.map((p) => ({ value: p.points, weight: technicalWeight(p.question) })))
    : technicalKnowledge; // fall back if no project-tagged question exists

  // --- problemSolving: rewards answers that triggered NEW_TOPIC (i.e. were
  // judged to show enough reasoning to move on) over ones that needed a
  // follow-up, independent of raw length.
  const problemSolving = mean(
    points.map((p) => (p.evaluation.suggestedDecision === 'NEW_TOPIC' ? p.points : p.points * 0.8))
  );

  // --- communication: proxy from whether "Clear communication" (or similar)
  // was flagged as a strength, plus understanding level (rambling-but-shallow
  // answers still don't communicate well).
  const communication = mean(
    points.map((p) => {
      const hasCommsStrength = (p.evaluation.strengths || []).some((s) => /communicat/i.test(s));
      return hasCommsStrength ? clamp(p.points + 1) : p.points;
    })
  );

  // --- confidence: high mean + low variance across answers => confident,
  // consistent performance. High variance (great on some, weak on others)
  // pulls this down even if the average looks fine.
  const rawScores = points.map((p) => p.points);
  const consistency = clamp(10 - stdDev(rawScores) * 1.5);
  const confidence = clamp((mean(rawScores) + consistency) / 2);

  const categoryScores = {
    technicalKnowledge: round1(technicalKnowledge),
    projectUnderstanding: round1(projectUnderstanding),
    problemSolving: round1(problemSolving),
    communication: round1(communication),
    confidence: round1(confidence),
  };

  // Overall score: weighted composite of the categories above — NOT a raw
  // average of per-question scores.
  const overallScore = round1(
    categoryScores.technicalKnowledge * 0.3 +
      categoryScores.projectUnderstanding * 0.25 +
      categoryScores.problemSolving * 0.2 +
      categoryScores.communication * 0.15 +
      categoryScores.confidence * 0.1
  );

  // Per-topic stats, used to build projectAssessment / questionAnalysis /
  // recommendations without re-deriving anything from raw scores again.
  const perTopicStats = new Map();
  for (const p of points) {
    const key = p.question.topic;
    if (!perTopicStats.has(key)) perTopicStats.set(key, []);
    perTopicStats.get(key).push(p);
  }

  return { categoryScores, overallScore, points, perTopicStats, consistency: round1(consistency) };
}

function weightedAverage(items) {
  if (items.length === 0) return 0;
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  return items.reduce((sum, i) => sum + i.value * i.weight, 0) / totalWeight;
}

export { findMatchingProject, UNDERSTANDING_TO_POINTS, weightedAverage, round1, clamp };
