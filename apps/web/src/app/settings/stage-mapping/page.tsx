'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const MC_STATUSES = ['Open', 'Pending', 'Closed', 'On Hold'];

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

export default function StageMappingPage() {
  const params = useSearchParams();
  const installationId = params.get('installationId') ?? '';

  const [pipelines, setPipelines] = useState<HsPipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState('');
  const [mappings, setMappings] = useState<StageMapping[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPipelines = useCallback(async () => {
    if (!installationId) return;
    try {
      const res = await fetch(
        `${API}/installations/${installationId}/stage-mappings/pipelines`,
      );
      const data = await res.json();
      const list: HsPipeline[] = Array.isArray(data) ? data : [];
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
      const data = await res.json();
      setMappings(Array.isArray(data) ? data : []);
    } catch {
      setMappings([]);
    } finally {
      setLoading(false);
    }
  }, [installationId]);

  useEffect(() => {
    fetchPipelines();
    fetchMappings();
  }, [fetchPipelines, fetchMappings]);

  // Build draft state when pipeline selection or mappings change
  useEffect(() => {
    if (!selectedPipeline) return;
    const pipeline = pipelines.find((p) => p.id === selectedPipeline);
    if (!pipeline) return;
    const next: Record<string, string> = {};
    for (const stage of pipeline.stages) {
      const existing = mappings.find(
        (m) => m.hubspotPipelineId === selectedPipeline && m.hubspotStageId === stage.id,
      );
      next[stage.id] = existing?.mycaseStatus ?? 'Open';
    }
    setDrafts(next);
  }, [selectedPipeline, pipelines, mappings]);

  async function handleSave() {
    const pipeline = pipelines.find((p) => p.id === selectedPipeline);
    if (!pipeline) return;
    setSaving(true);
    setSaved(false);
    try {
      const payload = pipeline.stages.map((stage) => ({
        hubspotPipelineId: selectedPipeline,
        hubspotStageId: stage.id,
        hubspotStageLabel: stage.label,
        mycaseStatus: drafts[stage.id] ?? 'Open',
        direction: 'both',
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
    } finally {
      setSaving(false);
    }
  }

  const currentPipeline = pipelines.find((p) => p.id === selectedPipeline);

  if (!installationId) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-muted-foreground">No installationId provided in URL.</p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Stage Mapping</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Map HubSpot deal stages to MyCase matter statuses
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !currentPipeline}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      {/* Pipeline selector */}
      <div className="mb-6">
        <label className="block text-xs font-medium mb-1">Pipeline</label>
        <select
          value={selectedPipeline}
          onChange={(e) => setSelectedPipeline(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-64"
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Stage mapping table */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !currentPipeline ? (
        <p className="text-sm text-muted-foreground">No pipelines found. Make sure HubSpot is connected.</p>
      ) : currentPipeline.stages.length === 0 ? (
        <p className="text-sm text-muted-foreground">This pipeline has no stages.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-6 font-medium">HubSpot Stage</th>
              <th className="py-2 font-medium">MyCase Status</th>
            </tr>
          </thead>
          <tbody>
            {currentPipeline.stages.map((stage) => (
              <tr key={stage.id} className="border-b hover:bg-gray-50">
                <td className="py-2 pr-6">{stage.label}</td>
                <td className="py-2">
                  <select
                    value={drafts[stage.id] ?? 'Open'}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [stage.id]: e.target.value }))
                    }
                    className="border rounded px-2 py-1 text-sm"
                  >
                    {MC_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
