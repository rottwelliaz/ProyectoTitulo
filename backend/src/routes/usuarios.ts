import { Router } from 'express';
import {
  approveBarber,
  rejectBarber,
  createUser,
  deleteUser,
  getAdminDashboard,
  getPendingBarbers,
  getUsers,
  updateUser,
} from '../controllers/usuarios';
import { getMyApplication, requestProfessional } from '../controllers/solicitudes';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { getPublicProfile } from '../controllers/publicProfile';
import { getDisponibilidad } from '../controllers/citas';
import { registrationLimit, publicAvailabilityLimit } from '../middleware/security';

const router = Router();

router.post('/', registrationLimit, createUser);
router.get('/barberos/:barberoId/perfil', getPublicProfile);
router.get('/barberos/:barberoId/disponibilidad', publicAvailabilityLimit, getDisponibilidad);
router.get('/solicitud-profesional', authenticate, getMyApplication);
router.post('/solicitud-profesional', authenticate, authorizeRoles('cliente'), requestProfessional);
router.patch('/:id/rechazar-barbero', authenticate, authorizeRoles('admin'), rejectBarber);
// Only the approved barber directory is public. Other user lists are administrative.
router.get('/', (req, res, next) => {
  if (req.query.rol === 'barbero') return next();
  return authenticate(req, res, () => authorizeRoles('admin')(req, res, next));
}, getUsers);
router.get('/admin/dashboard', authenticate, authorizeRoles('admin'), getAdminDashboard);
router.get('/barberos/pendientes', authenticate, authorizeRoles('admin'), getPendingBarbers);
router.patch('/:id/aprobar-barbero', authenticate, authorizeRoles('admin'), approveBarber);
router.delete('/:id', authenticate, authorizeRoles('admin'), deleteUser);
router.put('/:id', authenticate, authorizeRoles('admin'), updateUser);

export default router;
