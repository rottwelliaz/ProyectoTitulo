import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import DataTable, { type DataTableRef } from 'datatables.net-react';
import Core from 'datatables.net-dt';
import { listOptions, serverSource, type ListOrder } from '../lib/dataTables';

DataTable.use(Core);
const Renderer = createContext<(row: any) => ReactNode>(() => null);
function Card({ row }: { row: any }) { return <>{useContext(Renderer)(row)}</>; }

export default function PaginatedCards<T>({ endpoint, orders, render, revision = 0, empty, label }: {
  endpoint: string; orders: ListOrder[]; render: (row: T) => ReactNode; revision?: number; empty: string; label: string;
}) {
  const table = useRef<DataTableRef>(null);
  const path = useRef(endpoint); path.current = endpoint;
  const [error, setError] = useState('');
  const [order, setOrder] = useState(0), [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const source = useMemo(() => serverSource(() => path.current, setError), []);
  const slots = useMemo(() => ({ 0: (row: T) => <Card row={row} /> }), []);
  const options = useMemo(() => ({ ...listOptions, language: { ...listOptions.language, emptyTable: empty },
    columns: orders.map((item, index) => ({ name: item.name, data: null, title: item.label, visible: index === 0, ...(index === 0 ? {} : { render: () => '' }) })),
  }), []);
  const previous = useRef({ endpoint, revision });
  useEffect(() => {
    const changedView = previous.current.endpoint !== endpoint;
    if (changedView || previous.current.revision !== revision) table.current?.dt()?.ajax.reload(undefined, changedView);
    previous.current = { endpoint, revision };
  }, [endpoint, revision]);
  useEffect(() => () => source.abort(), [source]);
  const changeOrder = (index: number, dir: 'asc' | 'desc') => { setOrder(index); setDirection(dir); table.current?.dt()?.order([[index, dir]]).draw(); };
  return <Renderer.Provider value={render}><div className="cbc-data-list" aria-label={label}>
    <div className="cbc-list-order"><label>Ordenar por: <select value={order} onChange={event => changeOrder(Number(event.target.value), direction)}>{orders.map((item, index) => <option key={item.name} value={index}>{item.label}</option>)}</select></label>
      <select aria-label="Dirección del orden" value={direction} onChange={event => changeOrder(order, event.target.value as 'asc' | 'desc')}><option value="desc">Descendente</option><option value="asc">Ascendente</option></select></div>
    {error && <p role="alert">{error} <button type="button" onClick={() => table.current?.dt()?.ajax.reload(undefined, false)}>Reintentar</button></p>}
    <DataTable ref={table} className="cbc-card-table" options={options} ajax={source.ajax} slots={slots} />
  </div></Renderer.Provider>;
}
