import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import {
  createCita,
  updateCita,
  deleteCita,
  getDisponibilidad,
  agendarCita,
} from '../controllers/citas';

const router = Router();

router.use(authenticate);

// ── Fase 1: Barbero gestiona su agenda ──────────────────────────────────────
router.post('/', authorizeRoles('barbero'), createCita);
router.put('/:id', authorizeRoles('barbero'), updateCita);
router.delete('/:id', authorizeRoles('barbero'), deleteCita);

// ── Fase 2: Disponibilidad y agendamiento ───────────────────────────────────
router.get('/disponibilidad/:barberoId', getDisponibilidad);          // cualquier rol autenticado
router.patch('/:id/agendar', authorizeRoles('cliente'), agendarCita); // solo clientes

export default router;