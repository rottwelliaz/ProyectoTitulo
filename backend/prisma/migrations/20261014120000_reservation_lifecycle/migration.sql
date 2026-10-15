-- Additive migration. Review/authorize before applying to any real database.
-- No appointment is deleted and no timestamp or availability interval is shifted.
BEGIN;
ALTER TYPE "CitaEstado" ADD VALUE IF NOT EXISTS 'rechazada';
ALTER TYPE "CitaEstado" ADD VALUE IF NOT EXISTS 'inasistencia';
ALTER TABLE "User" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "fecha_actualizacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Service" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "fecha_actualizacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Cita" ADD COLUMN "nombreServicioReservado" TEXT,
  ADD COLUMN "precioReservado" INTEGER,
  ADD COLUMN "fecha_actualizacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Best available legacy values only: earlier edits cannot be reconstructed.
UPDATE "Cita" c SET "nombreServicioReservado" = s."nombre_servicio",
  "precioReservado" = s."precio",
  "duracionReservada" = COALESCE(c."duracionReservada", NULLIF(s."duracion_minutos", 0))
FROM "Service" s WHERE c."servicioId" = s.id AND c.estado <> 'disponible';

CREATE TABLE "CitaCambioEstado" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "citaId" TEXT NOT NULL REFERENCES "Cita"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "estadoAnterior" "CitaEstado",
  "estadoNuevo" "CitaEstado" NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responsableId" INTEGER REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "origen" TEXT NOT NULL DEFAULT 'aplicacion'
);
CREATE INDEX "CitaCambioEstado_citaId_fecha_idx" ON "CitaCambioEstado"("citaId", "fecha");
-- A baseline records what is known now, without inventing earlier events or actors.
INSERT INTO "CitaCambioEstado" ("id", "citaId", "estadoNuevo", "origen")
SELECT 'baseline-' || "id", "id", "estado", 'migracion' FROM "Cita" WHERE estado <> 'disponible';

ALTER TABLE "Cita" DROP CONSTRAINT "Cita_clienteId_fkey";
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cita" DROP CONSTRAINT "Cita_servicioId_fkey";
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense against accidental physical deletion, even outside the HTTP API.
-- Empty published availability remains removable by the existing calendar flow.
CREATE FUNCTION protect_reservation_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado::text <> 'disponible' OR OLD."clienteId" IS NOT NULL OR OLD."servicioId" IS NOT NULL
     OR OLD."nombreServicioReservado" IS NOT NULL OR OLD."precioReservado" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Las reservas se conservan en el historial' USING ERRCODE = '23514';
    END IF;
    IF NEW.estado::text = 'disponible' THEN
      RAISE EXCEPTION 'Una reserva no puede convertirse en disponibilidad' USING ERRCODE = '23514';
    END IF;
    IF (OLD."nombreServicioReservado" IS NOT NULL AND NEW."nombreServicioReservado" IS DISTINCT FROM OLD."nombreServicioReservado")
       OR (OLD."precioReservado" IS NOT NULL AND NEW."precioReservado" IS DISTINCT FROM OLD."precioReservado")
       OR (OLD."duracionReservada" IS NOT NULL AND NEW."duracionReservada" IS DISTINCT FROM OLD."duracionReservada") THEN
      RAISE EXCEPTION 'Los valores históricos de la reserva no se pueden sobrescribir' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Cita_protect_history" BEFORE DELETE OR UPDATE ON "Cita"
  FOR EACH ROW EXECUTE FUNCTION protect_reservation_history();
COMMIT;
