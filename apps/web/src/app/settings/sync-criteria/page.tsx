'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type ObjectType = 'contact' | 'deal' | 'note';
type SourceSystem = 'hubspot' | 'mycase';
type LogicOperator = 'AND' | 'OR';
type Operator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'in'
  | 'not_in'
  | 'is_set'
  | 'is_not_set';

const OPERATORS: { value: Operator; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
  { value: 'in', label: 'is one of (comma separated)' },
  { value: 'not_in', label: 'is not one of' },
  { value: 'is_set', label: 'is set' },
  { value: 'is_not_set', label: 'is not set' },
];

const VALUE_LESS_OPERATORS: Operator[] = ['is_set', 'is_not_set'];

interface Condition {
  field: string;
  operator: Operator;
  value?: string;
}

interface SyncCriteriaRule {
  id: string;
  objectType: string;
  sourceSystem: string;
  ruleName: string | null;
  logicOperator: LogicOperator;
  conditions: Condition[];
  isActive: boolean;
}

const BLANK_CONDITION: Condition = { field: '', operator: 'equals', value: '' };

function blankRule(): Omit<SyncCriteriaRule, 'id' | 'isActive'> {
  return {
    objectType: 'contact',
    sourceSystem: 'hubspot',
    ruleName: '',
    logicOperator: 'AND',
    conditions: [{ ...BLANK_CONDITION }],
  };
}

export default function SyncCriteriaPage() {
  const params = useSearchParams();
  const installationId = params.get('installationId') ?? '';

  const [objectType, setObjectType] = useState<ObjectType>('contact');
  const [sourceSystem, setSourceSystem] = useState<SourceSystem>('hubspot');
  const [rules, setRules] = useState<SyncCriteriaRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankRule());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Test panel state
  const [testJson, setTestJson] = useState('{\n  "email": "test@example.com",\n  "amount": "2000"\n}');
  const [testResult, setTestResult] = useState<{ passed: boolean } | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchRules = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/installations/${installationId}/sync-criteria?objectType=${objectType}&sourceSystem=${sourceSystem}`,
      );
      setRules(await res.json());
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [installationId, objectType, sourceSystem]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  function openAdd() {
    setEditId(null);
    setForm({ ...blankRule(), objectType, sourceSystem });
    setError('');
    setShowModal(true);
  }

  function openEdit(rule: SyncCriteriaRule) {
    setEditId(rule.id);
    setForm({
      objectType: rule.objectType,
      sourceSystem: rule.sourceSystem as SourceSystem,
      ruleName: rule.ruleName ?? '',
      logicOperator: rule.logicOperator,
      conditions: rule.conditions.length > 0 ? rule.conditions : [{ ...BLANK_CONDITION }],
    });
    setError('');
    setShowModal(true);
  }

  function updateCondition(index: number, patch: Partial<Condition>) {
    setForm((prev) => {
      const conds = [...prev.conditions];
      conds[index] = { ...conds[index], ...patch };
      return { ...prev, conditions: conds };
    });
  }

  function addCondition() {
    setForm((prev) => ({ ...prev, conditions: [...prev.conditions, { ...BLANK_CONDITION }] }));
  }

  function removeCondition(index: number) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index),
    }));
  }

  async function handleSave() {
    const validConds = form.conditions.filter((c) => c.field.trim());
    if (validConds.length === 0) {
      setError('At least one condition with a field name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        objectType: form.objectType,
        sourceSystem: form.sourceSystem,
        ruleName: form.ruleName || null,
        logicOperator: form.logicOperator,
        conditions: validConds.map((c) => ({
          field: c.field.trim(),
          operator: c.operator,
          value: VALUE_LESS_OPERATORS.includes(c.operator)
            ? undefined
            : c.operator === 'in' || c.operator === 'not_in'
            ? (c.value ?? '').split(',').map((v) => v.trim()).filter(Boolean)
            : c.value,
        })),
      };
      const url = editId
        ? `${API}/installations/${installationId}/sync-criteria/${editId}`
        : `${API}/installations/${installationId}/sync-criteria`;
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowModal(false);
      await fetchRules();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
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
      const record = JSON.parse(testJson);
      const res = await fetch(
        `${API}/installations/${installationId}/sync-criteria/test-all`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectType, sourceSystem, record }),
        },
      );
      setTestResult(await res.json());
    } catch {
      setTestResult(null);
    } finally {
      setTesting(false);
    }
  }

  if (!installationId) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-muted-foreground">No installationId provided in URL.</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Sync Criteria</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define rules controlling which records are eligible for sync
          </p>
        </div>
        <button
          onClick={openAdd}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + Add Rule
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium mb-1">Object Type</label>
          <select
            value={objectType}
            onChange={(e) => setObjectType(e.target.value as ObjectType)}
            className="border rounded px-2 py-1.5 text-sm"
          >
            {(['contact', 'deal', 'note'] as ObjectType[]).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Source System</label>
          <select
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value as SourceSystem)}
            className="border rounded px-2 py-1.5 text-sm"
          >
            <option value="hubspot">HubSpot</option>
            <option value="mycase">MyCase</option>
          </select>
        </div>
      </div>

      {/* Rules list */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rules configured. All records will sync.
        </p>
      ) : (
        <div className="space-y-3 mb-8">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`border rounded-lg p-4 ${rule.isActive ? '' : 'opacity-50'}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">
                    {rule.ruleName ?? `Rule ${rule.id.slice(0, 8)}`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Match{' '}
                    <span className="font-medium text-blue-600">{rule.logicOperator}</span>{' '}
                    of {rule.conditions.length} condition{rule.conditions.length !== 1 ? 's' : ''}
                  </p>
                  <ul className="mt-2 space-y-0.5">
                    {rule.conditions.map((c, i) => (
                      <li key={i} className="text-xs font-mono text-gray-600">
                        {c.field} {c.operator.replace('_', ' ')}{' '}
                        {!VALUE_LESS_OPERATORS.includes(c.operator as Operator) && (
                          <span className="text-blue-600">
                            {Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex gap-2 ml-4 shrink-0">
                  <button
                    onClick={() => toggleActive(rule)}
                    className={`text-xs px-2 py-1 rounded border ${
                      rule.isActive
                        ? 'border-green-300 text-green-700'
                        : 'border-gray-300 text-gray-500'
                    }`}
                  >
                    {rule.isActive ? 'Active' : 'Inactive'}
                  </button>
                  <button onClick={() => openEdit(rule)} className="text-xs text-blue-600 hover:underline">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(rule.id)} className="text-xs text-red-500 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Test Panel */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <h2 className="text-sm font-semibold mb-2">Test Panel</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Paste a record JSON to test whether it passes all active rules for the selected object type + source system.
        </p>
        <textarea
          value={testJson}
          onChange={(e) => setTestJson(e.target.value)}
          rows={5}
          className="w-full border rounded px-2 py-1.5 text-xs font-mono mb-3"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Run Test'}
          </button>
          {testResult && (
            <span
              className={`text-sm font-medium ${
                testResult.passed ? 'text-green-600' : 'text-red-500'
              }`}
            >
              {testResult.passed ? '✓ PASS — record would sync' : '✗ FAIL — record would be skipped'}
            </span>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-semibold mb-4">
              {editId ? 'Edit Rule' : 'Add Rule'}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Rule Name (optional)</label>
                <input
                  type="text"
                  value={form.ruleName ?? ''}
                  onChange={(e) => setForm({ ...form, ruleName: e.target.value })}
                  placeholder="e.g. Only sync qualified leads"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1">Object Type</label>
                  <select
                    value={form.objectType}
                    onChange={(e) => setForm({ ...form, objectType: e.target.value })}
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  >
                    {['contact', 'deal', 'note'].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1">Source System</label>
                  <select
                    value={form.sourceSystem}
                    onChange={(e) => setForm({ ...form, sourceSystem: e.target.value as SourceSystem })}
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  >
                    <option value="hubspot">HubSpot</option>
                    <option value="mycase">MyCase</option>
                  </select>
                </div>
                <div className="w-24">
                  <label className="block text-xs font-medium mb-1">Logic</label>
                  <select
                    value={form.logicOperator}
                    onChange={(e) => setForm({ ...form, logicOperator: e.target.value as LogicOperator })}
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-2">Conditions</label>
                <div className="space-y-2">
                  {form.conditions.map((cond, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <input
                        type="text"
                        placeholder="field"
                        value={cond.field}
                        onChange={(e) => updateCondition(i, { field: e.target.value })}
                        className="flex-1 border rounded px-2 py-1.5 text-xs font-mono min-w-0"
                      />
                      <select
                        value={cond.operator}
                        onChange={(e) => updateCondition(i, { operator: e.target.value as Operator })}
                        className="border rounded px-2 py-1.5 text-xs w-40"
                      >
                        {OPERATORS.map((op) => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>
                      {!VALUE_LESS_OPERATORS.includes(cond.operator) && (
                        <input
                          type="text"
                          placeholder="value"
                          value={cond.value ?? ''}
                          onChange={(e) => updateCondition(i, { value: e.target.value })}
                          className="flex-1 border rounded px-2 py-1.5 text-xs min-w-0"
                        />
                      )}
                      <button
                        onClick={() => removeCondition(i)}
                        className="text-red-400 hover:text-red-600 text-lg leading-none mt-1"
                        title="Remove condition"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addCondition}
                  className="mt-2 text-xs text-blue-600 hover:underline"
                >
                  + Add condition
                </button>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
