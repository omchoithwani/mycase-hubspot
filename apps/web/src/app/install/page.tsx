'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Installation {
  id: string;
  hubspotPortalId: string;
  mycaseConnected: boolean;
  syncEnabled: boolean;
}

function InstallPageContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installationId') ?? '';
  const step = searchParams.get('step') ?? '';

  const [installation, setInstallation] = useState<Installation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!installationId) return;
    setLoading(true);
    void fetch(`${API_BASE}/installations/${installationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setInstallation(data as Installation | null);
        setLoading(false);
      });
  }, [installationId]);

  const hsConnected = !!installation;
  const mcConnected = installation?.mycaseConnected ?? false;
  const allDone = hsConnected && mcConnected;

  const q = installationId ? `?installationId=${installationId}` : '';

  return (
    <div className="p-8 max-w-2xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-slate-800">Install & Connect</h1>
        <p className="text-sm text-slate-500 mt-1">
          Follow the steps below to connect HubSpot and MyCase to start syncing.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-500 flex items-center gap-2 mb-6">
          <span className="material-symbols-outlined text-[18px] animate-spin">autorenew</span>
          Loading installation status…
        </div>
      )}

      {/* Success banner */}
      {step === 'done' && allDone && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800 flex items-center gap-3 mb-6">
          <span className="material-symbols-outlined text-[22px] text-green-600">check_circle</span>
          <span>
            Both accounts connected! Initial sync is running in the background.
          </span>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-4">
        {/* Step 1 — HubSpot */}
        <StepCard
          number={1}
          icon="hub"
          iconBg="bg-orange-100"
          iconColor="text-[#fd7958]"
          title="Connect HubSpot"
          description="Authorize access to your HubSpot portal. This grants read/write access to contacts, deals, and notes."
          done={hsConnected}
          doneLabel={hsConnected ? `Connected — Portal ${installation?.hubspotPortalId}` : undefined}
          action={
            <a
              href={`${API_BASE}/auth/hubspot/install`}
              className="inline-flex items-center gap-2 bg-[#fd7958] hover:bg-[#fb6a44] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
              Connect HubSpot
            </a>
          }
          enabled
        />

        {/* Step 2 — MyCase */}
        <StepCard
          number={2}
          icon="gavel"
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
          title="Connect MyCase"
          description="Authorize access to your MyCase account. Required to sync clients, matters, and notes."
          done={mcConnected}
          doneLabel={mcConnected ? 'Connected' : undefined}
          action={
            hsConnected ? (
              <a
                href={`${API_BASE}/auth/mycase/connect?installationId=${installationId}`}
                className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                  mcConnected
                    ? 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    : 'bg-[#fd7958] hover:bg-[#fb6a44] text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                {mcConnected ? 'Reconnect MyCase' : 'Connect MyCase'}
              </a>
            ) : (
              <span className="inline-flex items-center gap-2 bg-slate-100 text-slate-400 text-sm font-medium px-4 py-2 rounded-lg cursor-not-allowed">
                <span className="material-symbols-outlined text-[16px]">lock</span>
                Connect MyCase
              </span>
            )
          }
          enabled={hsConnected}
        />

        {/* Step 3 — Field Mapping */}
        <StepCard
          number={3}
          icon="swap_horiz"
          iconBg="bg-purple-100"
          iconColor="text-purple-600"
          title="Configure Field Mapping"
          description="Map the fields you want to sync between the two systems. Default mappings are seeded automatically."
          done={false}
          action={
            allDone ? (
              <Link
                href={`/settings/field-mapping${q}`}
                className="inline-flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Go to Field Mapping
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2 bg-slate-100 text-slate-400 text-sm font-medium px-4 py-2 rounded-lg cursor-not-allowed">
                <span className="material-symbols-outlined text-[16px]">lock</span>
                Go to Field Mapping
              </span>
            )
          }
          enabled={allDone}
        />

        {/* Step 4 — Stage Mapping */}
        <StepCard
          number={4}
          icon="route"
          iconBg="bg-teal-100"
          iconColor="text-teal-600"
          title="Review Stage Mapping"
          description="Map HubSpot deal stages to MyCase matter statuses. Deals on unmapped stages will be skipped."
          done={false}
          action={
            allDone ? (
              <Link
                href={`/settings/stage-mapping${q}`}
                className="inline-flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Go to Stage Mapping
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2 bg-slate-100 text-slate-400 text-sm font-medium px-4 py-2 rounded-lg cursor-not-allowed">
                <span className="material-symbols-outlined text-[16px]">lock</span>
                Go to Stage Mapping
              </span>
            )
          }
          enabled={allDone}
        />
      </div>

      {/* Footer CTA */}
      {allDone && (
        <div className="mt-8 pt-6 border-t border-slate-200">
          <Link
            href={`/${q}`}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">dashboard</span>
            Go to Dashboard
          </Link>
        </div>
      )}
    </div>
  );
}

function StepCard({
  number,
  icon,
  iconBg,
  iconColor,
  title,
  description,
  done,
  doneLabel,
  action,
  enabled,
}: {
  number: number;
  icon: string;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
  done: boolean;
  doneLabel?: string;
  action: React.ReactNode;
  enabled: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl border p-6 flex gap-5 transition-all ${done ? 'border-green-200' : enabled ? 'border-slate-200' : 'border-slate-100 opacity-75'}`}>
      {/* Step number */}
      <div className="flex-shrink-0 flex flex-col items-center gap-2">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
            done ? 'bg-green-500 text-white' : enabled ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
          }`}
        >
          {done ? (
            <span className="material-symbols-outlined text-[18px]">check</span>
          ) : (
            number
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
              <span className={`material-symbols-outlined text-[18px] ${iconColor}`}>{icon}</span>
            </div>
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          </div>
        </div>
        {doneLabel ? (
          <p className="text-xs text-green-600 flex items-center gap-1 mb-3">
            <span className="material-symbols-outlined text-[14px]">check_circle</span>
            {doneLabel}
          </p>
        ) : (
          <p className="text-sm text-slate-500 mb-4">{description}</p>
        )}
        {action}
      </div>
    </div>
  );
}

export default function InstallPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <InstallPageContent />
    </Suspense>
  );
}
