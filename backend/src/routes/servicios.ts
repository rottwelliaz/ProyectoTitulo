import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import {
  createService,
  deleteService,
  getServiceById,
  getServices,
  updateService,
} from '../controllers/servicios';

const router = Router();

router.use(authenticate);

router.get('/', authorizeRoles('barbero', 'admin'), getServices);
router.get('/:id', authorizeRoles('barbero', 'admin'), getServiceById);
router.post('/', authorizeRoles('barbero'), createService);
router.put('/:id', authorizeRoles('barbero'), updateService);
router.delete('/:id', authorizeRoles('barbero', 'admin'), deleteService);

export default router;
