-- Additive change: existing appointments and availability rows are retained.
ALTER TABLE "Cita" ADD COLUMN "disponibleHasta" TIMESTAMP(3);
ALTER TABLE "Cita" ADD COLUMN "duracionReservada" INTEGER;

-- Freeze the best duration available for historical reservations.
UPDATE "Cita" AS cita
SET "duracionReservada" = servicio."duracion_minutos"
FROM "Service" AS servicio
WHERE cita."servicioId" = servicio.id
  AND cita.estado <> 'disponible'
  AND servicio."duracion_minutos" > 0;

-- Legacy availability has no reliable end time. Do not guess across breaks:
-- the professional must republish it with explicit interval boundaries.
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_duration_positive"
  CHECK ("duracionReservada" IS NULL OR "duracionReservada" > 0);
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_availability_end_after_start"
  CHECK ("disponibleHasta" IS NULL OR "disponibleHasta" > "fecha_hora");
CREATE INDEX "Cita_barberoId_estado_fecha_hora_idx"
  ON "Cita" ("barberoId", "estado", "fecha_hora");
