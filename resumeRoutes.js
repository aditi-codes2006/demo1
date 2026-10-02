import { Router } from 'express';
import { uploadPdf } from '../middleware/upload.js';
import { uploadResume, getResume } from '../controllers/resumeController.js';

const router = Router();

router.post('/upload', uploadPdf.single('resume'), uploadResume);
router.get('/:id', getResume);

export default router;
