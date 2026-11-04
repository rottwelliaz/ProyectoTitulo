export const roles = ['cliente', 'barbero', 'admin'] as const;
export type Role = typeof roles[number];

export const privateRoutes: Record<string, readonly Role[]> = {
  '/perfil': roles,
  '/mis-citas': ['cliente'],
  '/configuracion': roles,
  '/booking': ['cliente'],
  '/mensajes': ['cliente', 'barbero'],
  '/perfil-profesional': ['barbero'],
  '/admin': ['admin'],
  '/admin-barberos': ['admin'],
};

export const normalizePath = (path: string) => path.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/';
export const isRole = (role: unknown): role is Role => roles.includes(role as Role);
export const roleHome = (role: Role, aprobado = true) => role === 'admin' ? '/admin' : role === 'barbero' ? (aprobado ? '/perfil-profesional' : '/perfil') : '/home';
export const canAccess = (path: string, role: Role, aprobado = true) => {
  if (role === 'barbero' && !aprobado && ['/perfil-profesional', '/mensajes'].includes(normalizePath(path))) return false;
  const allowedRoles = privateRoutes[normalizePath(path)];
  return !allowedRoles || allowedRoles.includes(role);
};

/** Only known, same-origin destinations are accepted, including their query/hash. */
export function loginDestination(requested: string | null, role: Role, aprobado = true): string {
  const fallback = roleHome(role, aprobado);
  if (!requested || !requested.startsWith('/') || /[\\\u0000-\u0020]/.test(requested)) return fallback;
  try {
    const url = new URL(requested, 'https://local.invalid');
    const path = normalizePath(decodeURIComponent(url.pathname));
    const known = Object.hasOwn(privateRoutes, path) || ['/', '/home', '/barberos', '/barbero'].includes(path);
    if (url.origin !== 'https://local.invalid' || !known || !canAccess(path, role, aprobado)) return fallback;
    return `${path}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
