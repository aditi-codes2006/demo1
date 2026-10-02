import { startInterview, submitAnswer, getInterviewById, finishInterview } from '../services/interviewOrchestrator.js';

export async function start(req, res) {
  const { resumeId, interviewType, difficulty } = req.body;
  if (!resumeId) return res.status(400).json({ error: 'resumeId is required.' });
  try {
    const result = await startInterview({ resumeId, interviewType, difficulty });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

export async function answer(req, res) {
  const { interviewId, answer: answerText } = req.body;
  if (!interviewId) return res.status(400).json({ error: 'interviewId is required.' });
  try {
    const result = await submitAnswer({ interviewId, answer: answerText });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

export async function getInterview(req, res) {
  const interview = await getInterviewById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'Interview not found.' });
  return res.json(interview);
}

export async function finish(req, res) {
  const { interviewId } = req.body;
  if (!interviewId) return res.status(400).json({ error: 'interviewId is required.' });
  try {
    const report = await finishInterview({ interviewId });
    return res.status(200).json(report);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}
