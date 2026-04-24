'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Installation {
  id: string;
  hubspotPortalId: string;
  mycaseConnected: boolean;
  syncEnabled: boolean;
}

interface Stats {
  success: number;
  failed: number;
  skipped: number;
  processing: number;
  total: number;
}

const STAT_ITEMS: { key: keyof Stats; label: string; color: string; bg: string; border: string }[] = [
  { key: 'success', label: 'Successful', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100' },
  { key: 'failed', label: 'Failed', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-100' },
  { key: 'skipped', label: 'Skipped', color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200' },
  { key: 'processing', label: 'Processing', color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-100' },
  { key: 'total', label: 'Total', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
];

const NAV_CARDS = [
  { href: '/settings/field-mapping', icon: 'swap_horiz', title: 'Field Mapping', desc: 'Map fields between HubSpot and MyCase' },
  { href: '/settings/stage-mapping', icon: 'route', title: 'Stage Mapping', desc: 'Map deal stages to matter statuses' },
  { href: '/settings/sync-criteria', icon: 'filter_alt', title: 'Sync Criteria', desc: 'Rules controlling which records sync' },
  { href: '/sync-history', icon: 'history', title: 'Sync History', desc: 'Audit trail of all sync activity' },
  { href: '/errors', icon: 'error_outline', title: 'Error Log', desc: 'Review and resolve sync errors', badge: true },
  { href: '/install', icon: 'manage_accounts', title: 'Install & Connect', desc: 'Manage account connections' },
];

function DashboardContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installationId') ?? '';
  const q = installationId ? `?installationId=${installationId}` : '';

  const [installation, setInstallation] = useState<Installation | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [toggling, setToggling] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  useEffect(() => {
    if (!installationId) return;
    void fetch(`${API_BASE}/installations/${installationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setInstallation(d as Installation); });
    void fetch(`${API_BASE}/installations/${installationId}/sync-jobs/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setStats(d as Stats); });
    void fetch(`${API_BASE}/installations/${installationId}/error-logs?resolved=false&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setErrorCount((d as { total: number }).total ?? 0); });
  }, [installationId]);

  const toggleSync = async () => {
    if (!installation) return;
    setToggling(true);
    try {
      const res = await fetch(`${API_BASE}/installations/${installation.id}/sync-enabled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !installation.syncEnabled }),
      });
      if (res.ok) {
        const data = (await res.json()) as { syncEnabled: boolean };
        setInstallation((prev) => (prev ? { ...prev, syncEnabled: data.syncEnabled } : prev));
      }
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl">
      {/* Page header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Bidirectional sync between HubSpot CRM and MyCase practice management
          </p>
        </div>
        {installation && (
          <button
            onClick={() => void toggleSync()}
            disabled={toggling}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
              installation.syncEnabled
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {installation.syncEnabled ? 'pause_circle' : 'play_circle'}
            </span>
            {toggling ? '…' : installation.syncEnabled ? 'Sync Enabled' : 'Sync Paused'}
          </button>
        )}
      </div>

      {/* No installation banner */}
      {!installationId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-center gap-3 mb-8">
          <span className="material-symbols-outlined text-[20px] text-amber-500">warning</span>
          <span>
            No installation connected.{' '}
            <Link href="/install" className="font-semibold underline">
              Connect your accounts
            </Link>{' '}
            to get started.
          </span>
        </div>
      )}

      {/* Connection cards */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px] text-[#fd7958]">hub</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800">HubSpot</p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {installation ? `Portal ${installation.hubspotPortalId}` : 'Not connected'}
            </p>
          </div>
          {installation ? (
            <span className="bg-green-100 text-green-700 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0">
              Connected
            </span>
          ) : (
            <Link href={`/install${q}`} className="text-xs text-blue-600 font-medium hover:underline flex-shrink-0">
              Connect →
            </Link>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px] text-blue-600">gavel</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800">MyCase</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {installation?.mycaseConnected ? 'Practice management' : 'Not connected'}
            </p>
          </div>
          {installation?.mycaseConnected ? (
            <span className="bg-green-100 text-green-700 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0">
              Connected
            </span>
          ) : (
            <Link href={`/install${q}`} className="text-xs text-blue-600 font-medium hover:underline flex-shrink-0">
              Connect →
            </Link>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-3 mb-8">
        {STAT_ITEMS.map(({ key, label, color, bg, border }) => (
          <div key={key} className={`${bg} border ${border} rounded-xl p-4 text-center`}>
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{stats ? stats[key] : '—'}</p>
          </div>
        ))}
      </div>

      {/* Quick nav grid */}
      <div className="grid grid-cols-2 gap-4">
        {NAV_CARDS.map(({ href, icon, title, desc, badge }) => (
          <Link
            key={href}
            href={`${href}${q}`}
            className="bg-white rounded-xl border border-slate-200 hover:border-[#fd7958]/40 hover:shadow-sm transition-all p-5 flex gap-4 items-start group"
          >
            <div className="w-9 h-9 rounded-lg bg-slate-100 group-hover:bg-orange-50 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors">
              <span className="material-symbols-outlined text-[20px] text-slate-500 group-hover:text-[#fd7958] transition-colors">
                {icon}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                {title}
                {badge && errorCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {errorCount}
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500 mt-1">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <DashboardContent />
    </Suspense>
  );
}
