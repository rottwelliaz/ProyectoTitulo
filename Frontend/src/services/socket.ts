import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export const socketService = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket'],
});

export default socketService;
