// Explicit projections prevent bank fields from leaking through nested relations.
export const professionalSelect = {
  id: true, usuarioId: true, biografia: true, foto_perfil: true,
  lugarTrabajoId: true, requiereComprobante: true,
} as const;

export const bankingSelect = {
  bancoNombre: true, bancoRut: true, bancoNombreBanco: true,
  bancoTipoCuenta: true, bancoNroCuenta: true, bancoCorreo: true,
} as const;
