import { Router } from 'express';
import {
  approveBarber,
  createUser,
  deleteUser,
  getAdminDashboard,
  getPendingBarbers,
  getUsers,
  updateUser,
} from '../controllers/usuarios';
import { authenticate, authorizeRoles } from '../middleware/auth';

const router = Router();

router.post('/', createUser);
router.get('/', getUsers);
router.get('/admin/dashboard', authenticate, authorizeRoles('admin'), getAdminDashboard);
router.get('/barberos/pendientes', authenticate, authorizeRoles('admin'), getPendingBarbers);
router.patch('/:id/aprobar-barbero', authenticate, authorizeRoles('admin'), approveBarber);
router.delete('/:id', authenticate, authorizeRoles('admin'), deleteUser);
router.put('/:id', authenticate, authorizeRoles('admin'), updateUser);

export default router;
