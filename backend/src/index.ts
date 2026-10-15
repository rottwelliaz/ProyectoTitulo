import express from 'express';
import { jwtSettings, corsOrigins } from './config/security';
import { restrictedCors, safeErrors } from './middleware/security';
import usuariosRoutes from './routes/usuarios';
import authRoutes from './routes/auth';
import serviciosRoutes from './routes/servicios';
import citaRoutes from './routes/citas';
import lugarTrabajoRoutes from './routes/lugartrabajo';
import conversationsRoutes from './routes/conversations';
import profesionalRoutes from './routes/profesional';

const app = express();

jwtSettings();
corsOrigins();
app.disable('x-powered-by');
app.use((_, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(restrictedCors());
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));

app.use('/api/usuarios', usuariosRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/servicios', serviciosRoutes);
app.use('/api/citas', citaRoutes);
app.use('/api/lugartrabajo', lugarTrabajoRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/profesional', profesionalRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});
app.use(safeErrors);

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Backend iniciado en http://localhost:${PORT}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`No se pudo iniciar: el puerto ${PORT} ya esta en uso.`);
  } else {
    console.error('No se pudo iniciar el backend.');
  }

  process.exit(1);
});
