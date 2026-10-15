# Conce Barber Club

Proyecto fullstack para gestión de barberías, barberos, servicios y reservas.

## Requisitos

- Node.js 20 o superior
- npm
- Docker Desktop, solo si usarás Docker
- PostgreSQL local, solo si iniciarás sin Docker

## URLs del proyecto

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- API: http://localhost:3001/api

## Iniciar con Docker

Desde la raíz del proyecto:

```powershell
cd C:\Users\RottWelliaZ\Desktop\ProyectoTitulo
```

Crear el archivo de variables si no existe:

```powershell
copy .env.example .env
```

Inicializar PostgreSQL con el volumen persistente:

```powershell
docker compose up -d postgres
```

Revisar el historial y aplicar migraciones solo a una base nueva o autorizada:

```powershell
docker compose --profile maintenance run --rm migrate
```

Iniciar frontend y backend:

```powershell
docker compose up -d --build backend frontend
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

El procedimiento completo de despliegue, respaldo y restauración está en
[INFRAESTRUCTURA_GRUPO_2.md](docs/INFRAESTRUCTURA_GRUPO_2.md). El arranque normal no
ejecuta migraciones ni seed; `postgres_data` persiste después de `docker compose down`.

## Iniciar de forma local

Necesitas tener PostgreSQL corriendo en tu PC con estos datos, o ajustar `backend/.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=GENERAR_CLAVE_URL_SEGURA
DB_NAME=taller
DATABASE_URL=postgresql://postgres:GENERAR_CLAVE_URL_SEGURA@localhost:5432/taller
```

### 1. Backend

Configura una clave `JWT_SECRET` aleatoria (al menos 32 bytes) en `backend/.env` y
`CORS_ORIGIN` con los orígenes exactos del frontend. No se aceptan claves de ejemplo.
Puedes generar una clave con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
Para Docker configura también el `.env` raíz; `DB_PASSWORD` y `JWT_SECRET` son obligatorios.
Los detalles de seguridad y pruebas del Grupo 5 están en [PERFILES_SEGURIDAD_GRUPO_5.md](docs/PERFILES_SEGURIDAD_GRUPO_5.md).

Aplicar migraciones solo en una base nueva o después de revisar y autorizar las
pendientes para la base existente. En una terminal:

```powershell
cd C:\Users\RottWelliaZ\Desktop\ProyectoTitulo\backend
copy .env.example .env
npm install
npm run db:migrate
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

El seed es opcional, solo para una base de desarrollo sin datos: configura `SEED_DEMO_PASSWORD` (mínimo 12 caracteres y máximo 72 bytes) y ejecuta `npm run db:seed`. Si hay datos, el seed se detiene sin insertar cuentas:

```text
Cliente: cliente@demo.com
Barbero: barbero@demo.com
Admin: admin@demo.com
Contraseña de cuentas nuevas: el valor de SEED_DEMO_PASSWORD
```

## Comandos útiles

Compilar frontend:

```powershell
cd Frontend
npm run build
```

Ejecutar seed demo una sola vez sobre una base vacía:

```powershell
cd backend
npm run db:seed
```

## Notas

### Navegación, sesión y pruebas

La política de rutas está centralizada en `Frontend/src/lib/access.ts`:

| Ruta | Roles autorizados |
| --- | --- |
| `/perfil`, `/configuracion` | Cliente, barbero, administrador |
| `/booking` | Cliente |
| `/mensajes` | Cliente, barbero |
| `/perfil-profesional` | Barbero |
| `/admin`, `/admin-barberos` | Administrador |

El frontend conserva la salida estática de Astro. Antes de mostrar una página privada o cargar sus funcionalidades, valida el JWT existente con `/api/auth/me`. El rol proviene del servidor; la información guardada en el navegador es solo una caché. Los datos y operaciones privadas siguen protegidos por el middleware del backend. Sin JavaScript no se muestra el contenido privado. Los enlaces de retorno al login conservan parámetros y fragmentos y solo permiten destinos internos conocidos y autorizados.

Las promociones permanecen en las páginas públicas. Los perfiles y Configuración no incluyen la tarjeta promocional de reservas. El listado `/api/usuarios?rol=barbero` sigue siendo público; los listados de otros roles exigen una cuenta administradora.

La URL de la API se puede configurar con `PUBLIC_API_URL` al iniciar/compilar el frontend; por defecto es `http://localhost:3001/api`.

Pruebas automatizadas (no modifican la base de datos):

```powershell
npm --prefix Frontend test
npm --prefix backend test
npm --prefix Frontend run build
```

Las pruebas del frontend usan Chrome instalado, Playwright y respuestas simuladas de la API. Las del backend ejecutan Express, validación de contraseñas y JWT, sustituyendo únicamente el acceso a Prisma. Para comprobar la compilación estática en lugar del servidor de desarrollo:

```powershell
$env:TEST_PREVIEW = '1'
npm --prefix Frontend test
Remove-Item Env:TEST_PREVIEW
```

### Página 404 en despliegues estáticos

`src/pages/404.astro` genera `dist/404.html`. Astro utiliza esta página en desarrollo y en preview. En producción, configura el hosting para servir `404.html` con estado HTTP **404** cuando no encuentre la URL, sin redirigir todas las rutas al inicio. Se incluye `Frontend/nginx.conf` para Nginx, con `dist` como raíz pública. El Dockerfile existente continúa destinado a desarrollo.

Referencia: [páginas de error personalizadas de Astro](https://docs.astro.build/en/basics/astro-pages/#custom-404-error-page).

- Si usas Docker, no necesitas instalar PostgreSQL local.
- Si usas local, debes tener PostgreSQL iniciado antes del backend.
- Si el puerto `3000`, `3001` o `5432` está ocupado, cierra el proceso que lo usa o cambia los puertos en `.env`.
