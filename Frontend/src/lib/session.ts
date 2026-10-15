import { canAccess, isRole, privateRoutes, normalizePath, roleHome, type Role } from './access';

export const API_URL = (import.meta.env.PUBLIC_API_URL || import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
export interface SessionUser {
  id: number;
  rol: Role;
  nombre: string;
  [key: string]: any;
}

let pending: Promise<SessionUser | null> | undefined;
let checkedToken: string | null = null;
let navigating = false;

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  pending = undefined;
  delete document.documentElement.dataset.userRole;
}

export function redirectToLogin() {
  if (navigating) return;
  navigating = true;
  document.documentElement.dataset.authState = 'pending';
  const destination = `${location.pathname}${location.search}${location.hash}`;
  location.replace(`/login?redirect=${encodeURIComponent(destination)}`);
}

export function cacheSessionUser(user: SessionUser) {
  // Banking data belongs only in the authorized view's memory, never localStorage.
  localStorage.setItem('user', JSON.stringify({ ...user, foto_perfil: null,
    ...(user.perfilBarbero ? { perfilBarbero: {
      id: user.perfilBarbero.id, biografia: user.perfilBarbero.biografia,
      requiereComprobante: user.perfilBarbero.requiereComprobante,
      lugarTrabajo: user.perfilBarbero.lugarTrabajo, foto_perfil: null,
    } } : {}),
  }));
}

function applyUser(user: SessionUser) {
  cacheSessionUser(user);
  window.dispatchEvent(new CustomEvent('profile-photo-change', { detail: user.foto_perfil || user.perfilBarbero?.foto_perfil || null }));
  document.documentElement.dataset.userRole = user.rol;
  document.querySelectorAll<HTMLElement>('[data-roles]').forEach((element) => {
    element.hidden = !element.dataset.roles?.split(' ').includes(user.rol);
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const url = new URL(link.href, location.origin);
    if (url.origin === location.origin && !canAccess(url.pathname, user.rol)) link.hidden = true;
  });
}

export async function getSession(force = false): Promise<SessionUser | null> {
  const token = localStorage.getItem('token');
  if (!token) { clearSession(); return null; }
  if (!force && pending && checkedToken === token) return pending;
  checkedToken = token;
  pending = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store',
      });
      if (localStorage.getItem('token') !== token) return null;
      if ([401, 403].includes(response.status)) { clearSession(); return null; }
      if (!response.ok) throw new Error('No se pudo validar la sesión. Inténtalo nuevamente.');
      const user = await response.json();
      if (!user?.id || !isRole(user.rol)) { clearSession(); return null; }
      if (localStorage.getItem('token') !== token) return null;
      applyUser(user);
      return user as SessionUser;
    } finally {
      window.clearTimeout(timeout);
    }
  })();
  return pending;
}

export async function requireSession(force = false): Promise<SessionUser | null> {
  if (navigating) return null;
  try {
    const user = await getSession(force);
    if (navigating) return null;
    if (!user) { redirectToLogin(); return null; }
    if (!canAccess(location.pathname, user.rol)) {
      navigating = true;
      document.documentElement.dataset.authState = 'pending';
      location.replace(roleHome(user.rol));
      return null;
    }
    document.documentElement.dataset.authState = 'ready';
    return user;
  } catch {
    document.documentElement.dataset.authState = 'error';
    const status = document.querySelector('#session-status');
    if (status) status.textContent = 'No pudimos comprobar tu sesión. Revisa tu conexión y vuelve a intentar.';
    return null;
  }
}

/** Used by private features so expiration during an action also returns to login. */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!(await requireSession())) throw new Error('Se requiere una sesión válida.');
  const response = await fetch(input, init);
  if (response.status === 401) {
    clearSession();
    redirectToLogin();
    throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
  }
  if (response.status === 403) await requireSession(true);
  return response;
}

export function watchSession() {
  if (!privateRoutes[normalizePath(location.pathname)]) return;
  window.addEventListener('storage', (event) => {
    if (event.key === 'token' || event.key === null) {
      document.documentElement.dataset.authState = 'pending';
      // Reload initializes every island with the new user's token and data.
      location.reload();
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      document.documentElement.dataset.authState = 'pending';
      location.reload();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void requireSession(true);
  });
}
