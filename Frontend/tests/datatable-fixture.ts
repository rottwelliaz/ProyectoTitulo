import type { Route } from '@playwright/test';

// Existing UI fixtures also serve the new server-side DataTables contract.
export function tableResponse(url: URL, body: any, now = Date.now()) {
  if (url.searchParams.get('datatable') !== '1') return body;
  let rows: any[] = Array.isArray(body) ? body : body?.[url.searchParams.get('table') === 'pendientes' ? 'barberosPendientes' : url.searchParams.get('table') || ''] || [];
  const view = url.searchParams.get('vista');
  if (view && view !== 'todas') rows = rows.filter(item => {
    const historical = new Date(item.fecha_hora).getTime() < now || ['cancelada', 'rechazada', 'finalizada', 'inasistencia'].includes(item.estado);
    return view === 'historial' ? historical : !historical;
  });
  const total = rows.length;
  const search = (url.searchParams.get('search[value]') || '').toLowerCase();
  if (search) rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(search));
  const name = url.searchParams.get('order[0][name]') || 'id';
  const value = (row: any) => name === 'persona' ? row.cliente?.nombre || row.barbero?.usuario?.nombre : name === 'servicio' ? row.servicio?.nombre_servicio : row[name];
  rows = [...rows].sort((a, b) => (String(value(a)).localeCompare(String(value(b)), 'es', { numeric: true })) * (url.searchParams.get('order[0][dir]') === 'asc' ? 1 : -1));
  const length = Number(url.searchParams.get('length') || 10);
  const start = rows.length ? Math.min(Number(url.searchParams.get('start') || 0), Math.floor((rows.length - 1) / length) * length) : 0;
  return { draw: Number(url.searchParams.get('draw') || 0), recordsTotal: total, recordsFiltered: rows.length, start, data: rows.slice(start, start + length) };
}

export async function fulfillDataTable(route: Route, options: Parameters<Route['fulfill']>[0]) {
  const url = new URL(route.request().url());
  if (options?.json !== undefined && (!options.status || options.status < 400)) {
    const now = url.searchParams.has('vista') ? await route.request().frame().evaluate(() => Date.now()).catch(() => Date.now()) : Date.now();
    options = { ...options, json: tableResponse(url, options.json, now) };
  }
  return route.fulfill(options);
}
