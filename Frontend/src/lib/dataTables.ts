import DataTable, { type Api, type Options, type AjaxFunction } from 'datatables.net-dt';
import { authFetch, API_URL } from './session';
import '../styles/data-tables.css';

export type ListOrder = { name: string; label: string };
export const appointmentOrders: ListOrder[] = [{ name: 'fecha_hora', label: 'Fecha' }, { name: 'persona', label: 'Nombre' }, { name: 'servicio', label: 'Servicio' }, { name: 'estado', label: 'Estado' }];
export const userOrders: ListOrder[] = [{ name: 'fecha_creacion', label: 'Fecha de registro' }, { name: 'nombre', label: 'Nombre' }, { name: 'email', label: 'Correo' }, { name: 'activo', label: 'Estado' }];

export const listOptions: Options = {
  serverSide: true, processing: true, deferRender: true, autoWidth: false,
  pageLength: 10, lengthMenu: [10, 25, 50], searchDelay: 350,
  order: [[0, 'desc']],
  layout: { topStart: 'pageLength', topEnd: 'search', bottomStart: 'info', bottomEnd: { paging: { firstLast: false, buttons: 5 } } },
  language: {
    search: 'Buscar:', searchPlaceholder: 'Buscar registros', lengthMenu: 'Mostrar _MENU_ registros',
    info: 'Mostrando _START_ a _END_ de _TOTAL_ registros', infoEmpty: 'Mostrando 0 a 0 de 0 registros',
    infoFiltered: '(de _MAX_ registros en total)', emptyTable: 'No hay registros disponibles.', zeroRecords: 'No se encontraron registros.',
    processing: 'Cargando registros...', loadingRecords: 'Cargando registros...',
    paginate: { previous: 'Anterior', next: 'Siguiente', first: 'Primera', last: 'Última' },
    aria: { paginate: { previous: 'Página anterior', next: 'Página siguiente', first: 'Primera página', last: 'Última página', number: 'Página ' } },
  },
};

// One request per draw. Abort superseded requests and ignore late responses.
export function serverSource(endpoint: () => string, onError: (message: string) => void, onRows?: (rows: any[]) => void) {
  let controller: AbortController | undefined;
  let generation = 0;
  const ajax: AjaxFunction = (request, callback, settings) => {
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    const params = new URLSearchParams({ datatable: '1', draw: String(request.draw ?? 0), start: String(request.start ?? 0), length: String(request.length ?? 10),
      'search[value]': request.search?.value ?? '', 'order[0][name]': request.columns?.[request.order?.[0]?.column ?? 0]?.name || '',
      'order[0][dir]': request.order?.[0]?.dir || 'desc' });
    const path = endpoint();
    void (async () => {
      try {
        onError('');
        const response = await authFetch(`${API_URL}${path}${path.includes('?') ? '&' : '?'}${params}`, {
          signal: controller!.signal, headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'No se pudieron cargar los registros.');
        if (!Array.isArray(result.data) || !Number.isInteger(result.recordsFiltered) || !Number.isInteger(result.recordsTotal)) throw new Error('La respuesta del listado no es válida.');
        if (current !== generation) return;
        if (Number.isInteger(result.start) && result.start !== request.start) new DataTable.Api(settings).page(result.start / (request.length ?? 10));
        onRows?.(result.data);
        callback(result);
      } catch (error) {
        if (current !== generation || controller?.signal.aborted) return;
        onError(error instanceof Error ? error.message : 'No se pudieron cargar los registros.');
        callback({ draw: request.draw, recordsTotal: 0, recordsFiltered: 0, data: [] });
      }
    })();
  };
  return { ajax, abort: () => { generation++; controller?.abort(); } };
}

export function orderControls(orders: ListOrder[], change: (index: number, direction: 'asc' | 'desc') => void) {
  const controls = document.createElement('div');
  controls.className = 'cbc-list-order';
  const label = document.createElement('label');
  label.append('Ordenar por: ');
  const select = document.createElement('select');
  orders.forEach(order => { const option = document.createElement('option'); option.textContent = order.label; select.append(option); });
  label.append(select);
  const direction = document.createElement('select');
  direction.setAttribute('aria-label', 'Dirección del orden');
  for (const [value, text] of [['desc', 'Descendente'], ['asc', 'Ascendente']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; direction.append(option); }
  const update = () => change(select.selectedIndex, direction.value as 'asc' | 'desc');
  select.addEventListener('change', update); direction.addEventListener('change', update);
  controls.append(label, direction);
  return controls;
}

// Astro owns the host; DataTables alone owns its table and rows.
export function mountCardTable(host: HTMLElement, config: { endpoint: string; label: string; orders: ListOrder[]; render: (row: any) => string; empty: string; onRows?: (rows: any[]) => void; onDraw?: () => void }) {
  host.replaceChildren();
  host.classList.add('cbc-data-list');
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Reintentar'; retry.hidden = true;
  const table = document.createElement('table'); table.className = 'cbc-card-table'; table.setAttribute('aria-label', config.label);
  let api: Api;
  const source = serverSource(() => config.endpoint, message => { error.textContent = message; error.hidden = !message; retry.hidden = !message; }, config.onRows);
  host.append(orderControls(config.orders, (index, direction) => api.order([[index, direction]]).draw()), error, retry, table);
  api = new DataTable(table, { ...listOptions, ajax: source.ajax,
    language: { ...listOptions.language, emptyTable: config.empty },
    columns: config.orders.map((order, index) => ({ name: order.name, data: null, title: order.label, visible: index === 0, render: index === 0 ? (row, type) => type === 'display' ? config.render(row) : '' : () => '' })),
    drawCallback: () => config.onDraw?.(),
  });
  retry.addEventListener('click', () => api.ajax.reload(undefined, false));
  const destroy = () => { source.abort(); api.destroy(); document.removeEventListener('astro:before-swap', destroy); };
  document.addEventListener('astro:before-swap', destroy, { once: true });
  return {
    reload: () => api.ajax.reload(undefined, false),
    setEndpoint: (endpoint: string) => { config.endpoint = endpoint; api.ajax.reload(undefined, true); },
    destroy,
  };
}
