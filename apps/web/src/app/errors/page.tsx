'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface ErrorLog {
  id: string;
  objectType: string;
  direction: string;
  sourceId: string;
  errorCode: string;
  errorMessage: string;
  resolved: boolean;
  retryCount: number;
  createdAt: string;
}

const OBJECT_TYPES = ['contact', 'deal', 'note'];
const PAGE_SIZE = 20;

function formatDirection(dir: string): string {
  if (dir === 'hs_to_mc') return 'HubSpot → MyCase';
  if (dir === 'mc_to_hs') return 'MyCase → HubSpot';
  return dir;
}

function truncateId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) + '…' : id;
}

function ErrorsContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installationId') ?? '';

  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const [filterObjectType, setFilterObjectType] = useState('');
  const [filterResolved, setFilterResolved] = useState('false');

  const [actionStates, setActionStates] = useState<Record<string, 'loading' | 'done' | null>>({});

  const fetchLogs = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    setFetchError(false);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filterObjectType) params.set('objectType', filterObjectType);
      if (filterResolved !== '') params.set('resolved', filterResolved);
      const res = await fetch(`${API_BASE}/installations/${installationId}/error-logs?${params}`);
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { data: ErrorLog[]; total: number };
      setLogs(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [installationId, offset, filterObjectType, filterResolved]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const unresolvedCount = logs.filter((l) => !l.resolved).length;

  const handleAction = async (id: string, type: 'retry' | 'resolve') => {
    setActionStates((prev) => ({ ...prev, [id]: 'loading' }));
    try {
      const url =
        type === 'retry'
          ? `${API_BASE}/installations/${installationId}/error-logs/${id}/retry`
          : `${API_BASE}/installations/${installationId}/error-logs/${id}/resolve`;
      const method = type === 'retry' ? 'POST' : 'PATCH';
      await fetch(url, { method });
      setActionStates((prev) => ({ ...prev, [id]: 'done' }));
      setTimeout(() => {
        setActionStates((prev) => { const n = { ...prev }; delete n[id]; return n; });
        void fetchLogs();
      }, 2000);
    } catch {
      setActionStates((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  if (!installationId) {
    return (
      <div className="p-8">
        <MissingId />
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Error Log</h1>
          <p className="text-sm text-slate-500 mt-1">Review and resolve sync errors</p>
        </div>
        <span
          className={`text-sm font-semibold px-3 py-1.5 rounded-full ${
            total === 0 || filterResolved === 'true'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {filterResolved === 'false' && total > 0 ? `${total} unresolved` : filterResolved === 'false' ? 'All clear' : `${total} records`}
        </span>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Object Type</label>
          <select
            value={filterObjectType}
            onChange={(e) => setFilterObjectType(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            {OBJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select
            value={filterResolved}
            onChange={(e) => setFilterResolved(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
            <option value="">All</option>
          </select>
        </div>
        <button
          onClick={() => { setOffset(0); void fetchLogs(); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Apply
        </button>
      </div>

      {/* Table */}
      {fetchError ? (
        <FetchErrorBanner />
      ) : loading ? (
        <SkeletonTable cols={8} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon="check_circle"
          title="No errors found"
          subtitle="When sync errors occur, they will appear here for review and retry."
          iconColor="text-green-300"
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Error Code</th>
                  <th className="px-4 py-3 text-left">Object</th>
                  <th className="px-4 py-3 text-left">Direction</th>
                  <th className="px-4 py-3 text-left">Source ID</th>
                  <th className="px-4 py-3 text-left">Message</th>
                  <th className="px-4 py-3 text-center">Retries</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => {
                  const state = actionStates[log.id];
                  return (
                    <tr
                      key={log.id}
                      className={`hover:bg-slate-50 transition-colors ${log.resolved ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded">
                          {log.errorCode}
                        </span>
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-700">{log.objectType}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDirection(log.direction)}</td>
                      <td
                        className="px-4 py-3 font-mono text-xs text-slate-600"
                        title={log.sourceId}
                      >
                        {truncateId(log.sourceId)}
                      </td>
                      <td
                        className="px-4 py-3 text-sm text-slate-700 max-w-xs truncate"
                        title={log.errorMessage}
                      >
                        {log.errorMessage}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-slate-600">{log.retryCount}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {state === 'loading' ? (
                          <span className="material-symbols-outlined text-[18px] text-slate-400 animate-spin">
                            autorenew
                          </span>
                        ) : state === 'done' ? (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                            Done
                          </span>
                        ) : log.resolved ? (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                            Resolved
                          </span>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => void handleAction(log.id, 'retry')}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline"
                            >
                              Retry
                            </button>
                            <button
                              onClick={() => void handleAction(log.id, 'resolve')}
                              className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                            >
                              Resolve
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
          <span>
            Page {currentPage} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MissingId() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 max-w-md mt-8 text-center">
      <span className="material-symbols-outlined text-[36px] text-amber-400 block mb-3">link_off</span>
      <p className="text-sm font-semibold text-slate-800 mb-1">No installation connected</p>
      <p className="text-xs text-slate-500">Add <code>?installationId=YOUR_ID</code> to the URL.</p>
    </div>
  );
}

function FetchErrorBanner() {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
      <span className="material-symbols-outlined text-[20px]">error_outline</span>
      Failed to load data. Check your API connection.
    </div>
  );
}

function SkeletonTable({ cols }: { cols: number }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 h-10 border-b border-slate-200" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-slate-100">
          {[...Array(cols)].map((_, j) => (
            <div key={j} className="h-4 bg-slate-100 rounded animate-pulse flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
  iconColor = 'text-slate-300',
}: {
  icon: string;
  title: string;
  subtitle: string;
  iconColor?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
      <span className={`material-symbols-outlined text-[48px] ${iconColor} block mb-3`}>{icon}</span>
      <p className="text-sm font-semibold text-slate-700 mb-1">{title}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

export default function ErrorsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <ErrorsContent />
    </Suspense>
  );
}
