'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const NAV_ITEMS = [
  { icon: 'dashboard', label: 'Dashboard', href: '/' },
  { icon: 'swap_horiz', label: 'Field Mapping', href: '/settings/field-mapping' },
  { icon: 'route', label: 'Stage Mapping', href: '/settings/stage-mapping' },
  { icon: 'filter_alt', label: 'Sync Criteria', href: '/settings/sync-criteria' },
  { icon: 'history', label: 'Sync History', href: '/sync-history' },
  { icon: 'error_outline', label: 'Error Log', href: '/errors', badge: true },
  { icon: 'settings', label: 'Install & Connect', href: '/install' },
];

function SidebarContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installationId') ?? '';
  const q = installationId ? `?installationId=${installationId}` : '';

  const [errorCount, setErrorCount] = useState(0);
  const [syncEnabled, setSyncEnabled] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState('');

  useEffect(() => {
    if (!installationId) return;
    fetch(`${API_BASE}/installations/${installationId}/error-logs?resolved=false&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setErrorCount(d.total ?? 0); })
      .catch(() => {});
    fetch(`${API_BASE}/installations/${installationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setSyncEnabled(d.syncEnabled ?? null); })
      .catch(() => {});
  }, [installationId]);

  const handleManualSync = async () => {
    if (!installationId || syncing) return;
    setSyncing(true);
    setSyncFeedback('');
    try {
      const res = await fetch(
        `${API_BASE}/installations/${installationId}/sync-jobs/trigger`,
        { method: 'POST' },
      );
      setSyncFeedback(res.ok ? 'Sync triggered!' : 'Sync runs automatically.');
    } catch {
      setSyncFeedback('Sync runs automatically.');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncFeedback(''), 3000);
    }
  };

  return (
    <nav className="w-60 bg-[#0f2340] flex flex-col fixed left-0 top-16 bottom-0 z-30">
      <div className="flex-1 overflow-y-auto pt-4 px-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={`${item.href}${q}`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1 transition-all ${
                active
                  ? 'text-white bg-[rgba(253,121,88,0.12)] border-l-2 border-[#fd7958] pl-[10px]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && errorCount > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {errorCount > 99 ? '99+' : errorCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="p-3 border-t border-white/10 space-y-2">
        {syncFeedback && (
          <p className="text-xs text-green-400 text-center">{syncFeedback}</p>
        )}
        <button
          onClick={() => void handleManualSync()}
          disabled={syncing || !installationId}
          className="w-full bg-[#fd7958] hover:bg-[#fb6a44] disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          <span className={`material-symbols-outlined text-[18px] ${syncing ? 'animate-spin' : ''}`}>
            sync
          </span>
          {syncing ? 'Syncing…' : 'Manual Sync Now'}
        </button>
        {syncEnabled !== null && (
          <p className="text-xs text-slate-500 text-center flex items-center justify-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full inline-block ${syncEnabled ? 'bg-green-400' : 'bg-red-400'}`}
            />
            {syncEnabled ? 'Sync: ON' : 'Sync: OFF'}
          </p>
        )}
      </div>
    </nav>
  );
}

export default function Sidebar() {
  return (
    <Suspense fallback={<div className="w-60 bg-[#0f2340] fixed left-0 top-16 bottom-0 z-30" />}>
      <SidebarContent />
    </Suspense>
  );
}
