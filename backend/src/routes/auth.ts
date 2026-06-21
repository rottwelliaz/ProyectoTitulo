import { Router } from 'express';
import { getMe, login, updateMe } from '../controllers/auth';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, updateMe);

export default router;