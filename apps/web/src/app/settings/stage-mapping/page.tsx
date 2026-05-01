'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const MC_STATUSES = ['open', 'closed'];

interface HsStage {
  id: string;
  label: string;
}

interface HsPipeline {
  id: string;
  label: string;
  stages: HsStage[];
}

interface StageMapping {
  id: string;
  hubspotPipelineId: string;
  hubspotStageId: string;
  hubspotStageLabel: string;
  mycaseStatus: string;
  direction: string;
}

function StageMappingContent() {
  const params = useSearchParams();
  const installationId = params.get('installationId') ?? '';

  const [pipelines, setPipelines] = useState<HsPipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState('');
  const [mappings, setMappings] = useState<StageMapping[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [directionDrafts, setDirectionDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const fetchPipelines = useCallback(async () => {
    if (!installationId) return;
    try {
      const res = await fetch(`${API}/installations/${installationId}/stage-mappings/pipelines`);
      const data = (await res.json()) as HsPipeline[];
      const list = Array.isArray(data) ? data : [];
      setPipelines(list);
      if (list.length > 0 && !selectedPipeline) {
        setSelectedPipeline(list[0].id);
      }
    } catch {
      setPipelines([]);
    }
  }, [installationId, selectedPipeline]);

  const fetchMappings = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/installations/${installationId}/stage-mappings`);
      const data = (await res.json()) as StageMapping[];
      setMappings(Array.isArray(data) ? data : []);
    } catch {
      setMappings([]);
    } finally {
      setLoading(false);
    }
  }, [installationId]);

  useEffect(() => {
    void fetchPipelines();
    void fetchMappings();
  }, [fetchPipelines, fetchMappings]);

  useEffect(() => {
    if (!selectedPipeline) return;
    const pipeline = pipelines.find((p) => p.id === selectedPipeline);
    if (!pipeline) return;
    const next: Record<string, string> = {};
    const nextDir: Record<string, string> = {};
    for (const stage of pipeline.stages) {
      const existing = mappings.find(
        (m) => m.hubspotPipelineId === selectedPipeline && m.hubspotStageId === stage.id,
      );
      next[stage.id] = existing?.mycaseStatus ?? 'open';
      nextDir[stage.id] = existing?.direction ?? 'both';
    }
    setDrafts(next);
    setDirectionDrafts(nextDir);
  }, [selectedPipeline, pipelines, mappings]);

  const handleSave = async () => {
    const pipeline = pipelines.find((p) => p.id === selectedPipeline);
    if (!pipeline) return;
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const payload = pipeline.stages.map((stage) => ({
        hubspotPipelineId: selectedPipeline,
        hubspotStageId: stage.id,
        hubspotStageLabel: stage.label,
        mycaseStatus: drafts[stage.id] ?? 'open',
        direction: directionDrafts[stage.id] ?? 'both',
      }));
      const res = await fetch(`${API}/installations/${installationId}/stage-mappings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchMappings();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const currentPipeline = pipelines.find((p) => p.id === selectedPipeline);

  if (!installationId) {
    return (
      <div className="p-8">
        <MissingId />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Stage Mapping</h1>
          <p className="text-sm text-slate-500 mt-1">
            Map HubSpot deal stages to MyCase matter statuses
          </p>
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !currentPipeline}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {saving ? (
            <>
              <span className="material-symbols-outlined text-[18px] animate-spin">autorenew</span>
              Saving…
            </>
          ) : saved ? (
            <>
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              Saved
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[18px]">save</span>
              Save
            </>
          )}
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 flex gap-3 mb-6">
        <span className="material-symbols-outlined text-[20px] text-blue-500 flex-shrink-0">info</span>
        <span>
          Deals that reach an unmapped stage will be skipped during sync. Make sure every active
          stage has a corresponding MyCase status.
        </span>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {saveError}
        </div>
      )}

      {/* Pipeline selector */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-sm font-medium text-slate-700">Pipeline:</label>
        <select
          value={selectedPipeline}
          onChange={(e) => setSelectedPipeline(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Stage table */}
      {loading ? (
        <SkeletonTable />
      ) : !currentPipeline ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <span className="material-symbols-outlined text-[48px] text-slate-300 block mb-3">hub</span>
          <p className="text-sm font-semibold text-slate-700 mb-1">No pipelines found</p>
          <p className="text-xs text-slate-500">Make sure HubSpot is connected and has at least one pipeline.</p>
        </div>
      ) : currentPipeline.stages.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">This pipeline has no stages.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">HubSpot Stage</th>
                <th className="px-4 py-3 text-left">MyCase Status</th>
                <th className="px-4 py-3 text-left">Direction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentPipeline.stages.map((stage) => (
                <tr key={stage.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{stage.label}</td>
                  <td className="px-4 py-3">
                    <select
                      value={drafts[stage.id] ?? 'open'}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [stage.id]: e.target.value }))
                      }
                      className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {MC_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={directionDrafts[stage.id] ?? 'both'}
                      onChange={(e) =>
                        setDirectionDrafts((prev) => ({ ...prev, [stage.id]: e.target.value }))
                      }
                      className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="both">Both ↔</option>
                      <option value="hs_to_mc">HubSpot → MyCase</option>
                      <option value="mc_to_hs">MyCase → HubSpot</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function SkeletonTable() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 h-10 border-b border-slate-200" />
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-slate-100">
          <div className="h-4 bg-slate-100 rounded animate-pulse flex-1" />
          <div className="h-4 bg-slate-100 rounded animate-pulse w-32" />
          <div className="h-4 bg-slate-100 rounded animate-pulse w-20" />
        </div>
      ))}
    </div>
  );
}

export default function StageMappingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <StageMappingContent />
    </Suspense>
  );
}
