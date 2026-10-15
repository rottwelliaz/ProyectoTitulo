import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import {
  createCita,
  updateCita,
  deleteCita,
  getBarberosParaReserva,
  getPaymentDetails,
  cancelClientAppointment,
  getClientAppointments,
  getMyAppointments,
  getReservationCalendar,
  getDisponibilidad,
  agendarCita,
  saveWeekAvailability,
  updateAppointmentStatus,
  getAppointmentHistory,
} from '../controllers/citas';

const router = Router();

router.use((_, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(authenticate);

// ── Fase 1: Barbero gestiona su agenda ──────────────────────────────────────
router.post('/', authorizeRoles('barbero'), createCita);
router.get('/mias', authorizeRoles('barbero'), getMyAppointments);
router.get('/agenda-reservas', authorizeRoles('barbero'), getReservationCalendar);
router.get('/cliente/mias', authorizeRoles('cliente'), getClientAppointments);
router.patch('/cliente/:id/cancelar', authorizeRoles('cliente'), cancelClientAppointment);
router.put('/disponibilidad/semana', authorizeRoles('barbero'), saveWeekAvailability);
router.patch('/:id/estado', authorizeRoles('barbero', 'admin', 'cliente'), updateAppointmentStatus);
router.get('/:id/historial', authorizeRoles('barbero', 'admin', 'cliente'), getAppointmentHistory);
router.put('/:id', authorizeRoles('barbero'), updateCita);
router.delete('/:id', authorizeRoles('barbero'), deleteCita);

// ── Fase 2: Disponibilidad y agendamiento ───────────────────────────────────
router.get('/barberos', authorizeRoles('cliente', 'admin'), getBarberosParaReserva);
router.get('/disponibilidad/:barberoId', getDisponibilidad);          // cualquier rol autenticado
router.patch('/:id/agendar', authorizeRoles('cliente'), agendarCita); // solo clientes
router.post('/:id/pago', authorizeRoles('cliente'), getPaymentDetails);

export default router;
