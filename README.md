## 🚀 INICIO RÁPIDO - DOCKER COMPOSE

### Requisitos previos
- Docker y Docker Compose instalados
- Git

### 1. Clonar el repositorio
```bash
git clone https://github.com/tu-usuario/ProyectoTitulo.git
cd ProyectoTitulo
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
```

Edita el `.env` si necesitas cambiar valores por defecto:
- `DB_PASSWORD`: contraseña de PostgreSQL
- `JWT_SECRET`: clave secreta para JWT tokens

### 3. Levantar el proyecto
```bash
docker compose up --build
```

O, si prefieres un atajo desde el root del proyecto:
```bash
npm run setup:docker
```

Alternativa (sin rebuild):
```bash
docker compose up
```

### 4. Acceder a la aplicación

**URLs disponibles:**
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001

### Detener los servicios
```bash
docker compose down
```

Para limpiar volúmenes de datos:
```bash
docker compose down -v
```

### Desarrollo Local (Sin Docker)
Si prefieres ejecutar localmente:

**Terminal 1 - Backend**
```bash
cd backend
npm install
npm run dev
```

**Terminal 2 - Frontend**
```bash
cd Frontend
npm install
npm run dev
```

---

