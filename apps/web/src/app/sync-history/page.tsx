'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface SyncJob {
  id: string;
  objectType: string;
  direction: string;
  sourceId: string;
  destinationId: string | null;
  status: 'success' | 'failed' | 'skipped' | 'processing';
  attemptCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface Stats {
  success: number;
  failed: number;
  skipped: number;
  processing: number;
  total: number;
}

const OBJECT_TYPES = ['contact', 'deal', 'note'];
const STATUSES = ['success', 'failed', 'skipped', 'processing'];
const PAGE_SIZE = 20;

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-gray-100 text-gray-700',
  processing: 'bg-yellow-100 text-yellow-800',
};

function duration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function SyncHistoryPageContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installationId') ?? '';

  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterObjectType, setFilterObjectType] = useState('');

  const fetchStats = useCallback(async () => {
    if (!installationId) return;
    const res = await fetch(
      `${API_BASE}/installations/${installationId}/sync-jobs/stats`,
    );
    setStats(await res.json());
  }, [installationId]);

  const fetchJobs = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filterStatus) params.set('status', filterStatus);
      if (filterObjectType) params.set('objectType', filterObjectType);

      const res = await fetch(
        `${API_BASE}/installations/${installationId}/sync-jobs?${params}`,
      );
      const json = await res.json();
      setJobs(json.data ?? []);
      setTotal(json.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [installationId, offset, filterStatus, filterObjectType]);

  useEffect(() => {
    void fetchStats();
    void fetchJobs();
  }, [fetchStats, fetchJobs]);

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
      <h1 className="text-2xl font-bold mb-6">Sync History</h1>

      {/* Stats bar */}
      {stats && (
        <div className="flex gap-3 mb-6 flex-wrap">
          {(['success', 'failed', 'skipped', 'processing'] as const).map((s) => (
            <span
              key={s}
              className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[s]}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}: {stats[s]}
            </span>
          ))}
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
            Total: {stats.total}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

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

        <button
          onClick={() => { setOffset(0); void fetchJobs(); }}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          Apply
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : jobs.length === 0 ? (
        <div className="border rounded p-8 text-center text-gray-500">
          No sync jobs found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="border px-3 py-2">Object</th>
                <th className="border px-3 py-2">Direction</th>
                <th className="border px-3 py-2">Source ID</th>
                <th className="border px-3 py-2">Destination ID</th>
                <th className="border px-3 py-2">Status</th>
                <th className="border px-3 py-2">Attempts</th>
                <th className="border px-3 py-2">Started</th>
                <th className="border px-3 py-2">Duration</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="border px-3 py-2">{job.objectType}</td>
                  <td className="border px-3 py-2 text-xs">{job.direction}</td>
                  <td className="border px-3 py-2 font-mono text-xs">{job.sourceId}</td>
                  <td className="border px-3 py-2 font-mono text-xs">
                    {job.destinationId ?? '—'}
                  </td>
                  <td className="border px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[job.status] ?? ''}`}
                    >
                      {job.status}
                    </span>
                    {job.errorMessage && (
                      <p
                        className="text-xs text-gray-500 mt-0.5 truncate max-w-[160px]"
                        title={job.errorMessage}
                      >
                        {job.errorMessage}
                      </p>
                    )}
                  </td>
                  <td className="border px-3 py-2 text-center">{job.attemptCount}</td>
                  <td className="border px-3 py-2 text-xs">
                    {new Date(job.startedAt).toLocaleString()}
                  </td>
                  <td className="border px-3 py-2 text-xs">
                    {duration(job.startedAt, job.completedAt)}
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

export default function SyncHistoryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
      <SyncHistoryPageContent />
    </Suspense>
  );
}
