## 🚀 INICIO RÁPIDO (5 MINUTOS)

### 1. Preparar Ambiente
```bash
cd c:\Users\RottWelliaZ\Desktop\ProyectoTitulo

# Copiar archivos .env
copy .env.example .env
copy backend\.env.example backend\.env
copy Frontend\.env.example Frontend\.env
```

### 2. Iniciar con Docker
```bash
docker-compose up -d
```

**URLs:**
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Health Check: http://localhost:3001/health

### 3. Desarrollo Local (Sin Docker)
```bash
# Terminal 1 - Backend
cd backend
npm install
npm run dev

# Terminal 2 - Frontend
cd Frontend
npm install
npm run dev
```

---

