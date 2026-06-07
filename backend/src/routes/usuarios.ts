import { Router } from 'express';
import { createUser, getUsers, deleteUser } from '../controllers/usuarios';
import { authenticate, authorizeRoles } from '../middleware/auth';

const router = Router();

router.post('/', createUser);
router.get('/', getUsers);
router.delete('/:id', authenticate, authorizeRoles('admin'), deleteUser);

export default router;
