'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
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

const STAT_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
  processing: 'bg-yellow-100 text-yellow-700',
  total: 'bg-blue-100 text-blue-700',
};

function DashboardPageContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installationId') ?? '';

  const [installation, setInstallation] = useState<Installation | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!installationId) return;
    void fetch(`${API_BASE}/installations/${installationId}`)
      .then((r) => r.json())
      .then(setInstallation);
    void fetch(`${API_BASE}/installations/${installationId}/sync-jobs/stats`)
      .then((r) => r.json())
      .then(setStats);
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
      const data = await res.json();
      setInstallation((prev) => (prev ? { ...prev, syncEnabled: data.syncEnabled } : prev));
    } finally {
      setToggling(false);
    }
  };

  const q = installationId ? `?installationId=${installationId}` : '';

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">MyCase ↔ HubSpot Sync</h1>
          <p className="text-sm text-gray-500">
            Bidirectional sync between HubSpot CRM and MyCase practice management.
          </p>
        </div>
        {installation && (
          <button
            onClick={() => void toggleSync()}
            disabled={toggling}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
              installation.syncEnabled
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
            }`}
          >
            {toggling ? '…' : installation.syncEnabled ? 'Sync: ON' : 'Sync: OFF'}
          </button>
        )}
      </div>

      {/* Connection status */}
      {installation && (
        <div className="flex gap-4 mb-4 flex-wrap text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            HubSpot connected (portal {installation.hubspotPortalId})
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full inline-block ${
                installation.mycaseConnected ? 'bg-green-500' : 'bg-red-400'
              }`}
            />
            MyCase {installation.mycaseConnected ? 'connected' : 'not connected'}
          </span>
        </div>
      )}

      {/* Stats bar */}
      {stats && (
        <div className="flex gap-2 mb-8 flex-wrap">
          {(['success', 'failed', 'skipped', 'processing', 'total'] as const).map((key) => (
            <span
              key={key}
              className={`px-3 py-1 rounded-full text-xs font-medium ${STAT_COLORS[key]}`}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}: {stats[key]}
            </span>
          ))}
        </div>
      )}

      {!installationId && (
        <div className="mb-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          No installation connected.{' '}
          <Link href="/install" className="underline font-medium">
            Connect your accounts
          </Link>{' '}
          to get started.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <NavCard href={`/install${q}`} title="Install & Connect" description="Connect your HubSpot portal and MyCase account" />
        <NavCard href={`/settings/field-mapping${q}`} title="Field Mapping" description="Map fields between HubSpot and MyCase" />
        <NavCard href={`/settings/stage-mapping${q}`} title="Stage Mapping" description="Map deal stages to matter statuses" />
        <NavCard href={`/settings/sync-criteria${q}`} title="Sync Criteria" description="Define rules for which records sync" />
        <NavCard href={`/sync-history${q}`} title="Sync History" description="View the audit trail of all sync activity" />
        <NavCard
          href={`/errors${q}`}
          title="Error Log"
          description={`Review and resolve sync errors${stats?.failed ? ` · ${stats.failed} unresolved` : ''}`}
        />
      </div>
    </main>
  );
}

function NavCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="block p-6 rounded-lg border hover:border-blue-500 transition-colors">
      <h2 className="font-semibold mb-1">{title}</h2>
      <p className="text-sm text-gray-500">{description}</p>
    </Link>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
      <DashboardPageContent />
    </Suspense>
  );
}
