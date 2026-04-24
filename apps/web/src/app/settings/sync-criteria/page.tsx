'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type ObjectType = 'contact' | 'deal' | 'note';
type SourceSystem = 'hubspot' | 'mycase';

interface HsPropertyOption { label: string; value: string }
interface HsProperty {
  name: string;
  label: string;
  type: string;      // 'string' | 'number' | 'enumeration' | 'bool' | 'date' | 'datetime'
  fieldType: string;
  groupName: string;
  options?: HsPropertyOption[];
}

interface SyncFilter { field: string; operator: string; value: string }
interface SyncFilterGroup { filters: SyncFilter[] }
interface SyncCriteriaRule {
  id: string;
  objectType: string;
  sourceSystem: string;
  ruleName: string | null;
  conditions: SyncFilterGroup[];
  isActive: boolean;
}

// Operators available per field type
const OPS_TEXT = ['EQ','NEQ','CONTAINS','NOT_CONTAINS','STARTS_WITH','ENDS_WITH','HAS_PROPERTY','NOT_HAS_PROPERTY'];
const OPS_NUMBER = ['EQ','NEQ','GT','GTE','LT','LTE','BETWEEN','HAS_PROPERTY','NOT_HAS_PROPERTY'];
const OPS_ENUM = ['EQ','NEQ','IN','NOT_IN','HAS_PROPERTY','NOT_HAS_PROPERTY'];
const OPS_BOOL = ['EQ','NEQ','HAS_PROPERTY','NOT_HAS_PROPERTY'];
const OPS_DATE = ['EQ','NEQ','GT','GTE','LT','LTE','HAS_PROPERTY','NOT_HAS_PROPERTY'];
const OPS_ALL = ['EQ','NEQ','CONTAINS','NOT_CONTAINS','STARTS_WITH','ENDS_WITH','GT','GTE','LT','LTE','BETWEEN','IN','NOT_IN','HAS_PROPERTY','NOT_HAS_PROPERTY'];

const ALL_OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
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

const OP_MAP = Object.fromEntries(ALL_OPERATORS.map((o) => [o.value, o]));

function getOpsForType(type: string): typeof ALL_OPERATORS {
  let allowed: string[];
  if (type === 'enumeration') allowed = OPS_ENUM;
  else if (type === 'number') allowed = OPS_NUMBER;
  else if (type === 'bool') allowed = OPS_BOOL;
  else if (type === 'date' || type === 'datetime') allowed = OPS_DATE;
  else if (type === 'string' || type === 'phone_number' || type === 'email') allowed = OPS_TEXT;
  else allowed = OPS_ALL;
  return ALL_OPERATORS.filter((o) => allowed.includes(o.value));
}

function defaultOpForType(type: string): string {
  if (type === 'enumeration') return 'EQ';
  if (type === 'bool') return 'EQ';
  if (type === 'number') return 'EQ';
  return 'EQ';
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
  if (Array.isArray(val)) return (val as unknown[]).join(',');
  return String(val);
}

function blankFilter(): SyncFilter { return { field: '', operator: 'EQ', value: '' }; }
function blankGroup(): SyncFilterGroup { return { filters: [blankFilter()] }; }

// ── Searchable field picker ────────────────────────────────────────────────────

function FieldPicker({
  value,
  onChange,
  properties,
  loading,
}: {
  value: string;
  onChange: (name: string) => void;
  properties: HsProperty[];
  loading: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const selected = properties.find((p) => p.name === value);
  const filtered = properties.filter(
    (p) =>
      !query ||
      p.label.toLowerCase().includes(query.toLowerCase()) ||
      p.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div ref={ref} className="relative" style={{ width: '200px' }}>
      <input
        type="text"
        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder={loading ? 'Loading…' : 'Select field…'}
        value={open ? query : (selected ? selected.label : value)}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && (
        <ul className="absolute z-50 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl max-h-52 overflow-y-auto text-xs">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-slate-400">No fields found</li>
          ) : (
            filtered.map((p) => (
              <li
                key={p.name}
                onMouseDown={() => { onChange(p.name); setOpen(false); setQuery(''); }}
                className={`px-3 py-2 cursor-pointer hover:bg-blue-50 ${p.name === value ? 'bg-blue-100 font-medium' : ''}`}
              >
                <span className="text-slate-800">{p.label}</span>
                <span className="text-slate-400 ml-1">({p.name})</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ── Smart value input ─────────────────────────────────────────────────────────

function ValueInput({
  filter,
  property,
  onChange,
}: {
  filter: SyncFilter;
  property: HsProperty | undefined;
  onChange: (value: string) => void;
}) {
  const opDef = OP_MAP[filter.operator];
  if (opDef?.noValue) return null;

  const options = property?.options ?? [];
  const isEnum = property?.type === 'enumeration' && options.length > 0;
  const isBool = property?.type === 'bool';
  const isNumber = property?.type === 'number';
  const isMulti = filter.operator === 'IN' || filter.operator === 'NOT_IN';

  // Multi-select with checkboxes for IN/NOT_IN on enum fields
  if (isEnum && isMulti) {
    const selected = new Set(
      filter.value.split(',').map((v) => v.trim()).filter(Boolean),
    );
    const toggle = (val: string) => {
      const next = new Set(selected);
      if (next.has(val)) next.delete(val); else next.add(val);
      onChange([...next].join(','));
    };
    return (
      <div className="flex-1 border border-slate-200 rounded-lg bg-white p-2 max-h-32 overflow-y-auto">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 px-1 py-0.5 rounded">
            <input
              type="checkbox"
              checked={selected.has(opt.value)}
              onChange={() => toggle(opt.value)}
              className="accent-blue-600"
            />
            <span className="text-slate-700">{opt.label}</span>
          </label>
        ))}
        {options.length === 0 && (
          <input
            type="text"
            value={filter.value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="value1,value2"
            className="w-full text-xs focus:outline-none"
          />
        )}
      </div>
    );
  }

  // Single-select dropdown for enum EQ/NEQ
  if (isEnum && !isMulti) {
    return (
      <select
        value={filter.value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Select…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  // Bool: True / False dropdown
  if (isBool) {
    return (
      <select
        value={filter.value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Select…</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  // Number inputs (BETWEEN has two)
  if (filter.operator === 'BETWEEN') {
    const parts = filter.value.split(',');
    const lo = parts[0] ?? '';
    const hi = parts[1] ?? '';
    return (
      <div className="flex gap-1 flex-1">
        <input
          type="number"
          placeholder="min"
          value={lo}
          onChange={(e) => onChange(`${e.target.value},${hi}`)}
          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
        />
        <span className="text-xs text-slate-400 self-center">–</span>
        <input
          type="number"
          placeholder="max"
          value={hi}
          onChange={(e) => onChange(`${lo},${e.target.value}`)}
          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
        />
      </div>
    );
  }

  // Default: text or number input
  return (
    <input
      type={isNumber ? 'number' : 'text'}
      placeholder={isNumber ? '0' : 'value'}
      value={filter.value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SyncCriteriaContent() {
  const params = useSearchParams();
  const installationId = params.get('installationId') ?? '';

  const [objectType, setObjectType] = useState<ObjectType>('contact');
  const [sourceSystem, setSourceSystem] = useState<SourceSystem>('hubspot');
  const [rules, setRules] = useState<SyncCriteriaRule[]>([]);
  const [loading, setLoading] = useState(false);

  // HubSpot properties for the field picker
  const [hsProperties, setHsProperties] = useState<HsProperty[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [propsError, setPropsError] = useState('');

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

  const ot2api = (ot: ObjectType) =>
    ot === 'contact' ? 'contacts' : ot === 'deal' ? 'deals' : 'notes';

  const fetchProperties = useCallback(async (ot: ObjectType) => {
    if (!installationId) return;
    setLoadingProps(true);
    setPropsError('');
    try {
      const res = await fetch(
        `${API}/installations/${installationId}/field-mappings/hubspot-properties?objectType=${ot2api(ot)}`,
      );
      if (res.ok) {
        setHsProperties((await res.json()) as HsProperty[]);
      } else {
        setPropsError(`API error ${res.status}: ${res.statusText}`);
      }
    } catch (e: unknown) {
      setPropsError(e instanceof Error ? e.message : 'Failed to load fields');
    } finally {
      setLoadingProps(false);
    }
  }, [installationId]);

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

  // Re-fetch properties when modal object type changes
  useEffect(() => {
    if (showModal) void fetchProperties(modalObjectType);
  }, [showModal, modalObjectType, fetchProperties]);

  // ── Filter group mutations ──────────────────────────────────────────────────

  function addGroup() {
    setFilterGroups((p) => [...p, blankGroup()]);
  }
  function removeGroup(gi: number) {
    setFilterGroups((p) => p.filter((_, i) => i !== gi));
  }
  function addFilter(gi: number) {
    setFilterGroups((p) =>
      p.map((g, i) => i === gi ? { ...g, filters: [...g.filters, blankFilter()] } : g),
    );
  }
  function removeFilter(gi: number, fi: number) {
    setFilterGroups((p) =>
      p.map((g, i) => i === gi ? { ...g, filters: g.filters.filter((_, j) => j !== fi) } : g),
    );
  }
  function updateFilter(gi: number, fi: number, patch: Partial<SyncFilter>) {
    setFilterGroups((p) =>
      p.map((g, i) =>
        i === gi ? { ...g, filters: g.filters.map((f, j) => j === fi ? { ...f, ...patch } : f) } : g,
      ),
    );
  }

  // When field changes, reset operator to sensible default for the field type
  function handleFieldChange(gi: number, fi: number, fieldName: string) {
    const prop = hsProperties.find((p) => p.name === fieldName);
    const op = prop ? defaultOpForType(prop.type) : 'EQ';
    updateFilter(gi, fi, { field: fieldName, operator: op, value: '' });
  }

  // When operator changes, reset value
  function handleOperatorChange(gi: number, fi: number, op: string) {
    updateFilter(gi, fi, { operator: op, value: '' });
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
      setModalError('Add at least one filter with a field selected.');
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
          <p className="text-xs text-slate-500 mb-4">All records will sync. Add a rule to restrict which records are eligible.</p>
          <button onClick={openAdd} className="bg-[#fd7958] hover:bg-[#fb6a44] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Add Rule
          </button>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {rules.map((rule) => (
            <div key={rule.id} className={`bg-white rounded-xl border p-5 ${rule.isActive ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {rule.ruleName ?? `Rule ${rule.id.slice(0, 8)}`}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {rule.objectType} · {rule.sourceSystem} · {rule.conditions.length} filter group{rule.conditions.length !== 1 ? 's' : ''}
                  </p>
                  <div className="mt-3 space-y-1">
                    {rule.conditions.map((group, gi) => (
                      <div key={gi}>
                        {gi > 0 && (
                          <p className="text-[10px] font-bold text-[#fd7958] uppercase tracking-wider text-center my-1.5">OR</p>
                        )}
                        <div className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
                          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-1.5">All of these match</p>
                          <div className="space-y-0.5">
                            {group.filters.map((f, fi) => (
                              <p key={fi} className="text-xs font-mono text-slate-700">
                                <span className="font-semibold">{f.field}</span>{' '}
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
                  <button onClick={() => openEdit(rule)} className="text-xs text-blue-600 hover:underline font-medium">Edit</button>
                  <button onClick={() => void handleDelete(rule.id)} className="text-xs text-red-500 hover:underline">Delete</button>
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
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${testResult.passed ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              <span className="material-symbols-outlined text-[18px]">{testResult.passed ? 'check_circle' : 'cancel'}</span>
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

                {loadingProps && (
                  <div className="text-xs text-slate-400 flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-[14px] animate-spin">autorenew</span>
                    Loading fields…
                  </div>
                )}
                {propsError && !loadingProps && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-start gap-2 mb-2">
                    <span className="material-symbols-outlined text-[14px] flex-shrink-0 mt-0.5">error_outline</span>
                    <span>Could not load HubSpot fields: {propsError}. Check that the API is reachable and CORS is configured.</span>
                  </div>
                )}

                <div className="space-y-2">
                  {filterGroups.map((group, gi) => (
                    <div key={gi}>
                      {gi > 0 && (
                        <p className="text-[11px] font-bold text-[#fd7958] text-center py-1.5 uppercase tracking-wider">OR</p>
                      )}
                      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                            Group {gi + 1} — ALL must match
                          </p>
                          {filterGroups.length > 1 && (
                            <button onClick={() => removeGroup(gi)} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[14px]">close</span>Remove
                            </button>
                          )}
                        </div>

                        <div className="space-y-2">
                          {group.filters.map((filter, fi) => {
                            const prop = hsProperties.find((p) => p.name === filter.field);
                            const opsForField = prop ? getOpsForType(prop.type) : ALL_OPERATORS;
                            return (
                              <div key={fi} className="flex gap-2 items-start">
                                {/* Field picker */}
                                <FieldPicker
                                  value={filter.field}
                                  onChange={(v) => handleFieldChange(gi, fi, v)}
                                  properties={hsProperties}
                                  loading={loadingProps}
                                />

                                {/* Operator */}
                                <select
                                  value={filter.operator}
                                  onChange={(e) => handleOperatorChange(gi, fi, e.target.value)}
                                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
                                  style={{ width: '160px' }}
                                >
                                  {opsForField.map((op) => (
                                    <option key={op.value} value={op.value}>{op.label}</option>
                                  ))}
                                </select>

                                {/* Value */}
                                <ValueInput
                                  filter={filter}
                                  property={prop}
                                  onChange={(v) => updateFilter(gi, fi, { value: v })}
                                />

                                {/* Remove */}
                                <button
                                  onClick={() => removeFilter(gi, fi)}
                                  disabled={group.filters.length === 1 && filterGroups.length === 1}
                                  className="text-slate-300 hover:text-red-500 disabled:opacity-20 transition-colors flex-shrink-0 mt-0.5"
                                >
                                  <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        <button onClick={() => addFilter(gi)} className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">add</span>Add filter
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
