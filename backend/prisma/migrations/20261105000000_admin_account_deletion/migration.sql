-- Allow explicit account deletion without weakening ordinary reservation protection.
-- No account or reservation is removed by this migration.
BEGIN;
CREATE OR REPLACE FUNCTION protect_reservation_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado::text <> 'disponible' OR OLD."clienteId" IS NOT NULL OR OLD."servicioId" IS NOT NULL
     OR OLD."nombreServicioReservado" IS NOT NULL OR OLD."precioReservado" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD."clienteId"::text = current_setting('app.account_deletion_user_id', true)
         OR EXISTS (SELECT 1 FROM "BarberProfile" p WHERE p.id = OLD."barberoId"
           AND p."usuarioId"::text = current_setting('app.account_deletion_user_id', true))
         OR EXISTS (SELECT 1 FROM "Service" s JOIN "BarberProfile" p ON p.id = s."perfilBarberoId"
           WHERE s.id = OLD."servicioId" AND p."usuarioId"::text = current_setting('app.account_deletion_user_id', true)) THEN
        RETURN OLD;
      END IF;
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
COMMIT;
