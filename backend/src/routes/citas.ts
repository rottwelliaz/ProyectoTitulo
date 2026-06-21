import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import {
  createCita,
  updateCita,
  deleteCita,
  getBarberosParaReserva,
  getClientAppointments,
  getMyAppointments,
  getReservationCalendar,
  getDisponibilidad,
  agendarCita,
  saveWeekAvailability,
  updateAppointmentStatus,
} from '../controllers/citas';

const router = Router();

router.use(authenticate);

// ── Fase 1: Barbero gestiona su agenda ──────────────────────────────────────
router.post('/', authorizeRoles('barbero'), createCita);
router.get('/mias', authorizeRoles('barbero'), getMyAppointments);
router.get('/agenda-reservas', authorizeRoles('barbero'), getReservationCalendar);
router.get('/cliente/mias', authorizeRoles('cliente'), getClientAppointments);
router.put('/disponibilidad/semana', authorizeRoles('barbero'), saveWeekAvailability);
router.patch('/:id/estado', authorizeRoles('barbero'), updateAppointmentStatus);
router.put('/:id', authorizeRoles('barbero'), updateCita);
router.delete('/:id', authorizeRoles('barbero'), deleteCita);

// ── Fase 2: Disponibilidad y agendamiento ───────────────────────────────────
router.get('/barberos', authorizeRoles('cliente', 'admin'), getBarberosParaReserva);
router.get('/disponibilidad/:barberoId', getDisponibilidad);          // cualquier rol autenticado
router.patch('/:id/agendar', authorizeRoles('cliente'), agendarCita); // solo clientes

export default router;
