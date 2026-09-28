import { Router } from 'express';
import { getMe, login, updateBankingData, updateMe, updateProfilePhoto } from '../controllers/auth';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, updateMe);
router.put('/me/photo', authenticate, updateProfilePhoto);
router.put('/me/banking', authenticate, updateBankingData);

export default router;
