# Modelo Entidad–Relación (MER)

Este diagrama representa el modelo de datos actual definido en `backend/prisma/schema.prisma`.

```mermaid
erDiagram
    USER {
        int id PK
        string nombre
        string email UK
        string password
        string telefono "opcional"
        UserRole rol
        boolean aprobado
        datetime fecha_creacion
    }

    BARBER_PROFILE {
        int id PK
        int usuarioId FK,UK
        string biografia "opcional"
        string foto_perfil "opcional"
        string bancoNombre "opcional"
        string bancoRut "opcional"
        string bancoNombreBanco "opcional"
        string bancoTipoCuenta "opcional"
        string bancoNroCuenta "opcional"
        string bancoCorreo "opcional"
        int lugarTrabajoId FK "opcional"
    }

    LUGAR_TRABAJO {
        int id PK
        string nombre_barberia "opcional"
        string direccion "opcional"
    }

    SERVICE {
        uuid id PK
        int perfilBarberoId FK
        string nombre_servicio
        string descripcion "opcional"
        int precio
        int duracion_minutos
    }

    CITA {
        uuid id PK
        int clienteId FK "opcional"
        int barberoId FK
        uuid servicioId FK "opcional"
        datetime fecha_hora
        CitaEstado estado
        string comprobanteTransferencia "opcional"
        string comprobanteNombre "opcional"
        datetime fecha_creacion
    }

    MESSAGE {
        uuid id PK
        int emisorId FK
        int receptorId FK
        string contenido
        boolean leido
        datetime fecha_envio
    }

    USER ||--o| BARBER_PROFILE : "posee"
    LUGAR_TRABAJO o|--o{ BARBER_PROFILE : "agrupa"
    BARBER_PROFILE ||--o{ SERVICE : "ofrece"
    USER o|--o{ CITA : "reserva como cliente"
    BARBER_PROFILE ||--o{ CITA : "atiende"
    SERVICE o|--o{ CITA : "es solicitado en"
    USER ||--o{ MESSAGE : "envia"
    USER ||--o{ MESSAGE : "recibe"
```

## Enumeraciones

- `UserRole`: `cliente`, `barbero`, `admin`.
- `CitaEstado`: `disponible`, `pendiente`, `confirmada`, `cancelada`, `finalizada`.

## Reglas principales

- Un usuario puede tener como máximo un perfil de barbero; cada perfil pertenece a un único usuario.
- Un lugar de trabajo puede agrupar varios barberos y un barbero puede no tener lugar de trabajo asignado.
- Un barbero puede ofrecer varios servicios y atender varias citas.
- Una cita siempre tiene un barbero, pero el cliente y el servicio pueden estar temporalmente sin asignar.
- Cada mensaje tiene exactamente un usuario emisor y un usuario receptor.

> `PK`: clave primaria · `FK`: clave foránea · `UK`: clave única.
