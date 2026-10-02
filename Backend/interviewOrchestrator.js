import { getResumeById } from './resumeParser.js';
import { interviewRepository } from '../db/repositories/interviewRepository.js';
import { generateFirstQuestion, generateNextQuestion } from './interviewGenerator.js';
import { evaluateAnswer } from './answerEvaluator.js';
import { generateFinalReport } from './reportGenerator.js';
import {
  isValidInterviewType,
  isValidDifficulty,
  MAX_QUESTIONS,
  MAX_FOLLOW_UPS_PER_TOPIC,
} from '../constants/interviewOptions.js';

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export async function startInterview({ resumeId, interviewType, difficulty }) {
  if (!isValidInterviewType(interviewType)) {
    throw httpError(`Unsupported interviewType. Must be one of the supported types.`, 400);
  }
  if (!isValidDifficulty(difficulty)) {
    throw httpError(`Unsupported difficulty. Must be Easy, Medium, or Hard.`, 400);
  }

  const resume = await getResumeById(resumeId);
  if (!resume) throw httpError('Invalid resumeId — resume not found.', 404);
  if (resume.status !== 'parsed') {
    throw httpError('Resume has not finished parsing yet — cannot start interview.', 422);
  }

  const interview = await interviewRepository.create({ resumeId, interviewType, difficulty });

  const firstQuestion = await generateFirstQuestion({ resume, interviewType, difficulty });

  const questionRecord = {
    index: 0,
    text: firstQuestion.questionText,
    topic: firstQuestion.topic,
    targetSkill: firstQuestion.targetSkill,
    stage: firstQuestion.stage,
    decisionType: 'FIRST',
  };

  const updated = await interviewRepository.update(interview.id, {
    currentQuestion: questionRecord,
    questions: [questionRecord],
    questionNumber: 1,
    currentTopic: firstQuestion.topic,
    primaryTopic: firstQuestion.primaryTopic,
    stageIndex: 0,
    coveredTopics: [firstQuestion.topic],
  });

  return {
    interviewId: updated.id,
    question: questionRecord,
    questionNumber: updated.questionNumber,
    status: updated.status,
  };
}

export async function submitAnswer({ interviewId, answer }) {
  if (!answer || !answer.trim()) {
    throw httpError('Answer must not be empty.', 400);
  }

  const interview = await interviewRepository.findById(interviewId);
  if (!interview) throw httpError('Invalid interviewId — interview not found.', 404);
  if (interview.status === 'completed') {
    throw httpError('This interview has already been completed.', 409);
  }

  const resume = await getResumeById(interview.resumeId);
  if (!resume) throw httpError('Associated resume no longer exists.', 404);

  const currentQuestion = interview.currentQuestion;
  const currentIndex = currentQuestion.index;

  // 1. Evaluate the answer just submitted.
  const evaluation = await evaluateAnswer({
    question: currentQuestion,
    answer,
    resume,
    interviewType: interview.interviewType,
    difficulty: interview.difficulty,
    primaryTopic: interview.primaryTopic,
  });

  const answers = [...interview.answers, { questionIndex: currentIndex, text: answer }];
  const evaluations = [...interview.evaluations, { questionIndex: currentIndex, ...evaluation }];
  const detectedKnowledgeGaps = [...interview.detectedKnowledgeGaps, ...evaluation.gaps];

  // 2. Apply orchestration rules on top of the LLM's suggested decision:
  //    cap follow-ups per STAGE (not per topic — the topic doesn't change
  //    across the interview anymore) so a weak answer can't loop forever
  //    within the fixed question budget.
  let decision = evaluation.suggestedDecision;
  let followUpCountForCurrentStage = interview.followUpCountForCurrentStage;
  if (decision === 'FOLLOW_UP') {
    if (followUpCountForCurrentStage >= MAX_FOLLOW_UPS_PER_TOPIC) {
      decision = 'NEW_TOPIC'; // forced to advance to the next depth stage
    } else {
      followUpCountForCurrentStage += 1;
    }
  } else {
    followUpCountForCurrentStage = 0;
  }

  // 3. Check whether we've hit the question budget — if so, end the interview
  //    instead of generating another question.
  const questionsAskedSoFar = interview.questions.length;
  if (questionsAskedSoFar >= MAX_QUESTIONS) {
    const completed = await interviewRepository.update(interviewId, {
      answers,
      evaluations,
      detectedKnowledgeGaps,
      status: 'completed',
      currentQuestion: null,
    });
    return {
      interviewId: completed.id,
      evaluation,
      decision,
      nextQuestion: null,
      status: 'completed',
      questionNumber: completed.questionNumber,
    };
  }

  // 4. Generate the next question: either a deeper follow-up on the same
  //    stage, or the next stage in the resume → project → technology →
  //    implementation → weakness → system-design progression.
  const interviewForGeneration = { ...interview, answers, evaluations };
  const nextQuestionRaw = await generateNextQuestion({
    resume,
    interview: interviewForGeneration,
    decision,
    lastEvaluation: evaluation,
    lastAnswerText: answer,
  });

  const nextIndex = currentIndex + 1;
  const nextQuestionRecord = {
    index: nextIndex,
    text: nextQuestionRaw.questionText,
    topic: nextQuestionRaw.topic,
    targetSkill: nextQuestionRaw.targetSkill,
    stage: nextQuestionRaw.stage,
    decisionType: decision,
  };

  const coveredTopics = interview.coveredTopics.includes(nextQuestionRaw.topic)
    ? interview.coveredTopics
    : [...interview.coveredTopics, nextQuestionRaw.topic];

  const updated = await interviewRepository.update(interviewId, {
    answers,
    evaluations,
    detectedKnowledgeGaps,
    questions: [...interview.questions, nextQuestionRecord],
    currentQuestion: nextQuestionRecord,
    questionNumber: interview.questionNumber + 1,
    currentTopic: nextQuestionRecord.topic,
    stageIndex: nextQuestionRaw.stageIndex,
    coveredTopics,
    followUpCountForCurrentStage,
  });

  return {
    interviewId: updated.id,
    evaluation,
    decision,
    nextQuestion: nextQuestionRecord,
    status: updated.status,
    questionNumber: updated.questionNumber,
  };
}

export async function getInterviewById(id) {
  return interviewRepository.findById(id);
}

export async function finishInterview({ interviewId }) {
  const interview = await interviewRepository.findById(interviewId);
  if (!interview) throw httpError('Invalid interviewId — interview not found.', 404);

  if (interview.status !== 'completed') {
    const answeredCount = interview.answers.length;
    throw httpError(
      `Interview cannot be finished yet — ${answeredCount} of ${MAX_QUESTIONS} questions answered.`,
      400
    );
  }

  // Idempotent: if a report already exists, return it instead of regenerating
  // (avoids duplicate LLM calls / a second, possibly different, report).
  if (interview.finalReport) {
    return interview.finalReport;
  }

  const resume = await getResumeById(interview.resumeId);
  if (!resume) throw httpError('Associated resume no longer exists.', 404);

  const report = await generateFinalReport({ resume, interview });

  await interviewRepository.update(interviewId, {
    finalReport: report,
    reportGeneratedAt: new Date(),
  });

  return report;
}
