-- Run only in the disposable schedule_tests database, with -v test_schema=<unique name>.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'schedule_tests' THEN RAISE EXCEPTION 'Only schedule_tests is allowed'; END IF;
END $$;
CREATE SCHEMA :"test_schema";
SET search_path TO :"test_schema", public;
CREATE TABLE "User" (LIKE public."User" INCLUDING ALL);
CREATE TABLE "BarberProfile" (LIKE public."BarberProfile" INCLUDING ALL);
CREATE TABLE "Cita" (LIKE public."Cita" INCLUDING ALL);
INSERT INTO "User" (id, nombre, email, password, telefono, foto_perfil, rol, aprobado)
VALUES (900000001, 'Pendiente anterior', 'pending@test.invalid', 'unused', '912345678', 'foto-conservada', 'barbero', false),
       (900000002, 'Aprobado anterior', 'approved@test.invalid', 'unused', NULL, NULL, 'barbero', true);
INSERT INTO "BarberProfile" (id, "usuarioId", "bancoNroCuenta", foto_perfil)
VALUES (900000001, 900000001, 'cuenta-conservada', 'foto-conservada');
INSERT INTO "Cita" (id, "barberoId", "clienteId", fecha_hora, estado, "duracionReservada", "comprobanteTransferencia")
VALUES ('reserva-conservada', 900000001, 900000002, '2035-01-15 15:00:00', 'confirmada', 30, 'comprobante-conservado');
CREATE TABLE baseline AS SELECT
  (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM "User" u) AS usuarios,
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM "BarberProfile" p) AS perfiles,
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM "Cita" c) AS citas;
\ir ../prisma/migrations/20261015000000_availability_and_applications/migration.sql
\ir ../prisma/migrations/20261015010000_complete_existing_profile_columns/migration.sql
DO $$ BEGIN
  IF (SELECT usuarios FROM baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM "User" u)
    OR (SELECT perfiles FROM baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM "BarberProfile" p)
    OR (SELECT citas FROM baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM "Cita" c)
  THEN RAISE EXCEPTION 'Existing data changed'; END IF;
  IF (SELECT count(*) FROM "SolicitudProfesional") <> 1
    OR NOT EXISTS (SELECT 1 FROM "SolicitudProfesional" WHERE "usuarioId" = 900000001 AND estado = 'pendiente' AND "fechaResolucion" IS NULL)
  THEN RAISE EXCEPTION 'Legacy application not preserved correctly'; END IF;
END $$;
SELECT 'PASS: users, profile, bank data, photo, proof and reservation unchanged; legacy request pending' AS resultado;
