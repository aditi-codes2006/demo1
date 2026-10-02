import { processResumeUpload, getResumeById } from '../services/resumeParser.js';

export async function uploadResume(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Field name must be "resume".' });
  }
  try {
    const resume = await processResumeUpload({
      fileName: req.file.originalname,
      buffer: req.file.buffer,
    });
    return res.status(201).json({
      resumeId: resume.id,
      status: resume.status,
      parsed: resume.parsed,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

export async function getResume(req, res) {
  const resume = await getResumeById(req.params.id);
  if (!resume) return res.status(404).json({ error: 'Resume not found.' });
  return res.json({
    resumeId: resume.id,
    fileName: resume.fileName,
    status: resume.status,
    parsed: resume.parsed,
  });
}
