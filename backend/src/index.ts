import express from 'express';
import cors from 'cors';
import usuariosRoutes from './routes/usuarios';
import authRoutes from './routes/auth';
import serviciosRoutes from './routes/servicios';
import citaRoutes from './routes/citas';
import lugarTrabajoRoutes from './routes/lugartrabajo';
import conversationsRoutes from './routes/conversations';

const app = express();

app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));

app.use('/api/usuarios', usuariosRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/servicios', serviciosRoutes);
app.use('/api/citas', citaRoutes);
app.use('/api/lugartrabajo', lugarTrabajoRoutes);
app.use('/api/conversations', conversationsRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

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
