export function newPasswordError(password: string): string | null {
  if (password.length < 12) return 'La contraseña nueva debe tener al menos 12 caracteres';
  if (/^\s+$/.test(password)) return 'La contraseña no puede contener solo espacios';
  if (new TextEncoder().encode(password).length > 72) return 'La contraseña no puede superar 72 bytes (algunos caracteres ocupan más de un byte)';
  return null;
}
export function registrationError(value: { nombre: string; email: string; password: string; telefono: string }): string | null {
  if (!value.nombre) return 'El nombre es obligatorio';
  if (!/^[\p{L}\s]+$/u.test(value.nombre)) return 'El nombre solo puede contener letras';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 254) return 'Ingresa un correo electrónico válido';
  const passwordError = newPasswordError(value.password);
  if (passwordError) return passwordError;
  if (!/^\d{9}$/.test(value.telefono)) return 'El teléfono debe contener exactamente 9 números';
  return null;
}
