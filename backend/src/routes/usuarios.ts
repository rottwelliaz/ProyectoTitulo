import { Router } from 'express';
import { createUser, getUsers, deleteUser, updateUser } from '../controllers/usuarios';
import { authenticate, authorizeRoles } from '../middleware/auth';

const router = Router();

router.post('/', createUser);
router.get('/', getUsers);
router.delete('/:id', authenticate, authorizeRoles('admin'), deleteUser);
router.put('/:id', authenticate, authorizeRoles('admin'), updateUser);

export default router;
