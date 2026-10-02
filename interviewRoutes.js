import { Router } from 'express';
import { start, answer, getInterview, finish } from '../controllers/interviewController.js';

const router = Router();

router.post('/start', start);
router.post('/answer', answer);
router.post('/finish', finish);
router.get('/:id', getInterview);

export default router;
