# Conce Barber Club

Proyecto fullstack para gestion de barberias, barberos, servicios y reservas.

## Requisitos

- Node.js 20 o superior
- npm
- Docker Desktop, solo si usaras Docker
- PostgreSQL local, solo si iniciaras sin Docker

## URLs del proyecto

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- API: http://localhost:3001/api

## Iniciar con Docker

Desde la raiz del proyecto:

```powershell
cd C:\Users\RottWelliaZ\Desktop\ProyectoTitulo
```

Crear el archivo de variables si no existe:

```powershell
copy .env.example .env
```

Levantar todo el proyecto:

```powershell
docker compose up -d
```

Si cambiaste dependencias o Dockerfiles, reconstruye:

```powershell
docker compose up -d --build
```

Ver contenedores:

```powershell
docker compose ps
```

Ver logs:

```powershell
docker compose logs -f
```

Apagar los servicios:

```powershell
docker compose down
```

Apagar y borrar la base de datos Docker:

```powershell
docker compose down -v
```

## Iniciar de forma local

Necesitas tener PostgreSQL corriendo en tu PC con estos datos, o ajustar `backend/.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=password
DB_NAME=taller
DATABASE_URL=postgresql://postgres:password@localhost:5432/taller
```

### 1. Backend

En una terminal:

```powershell
cd C:\Users\RottWelliaZ\Desktop\ProyectoTitulo\backend
copy .env.example .env
npm install
npx prisma db push
npm run db:seed
npm run dev
```

El backend queda en:

```text
http://localhost:3001
```

### 2. Frontend

En otra terminal:

```powershell
cd C:\Users\RottWelliaZ\Desktop\ProyectoTitulo\Frontend
copy .env.example .env
npm install
npm run dev
```

El frontend queda en:

```text
http://localhost:3000
```

## Usuarios demo

El seed crea estos usuarios:

```text
Cliente: cliente@demo.com
Barbero: barbero@demo.com
Admin: admin@demo.com
Password: 123456
```

## Comandos utiles

Compilar frontend:

```powershell
cd Frontend
npm run build
```

Ejecutar seed nuevamente:

```powershell
cd backend
npm run db:seed
```

Sincronizar Prisma con la base local:

```powershell
cd backend
npx prisma db push
```

## Notas

- Si usas Docker, no necesitas instalar PostgreSQL local.
- Si usas local, debes tener PostgreSQL iniciado antes del backend.
- Si el puerto `3000`, `3001` o `5432` esta ocupado, cierra el proceso que lo usa o cambia los puertos en `.env`.
