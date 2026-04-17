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

function ErrorsPageContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installationId') ?? '';

  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const [filterObjectType, setFilterObjectType] = useState('');
  const [filterResolved, setFilterResolved] = useState('false');

  const [feedback, setFeedback] = useState<Record<string, string>>({});

  const fetchLogs = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filterObjectType) params.set('objectType', filterObjectType);
      if (filterResolved !== '') params.set('resolved', filterResolved);

      const res = await fetch(
        `${API_BASE}/installations/${installationId}/error-logs?${params}`,
      );
      const json = await res.json();
      setLogs(json.data ?? []);
      setTotal(json.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [installationId, offset, filterObjectType, filterResolved]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const showFeedback = (id: string, msg: string) => {
    setFeedback((prev) => ({ ...prev, [id]: msg }));
    setTimeout(
      () => setFeedback((prev) => { const n = { ...prev }; delete n[id]; return n; }),
      3000,
    );
  };

  const handleResolve = async (id: string) => {
    await fetch(
      `${API_BASE}/installations/${installationId}/error-logs/${id}/resolve`,
      { method: 'PATCH' },
    );
    showFeedback(id, '✓ Resolved');
    void fetchLogs();
  };

  const handleRetry = async (id: string) => {
    await fetch(
      `${API_BASE}/installations/${installationId}/error-logs/${id}/retry`,
      { method: 'POST' },
    );
    showFeedback(id, '✓ Retried');
    void fetchLogs();
  };

  if (!installationId) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-12">
        <p className="text-red-500">Missing installationId query parameter.</p>
      </main>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-6">Error Log</h1>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <select
          value={filterObjectType}
          onChange={(e) => setFilterObjectType(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All Object Types</option>
          {OBJECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={filterResolved}
          onChange={(e) => setFilterResolved(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
          <option value="">All</option>
        </select>

        <button
          onClick={() => { setOffset(0); void fetchLogs(); }}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          Apply
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : logs.length === 0 ? (
        <div className="border rounded p-8 text-center text-gray-500">
          No error logs found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="border px-3 py-2">Error Code</th>
                <th className="border px-3 py-2">Object</th>
                <th className="border px-3 py-2">Direction</th>
                <th className="border px-3 py-2">Source ID</th>
                <th className="border px-3 py-2">Message</th>
                <th className="border px-3 py-2">Retries</th>
                <th className="border px-3 py-2">Created</th>
                <th className="border px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className={log.resolved ? 'opacity-50' : ''}>
                  <td className="border px-3 py-2 font-mono text-xs text-red-600">
                    {log.errorCode}
                  </td>
                  <td className="border px-3 py-2">{log.objectType}</td>
                  <td className="border px-3 py-2 text-xs">{log.direction}</td>
                  <td className="border px-3 py-2 font-mono text-xs">{log.sourceId}</td>
                  <td
                    className="border px-3 py-2 max-w-xs truncate"
                    title={log.errorMessage}
                  >
                    {log.errorMessage}
                  </td>
                  <td className="border px-3 py-2 text-center">{log.retryCount}</td>
                  <td className="border px-3 py-2 text-xs">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="border px-3 py-2">
                    {feedback[log.id] ? (
                      <span className="text-green-600 text-xs font-medium">
                        {feedback[log.id]}
                      </span>
                    ) : log.resolved ? (
                      <span className="text-green-600 text-xs">Resolved</span>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleRetry(log.id)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Retry
                        </button>
                        <button
                          onClick={() => void handleResolve(log.id)}
                          className="text-gray-600 hover:underline text-xs"
                        >
                          Resolve
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center gap-4 mt-4 text-sm">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {currentPage} of {totalPages} ({total} total)
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}

export default function ErrorsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
      <ErrorsPageContent />
    </Suspense>
  );
}
