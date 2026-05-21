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
  changedFields: string[] | null;
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

const STATUS_STYLE: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-600',
  processing: 'bg-yellow-100 text-yellow-700',
};

const STAT_ITEMS: { key: keyof Stats; label: string; color: string; bg: string; border: string }[] = [
  { key: 'success', label: 'Successful', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100' },
  { key: 'failed', label: 'Failed', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-100' },
  { key: 'skipped', label: 'Skipped', color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200' },
  { key: 'processing', label: 'Processing', color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-100' },
  { key: 'total', label: 'Total', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
];

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncateId(id: string | null): string {
  if (!id) return '—';
  return id.length > 12 ? id.slice(0, 12) + '…' : id;
}

function formatDirection(dir: string): string {
  if (dir === 'hs_to_mc') return 'HubSpot → MyCase';
  if (dir === 'mc_to_hs') return 'MyCase → HubSpot';
  return dir;
}

function highlight(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-slate-900 rounded">{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}

function ChangedFieldsBadge({ fields }: { fields: string[] | null }) {
  const [open, setOpen] = useState(false);
  if (!fields || fields.length === 0) return <span className="text-xs text-slate-300">—</span>;
  return (
    <div className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium hover:bg-blue-100 transition-colors"
      >
        <span>{fields.length} field{fields.length !== 1 ? 's' : ''}</span>
        <span className="text-blue-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-10 top-full left-0 mt-1 min-w-[180px] max-w-[280px] bg-white border border-slate-200 rounded-lg shadow-lg p-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-1">Changed fields</p>
          <ul className="space-y-0.5">
            {fields.map((f) => (
              <li key={f} className="font-mono text-xs text-slate-700 bg-slate-50 rounded px-2 py-1 truncate" title={f}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SyncHistoryContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installationId') ?? '';

  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterObjectType, setFilterObjectType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const fetchStats = useCallback(async () => {
    if (!installationId) return;
    try {
      const res = await fetch(`${API_BASE}/installations/${installationId}/sync-jobs/stats`);
      if (res.ok) setStats((await res.json()) as Stats);
    } catch { /* silent */ }
  }, [installationId]);

  const fetchJobs = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    setFetchError(false);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filterStatus) params.set('status', filterStatus);
      if (filterObjectType) params.set('objectType', filterObjectType);
      if (appliedSearch) params.set('search', appliedSearch);
      const res = await fetch(`${API_BASE}/installations/${installationId}/sync-jobs?${params}`);
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { data: SyncJob[]; total: number };
      setJobs(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [installationId, offset, filterStatus, filterObjectType, appliedSearch]);

  useEffect(() => {
    void fetchStats();
    void fetchJobs();
  }, [fetchStats, fetchJobs]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!installationId) return;
    const interval = setInterval(() => {
      void fetchStats();
      void fetchJobs();
    }, 30_000);
    return () => clearInterval(interval);
  }, [installationId, fetchStats, fetchJobs]);

  const applyFilters = () => {
    setAppliedSearch(searchInput);
    setOffset(0);
  };

  const clearSearch = () => {
    setSearchInput('');
    setAppliedSearch('');
    setOffset(0);
  };

  if (!installationId) {
    return (
      <div className="p-8 max-w-5xl">
        <MissingId />
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-slate-800">Sync History</h1>
        <p className="text-sm text-slate-500 mt-1">Complete audit trail of all sync activity</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {STAT_ITEMS.map(({ key, label, color, bg, border }) => (
          <div key={key} className={`${bg} border ${border} rounded-xl p-4 text-center`}>
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{stats ? stats[key] : '—'}</p>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex gap-3 mb-5 items-end flex-wrap">
        {/* Search */}
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Search by Record ID</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none">
              🔍
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="HubSpot ID or MyCase ID…"
              className="w-full border border-slate-200 rounded-lg pl-8 pr-8 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchInput && (
              <button
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
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
        <button
          onClick={applyFilters}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Apply
        </button>
        {appliedSearch && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            <span>Searching: <strong>{appliedSearch}</strong></span>
            <button onClick={clearSearch} className="text-blue-400 hover:text-blue-600 font-bold">×</button>
          </div>
        )}
      </div>

      {/* Table */}
      {fetchError ? (
        <FetchErrorBanner />
      ) : loading ? (
        <SkeletonTable cols={9} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon="history"
          title={appliedSearch ? `No results for "${appliedSearch}"` : 'No sync jobs found'}
          subtitle={appliedSearch ? 'Try a different ID or clear the search.' : 'Sync activity will appear here once the integration is running.'}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Object</th>
                  <th className="px-4 py-3 text-left">Direction</th>
                  <th className="px-4 py-3 text-left">Source ID</th>
                  <th className="px-4 py-3 text-left">Destination ID</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Changed Fields</th>
                  <th className="px-4 py-3 text-center">Attempts</th>
                  <th className="px-4 py-3 text-left">Started</th>
                  <th className="px-4 py-3 text-left">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 capitalize text-slate-800 font-medium">{job.objectType}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDirection(job.direction)}</td>
                    <td
                      className="px-4 py-3 font-mono text-xs text-slate-600"
                      title={job.sourceId}
                    >
                      {appliedSearch
                        ? highlight(job.sourceId, appliedSearch)
                        : truncateId(job.sourceId)}
                    </td>
                    <td
                      className="px-4 py-3 font-mono text-xs text-slate-600"
                      title={job.destinationId ?? ''}
                    >
                      {appliedSearch && job.destinationId
                        ? highlight(job.destinationId, appliedSearch)
                        : truncateId(job.destinationId)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[job.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {job.status}
                      </span>
                      {job.errorMessage && (
                        <p
                          className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]"
                          title={job.errorMessage}
                        >
                          {job.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ChangedFieldsBadge fields={job.changedFields} />
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{job.attemptCount}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(job.startedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDuration(job.startedAt, job.completedAt)}
                    </td>
                  </tr>
                ))}
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

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
      <span className="material-symbols-outlined text-[48px] text-slate-300 block mb-3">{icon}</span>
      <p className="text-sm font-semibold text-slate-700 mb-1">{title}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

export default function SyncHistoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <SyncHistoryContent />
    </Suspense>
  );
}
