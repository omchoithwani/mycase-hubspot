'use client';

import { useEffect, useState, Suspense } from 'react';
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
      .then((data) => { setInstallation(data); setLoading(false); });
  }, [installationId]);

  const hsConnected = !!installation;
  const mcConnected = installation?.mycaseConnected ?? false;
  const allDone = hsConnected && mcConnected;

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">Connect Your Accounts</h1>
      <p className="text-sm text-gray-500 mb-8">
        Follow the steps below to connect HubSpot and MyCase.
      </p>

      {loading && <p className="text-sm text-gray-400 mb-4">Loading installation status…</p>}

      {step === 'done' && allDone && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          Both accounts connected! Initial sync has been triggered in the background.
        </div>
      )}

      <ol className="space-y-6">
        {/* Step 1 — HubSpot */}
        <Step
          number={1}
          title="Connect HubSpot"
          description="Authorize access to your HubSpot portal."
          done={hsConnected}
          doneLabel={hsConnected ? `Connected (portal ${installation?.hubspotPortalId})` : undefined}
          actionHref={`${API_BASE}/auth/hubspot/install`}
          actionLabel="Connect HubSpot"
          enabled
        />

        {/* Step 2 — MyCase */}
        <Step
          number={2}
          title="Connect MyCase"
          description="Authorize access to your MyCase account."
          done={mcConnected}
          doneLabel={mcConnected ? 'Connected' : undefined}
          actionHref={
            hsConnected
              ? `${API_BASE}/auth/mycase/connect?installationId=${installationId}`
              : undefined
          }
          actionLabel={mcConnected ? 'Reconnect MyCase' : 'Connect MyCase'}
          enabled={hsConnected}
        />

        {/* Step 3 — Field mapping */}
        <Step
          number={3}
          title="Configure Field Mapping"
          description="Map the fields you want to sync between the two systems."
          done={false}
          actionHref={allDone ? `/settings/field-mapping?installationId=${installationId}` : undefined}
          actionLabel="Go to Field Mapping"
          enabled={allDone}
        />

        {/* Step 4 — Stage mapping */}
        <Step
          number={4}
          title="Review Stage Mapping"
          description="Map HubSpot deal stages to MyCase matter statuses."
          done={false}
          actionHref={allDone ? `/settings/stage-mapping?installationId=${installationId}` : undefined}
          actionLabel="Go to Stage Mapping"
          enabled={allDone}
        />
      </ol>

      {allDone && (
        <div className="mt-10 pt-6 border-t">
          <a
            href={`/?installationId=${installationId}`}
            className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Go to Dashboard →
          </a>
        </div>
      )}
    </main>
  );
}

function Step({
  number,
  title,
  description,
  done,
  doneLabel,
  actionHref,
  actionLabel,
  enabled,
}: {
  number: number;
  title: string;
  description: string;
  done: boolean;
  doneLabel?: string;
  actionHref: string | undefined;
  actionLabel: string;
  enabled: boolean;
}) {
  return (
    <li className="flex gap-4">
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
          done ? 'bg-green-500 text-white' : 'bg-blue-600 text-white'
        }`}
      >
        {done ? '✓' : number}
      </div>
      <div>
        <h2 className="font-semibold">{title}</h2>
        {doneLabel ? (
          <p className="text-sm text-green-600 mb-2">{doneLabel}</p>
        ) : (
          <p className="text-sm text-gray-500 mb-2">{description}</p>
        )}
        {enabled && actionHref ? (
          <a
            href={actionHref}
            className="inline-block text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            {actionLabel}
          </a>
        ) : !enabled ? (
          <span className="inline-block text-sm px-4 py-1.5 rounded-md bg-gray-100 text-gray-400 cursor-not-allowed">
            {actionLabel}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export default function InstallPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
      <InstallPageContent />
    </Suspense>
  );
}
