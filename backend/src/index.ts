import express from 'express';
import cors from 'cors';
import usuariosRoutes from './routes/usuarios';
import authRoutes from './routes/auth';
import serviciosRoutes from './routes/servicios';
import citaRoutes from './routes/citas';
import lugarTrabajoRoutes from './routes/lugartrabajo';

const app = express();

app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));

app.use('/api/usuarios', usuariosRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/servicios', serviciosRoutes);
app.use('/api/citas', citaRoutes);
app.use('/api/lugartrabajo', lugarTrabajoRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    console.log('✅ Base de datos conectada');

    app.listen(PORT, () => {
      console.log(`🚀 Servidor en puerto ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar:', error);
    process.exit(1);
  }
};

startServer();
