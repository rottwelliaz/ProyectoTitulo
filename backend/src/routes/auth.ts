import { Router } from 'express';
import { getMe, login, updateBankingData, updateBookingSettings, updateMe, updateProfilePhoto } from '../controllers/auth';
import { authenticate } from '../middleware/auth';
import { loginIpLimit, loginAccountLimit } from '../middleware/security';

const router = Router();

router.use((_, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.post('/login', loginIpLimit, loginAccountLimit, login);
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, updateMe);
router.put('/me/photo', authenticate, updateProfilePhoto);
router.put('/me/banking', authenticate, updateBankingData);
router.put('/me/booking-settings', authenticate, updateBookingSettings);

export default router;
