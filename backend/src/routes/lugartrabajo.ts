import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import {
  createLugarTrabajo,
  deleteLugarTrabajo,
  getLugarTrabajoById,
  getLugaresTrabajo,
  updateLugarTrabajo,
} from '../controllers/lugartrabajo';

const router = Router();

router.use(authenticate);

router.get('/', authorizeRoles('barbero', 'admin'), getLugaresTrabajo);
router.get('/:id', authorizeRoles('barbero', 'admin'), getLugarTrabajoById);
router.post('/', authorizeRoles('barbero', 'admin'), createLugarTrabajo);
router.put('/:id', authorizeRoles('barbero', 'admin'), updateLugarTrabajo);
router.delete('/:id', authorizeRoles('barbero', 'admin'), deleteLugarTrabajo);

export default router;
