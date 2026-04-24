'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type ObjectType = 'contact' | 'deal' | 'note';
type SourceSystem = 'hubspot' | 'mycase';

interface SyncFilter {
  field: string;
  operator: string;
  value: string;
}

interface SyncFilterGroup {
  filters: SyncFilter[];
}

interface SyncCriteriaRule {
  id: string;
  objectType: string;
  sourceSystem: string;
  ruleName: string | null;
  conditions: SyncFilterGroup[];
  isActive: boolean;
}

const OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: 'EQ', label: 'is equal to' },
  { value: 'NEQ', label: 'is not equal to' },
  { value: 'CONTAINS', label: 'contains' },
  { value: 'NOT_CONTAINS', label: 'does not contain' },
  { value: 'STARTS_WITH', label: 'starts with' },
  { value: 'ENDS_WITH', label: 'ends with' },
  { value: 'GT', label: 'is greater than' },
  { value: 'GTE', label: 'is greater than or equal to' },
  { value: 'LT', label: 'is less than' },
  { value: 'LTE', label: 'is less than or equal to' },
  { value: 'BETWEEN', label: 'is between' },
  { value: 'IN', label: 'is any of' },
  { value: 'NOT_IN', label: 'is none of' },
  { value: 'HAS_PROPERTY', label: 'has a value', noValue: true },
  { value: 'NOT_HAS_PROPERTY', label: 'has no value', noValue: true },
];

const OP_MAP = Object.fromEntries(OPERATORS.map((o) => [o.value, o]));

function valuePlaceholder(op: string): string {
  if (op === 'BETWEEN') return 'e.g. 1000,5000';
  if (op === 'IN' || op === 'NOT_IN') return 'e.g. lead,customer';
  if (['GT', 'GTE', 'LT', 'LTE'].includes(op)) return 'number';
  return 'value';
}

function serializeValue(op: string, raw: string): unknown {
  if (OP_MAP[op]?.noValue) return undefined;
  if (op === 'BETWEEN') {
    const parts = raw.split(',').map((v) => Number(v.trim()));
    return parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) ? parts : raw;
  }
  if (op === 'IN' || op === 'NOT_IN') {
    return raw.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return raw;
}

function deserializeValue(op: string, val: unknown): string {
  if (val == null) return '';
  if (Array.isArray(val)) return (val as unknown[]).join(', ');
  return String(val);
}

function blankFilter(): SyncFilter {
  return { field: '', operator: 'EQ', value: '' };
}

function blankGroup(): SyncFilterGroup {
  return { filters: [blankFilter()] };
}

function SyncCriteriaContent() {
  const params = useSearchParams();
  const installationId = params.get('installationId') ?? '';

  const [objectType, setObjectType] = useState<ObjectType>('contact');
  const [sourceSystem, setSourceSystem] = useState<SourceSystem>('hubspot');
  const [rules, setRules] = useState<SyncCriteriaRule[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [modalObjectType, setModalObjectType] = useState<ObjectType>('contact');
  const [modalSourceSystem, setModalSourceSystem] = useState<SourceSystem>('hubspot');
  const [filterGroups, setFilterGroups] = useState<SyncFilterGroup[]>([blankGroup()]);
  const [modalError, setModalError] = useState('');
  const [saving, setSaving] = useState(false);

  // Test panel
  const [testJson, setTestJson] = useState(
    '{\n  "email": "test@example.com",\n  "amount": "2000",\n  "lifecyclestage": "lead"\n}',
  );
  const [testResult, setTestResult] = useState<{ passed: boolean } | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchRules = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/installations/${installationId}/sync-criteria?objectType=${objectType}&sourceSystem=${sourceSystem}`,
      );
      setRules(res.ok ? ((await res.json()) as SyncCriteriaRule[]) : []);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [installationId, objectType, sourceSystem]);

  useEffect(() => { void fetchRules(); }, [fetchRules]);

  // ── Filter group mutations ──────────────────────────────────────────────────

  function addGroup() {
    setFilterGroups((prev) => [...prev, blankGroup()]);
  }

  function removeGroup(gi: number) {
    setFilterGroups((prev) => prev.filter((_, i) => i !== gi));
  }

  function addFilter(gi: number) {
    setFilterGroups((prev) =>
      prev.map((g, i) => i === gi ? { ...g, filters: [...g.filters, blankFilter()] } : g),
    );
  }

  function removeFilter(gi: number, fi: number) {
    setFilterGroups((prev) =>
      prev.map((g, i) =>
        i === gi ? { ...g, filters: g.filters.filter((_, j) => j !== fi) } : g,
      ),
    );
  }

  function updateFilter(gi: number, fi: number, patch: Partial<SyncFilter>) {
    setFilterGroups((prev) =>
      prev.map((g, i) =>
        i === gi
          ? { ...g, filters: g.filters.map((f, j) => (j === fi ? { ...f, ...patch } : f)) }
          : g,
      ),
    );
  }

  // ── Modal ───────────────────────────────────────────────────────────────────

  function openAdd() {
    setEditId(null);
    setRuleName('');
    setModalObjectType(objectType);
    setModalSourceSystem(sourceSystem);
    setFilterGroups([blankGroup()]);
    setModalError('');
    setShowModal(true);
  }

  function openEdit(rule: SyncCriteriaRule) {
    setEditId(rule.id);
    setRuleName(rule.ruleName ?? '');
    setModalObjectType(rule.objectType as ObjectType);
    setModalSourceSystem(rule.sourceSystem as SourceSystem);
    setFilterGroups(
      rule.conditions.length > 0
        ? rule.conditions.map((g) => ({
            filters: g.filters.map((f) => ({
              field: f.field,
              operator: f.operator,
              value: deserializeValue(f.operator, f.value),
            })),
          }))
        : [blankGroup()],
    );
    setModalError('');
    setShowModal(true);
  }

  async function handleSave() {
    const validGroups = filterGroups
      .map((g) => ({
        filters: g.filters
          .filter((f) => f.field.trim())
          .map((f) => ({
            field: f.field.trim(),
            operator: f.operator,
            value: serializeValue(f.operator, f.value),
          })),
      }))
      .filter((g) => g.filters.length > 0);

    if (validGroups.length === 0) {
      setModalError('Add at least one filter with a field name.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const body = {
        objectType: modalObjectType,
        sourceSystem: modalSourceSystem,
        ruleName: ruleName.trim() || null,
        filterGroups: validGroups,
      };
      const url = editId
        ? `${API}/installations/${installationId}/sync-criteria/${editId}`
        : `${API}/installations/${installationId}/sync-criteria`;
      const res = await fetch(url, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowModal(false);
      await fetchRules();
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(rule: SyncCriteriaRule) {
    await fetch(`${API}/installations/${installationId}/sync-criteria/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    await fetchRules();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this rule?')) return;
    await fetch(`${API}/installations/${installationId}/sync-criteria/${id}`, { method: 'DELETE' });
    await fetchRules();
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const record = JSON.parse(testJson) as Record<string, unknown>;
      const res = await fetch(`${API}/installations/${installationId}/sync-criteria/test-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType, sourceSystem, record }),
      });
      if (res.ok) setTestResult((await res.json()) as { passed: boolean });
    } catch { /* silent */ } finally {
      setTesting(false);
    }
  }

  if (!installationId) {
    return (
      <div className="p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 max-w-md mt-8 text-center">
          <span className="material-symbols-outlined text-[36px] text-amber-400 block mb-3">link_off</span>
          <p className="text-sm font-semibold text-slate-800 mb-1">No installation connected</p>
          <p className="text-xs text-slate-500">Add <code>?installationId=YOUR_ID</code> to the URL.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Sync Criteria</h1>
          <p className="text-sm text-slate-500 mt-1">
            Rules that control which records sync. With no rules, all records sync.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-[#fd7958] hover:bg-[#fb6a44] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add Rule
        </button>
      </div>

      {/* Filters row */}
      <div className="flex gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Object Type</label>
          <select
            value={objectType}
            onChange={(e) => setObjectType(e.target.value as ObjectType)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {(['contact', 'deal', 'note'] as ObjectType[]).map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Source System</label>
          <select
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value as SourceSystem)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="hubspot">HubSpot</option>
            <option value="mycase">MyCase</option>
          </select>
        </div>
      </div>

      {/* Rules list */}
      {loading ? (
        <div className="space-y-3 mb-8">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-4 bg-slate-100 rounded w-1/3 mb-3" />
              <div className="h-3 bg-slate-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center mb-8">
          <span className="material-symbols-outlined text-[48px] text-slate-300 block mb-3">filter_alt</span>
          <p className="text-sm font-semibold text-slate-700 mb-1">No rules configured</p>
          <p className="text-xs text-slate-500 mb-4">
            All records will sync. Add a rule to restrict which records are eligible.
          </p>
          <button
            onClick={openAdd}
            className="bg-[#fd7958] hover:bg-[#fb6a44] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Add Rule
          </button>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`bg-white rounded-xl border p-5 transition-all ${rule.isActive ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {rule.ruleName ?? `Rule ${rule.id.slice(0, 8)}`}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {rule.objectType} · {rule.sourceSystem} · {rule.conditions.length} filter group{rule.conditions.length !== 1 ? 's' : ''}
                  </p>
                  {/* Filter groups preview */}
                  <div className="mt-3 space-y-1">
                    {rule.conditions.map((group, gi) => (
                      <div key={gi}>
                        {gi > 0 && (
                          <p className="text-[10px] font-bold text-[#fd7958] uppercase tracking-wider text-center my-1.5">
                            OR
                          </p>
                        )}
                        <div className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
                          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-1.5">
                            All of these match
                          </p>
                          <div className="space-y-0.5">
                            {group.filters.map((f, fi) => (
                              <p key={fi} className="text-xs font-mono text-slate-700">
                                <span className="font-semibold">{f.field}</span>
                                {' '}
                                <span className="text-slate-500">{OP_MAP[f.operator]?.label ?? f.operator}</span>
                                {!OP_MAP[f.operator]?.noValue && f.value && (
                                  <span className="text-blue-600"> {deserializeValue(f.operator, f.value)}</span>
                                )}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => void toggleActive(rule)}
                    className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${
                      rule.isActive
                        ? 'border-green-200 text-green-700 bg-green-50 hover:bg-green-100'
                        : 'border-slate-200 text-slate-500 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    {rule.isActive ? 'Active' : 'Inactive'}
                  </button>
                  <button onClick={() => openEdit(rule)} className="text-xs text-blue-600 hover:underline font-medium">
                    Edit
                  </button>
                  <button onClick={() => void handleDelete(rule.id)} className="text-xs text-red-500 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Test Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Test Panel</h2>
        <p className="text-xs text-slate-500 mb-4">
          Paste a JSON record to test whether it passes all active rules for the selected object type and source system.
        </p>
        <textarea
          value={testJson}
          onChange={(e) => setTestJson(e.target.value)}
          rows={6}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => void handleTest()}
            disabled={testing}
            className="flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span className={`material-symbols-outlined text-[18px] ${testing ? 'animate-spin' : ''}`}>
              {testing ? 'autorenew' : 'play_arrow'}
            </span>
            {testing ? 'Testing…' : 'Run Test'}
          </button>
          {testResult && (
            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                testResult.passed
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {testResult.passed ? 'check_circle' : 'cancel'}
              </span>
              {testResult.passed ? 'PASS — record would sync' : 'FAIL — record would be skipped'}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-800">
                {editId ? 'Edit Sync Rule' : 'Add Sync Rule'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
              {/* Rule name */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Rule Name <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g. Only sync qualified leads"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Object type + source system */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Object Type</label>
                  <select
                    value={modalObjectType}
                    onChange={(e) => setModalObjectType(e.target.value as ObjectType)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {(['contact', 'deal', 'note'] as ObjectType[]).map((t) => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Source System</label>
                  <select
                    value={modalSourceSystem}
                    onChange={(e) => setModalSourceSystem(e.target.value as SourceSystem)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="hubspot">HubSpot</option>
                    <option value="mycase">MyCase</option>
                  </select>
                </div>
              </div>

              {/* Filter groups */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-medium text-slate-700">Filter Groups</label>
                  <p className="text-xs text-slate-400">
                    Pass <span className="font-semibold text-[#fd7958]">ANY</span> group ·{' '}
                    <span className="font-semibold text-blue-600">ALL</span> filters within group
                  </p>
                </div>

                <div className="space-y-2">
                  {filterGroups.map((group, gi) => (
                    <div key={gi}>
                      {gi > 0 && (
                        <p className="text-[11px] font-bold text-[#fd7958] text-center py-1.5 uppercase tracking-wider">
                          OR
                        </p>
                      )}
                      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                            Group {gi + 1} — ALL must match
                          </p>
                          {filterGroups.length > 1 && (
                            <button
                              onClick={() => removeGroup(gi)}
                              className="text-xs text-red-400 hover:text-red-600 flex items-center gap-0.5"
                            >
                              <span className="material-symbols-outlined text-[14px]">close</span>
                              Remove
                            </button>
                          )}
                        </div>

                        <div className="space-y-2">
                          {group.filters.map((filter, fi) => {
                            const opDef = OP_MAP[filter.operator];
                            return (
                              <div key={fi} className="flex gap-2 items-center">
                                <input
                                  type="text"
                                  placeholder="field"
                                  value={filter.field}
                                  onChange={(e) => updateFilter(gi, fi, { field: e.target.value })}
                                  className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
                                />
                                <select
                                  value={filter.operator}
                                  onChange={(e) =>
                                    updateFilter(gi, fi, { operator: e.target.value, value: '' })
                                  }
                                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
                                  style={{ width: '168px' }}
                                >
                                  {OPERATORS.map((op) => (
                                    <option key={op.value} value={op.value}>{op.label}</option>
                                  ))}
                                </select>
                                {!opDef?.noValue && (
                                  <input
                                    type="text"
                                    placeholder={valuePlaceholder(filter.operator)}
                                    value={filter.value}
                                    onChange={(e) => updateFilter(gi, fi, { value: e.target.value })}
                                    className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                                  />
                                )}
                                <button
                                  onClick={() => removeFilter(gi, fi)}
                                  disabled={group.filters.length === 1 && filterGroups.length === 1}
                                  className="text-slate-300 hover:text-red-500 disabled:opacity-20 transition-colors flex-shrink-0"
                                >
                                  <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        <button
                          onClick={() => addFilter(gi)}
                          className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[14px]">add</span>
                          Add filter
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addGroup}
                  className="w-full mt-2 border border-dashed border-slate-300 hover:border-[#fd7958] text-slate-500 hover:text-[#fd7958] text-xs font-medium py-2 px-4 rounded-xl transition-colors flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add filter group (OR)
                </button>
              </div>

              {modalError && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">error_outline</span>
                  {modalError}
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0">
              <button
                onClick={() => setShowModal(false)}
                className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Save Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SyncCriteriaPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <SyncCriteriaContent />
    </Suspense>
  );
}
