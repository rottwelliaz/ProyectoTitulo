import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import {
  createOrGetConversation,
  getConversationMessages,
  getConversations,
  sendConversationMessage,
} from '../controllers/conversations';

const router = Router();

router.use(authenticate, authorizeRoles('cliente', 'barbero'));
router.post('/', createOrGetConversation);
router.get('/', getConversations);
router.get('/:id/messages', getConversationMessages);
router.post('/:id/messages', sendConversationMessage);

export default router;
