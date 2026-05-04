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

const MC_FIELDS: Record<ObjectType, HsProperty[]> = {
  contact: [
    { name: 'first_name', label: 'First Name', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'last_name', label: 'Last Name', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'email', label: 'Email', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'phone_numbers[0].number', label: 'Phone Number', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'company_name', label: 'Company Name', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'status', label: 'Status', type: 'enumeration', fieldType: 'select', groupName: 'client', options: [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }] },
    { name: 'date_of_birth', label: 'Date of Birth', type: 'date', fieldType: 'date', groupName: 'client' },
    { name: 'address', label: 'Address', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'city', label: 'City', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'state', label: 'State', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'zip', label: 'Zip Code', type: 'string', fieldType: 'text', groupName: 'client' },
    { name: 'created_at', label: 'Created At', type: 'datetime', fieldType: 'date', groupName: 'client' },
    { name: 'updated_at', label: 'Updated At', type: 'datetime', fieldType: 'date', groupName: 'client' },
  ],
  deal: [
    { name: 'name', label: 'Case Name', type: 'string', fieldType: 'text', groupName: 'matter' },
    { name: 'status', label: 'Status', type: 'enumeration', fieldType: 'select', groupName: 'matter', options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }] },
    { name: 'practice_area', label: 'Practice Area', type: 'string', fieldType: 'text', groupName: 'matter' },
    { name: 'case_stage', label: 'Case Stage', type: 'string', fieldType: 'text', groupName: 'matter' },
    { name: 'close_date', label: 'Close Date', type: 'date', fieldType: 'date', groupName: 'matter' },
    { name: 'statute_of_limitations', label: 'Statute of Limitations', type: 'date', fieldType: 'date', groupName: 'matter' },
    { name: 'rate', label: 'Rate (cents)', type: 'number', fieldType: 'number', groupName: 'matter' },
    { name: 'billing_method', label: 'Billing Method', type: 'string', fieldType: 'text', groupName: 'matter' },
    { name: 'description', label: 'Description', type: 'string', fieldType: 'text', groupName: 'matter' },
    { name: 'created_at', label: 'Created At', type: 'datetime', fieldType: 'date', groupName: 'matter' },
    { name: 'updated_at', label: 'Updated At', type: 'datetime', fieldType: 'date', groupName: 'matter' },
  ],
  note: [
    { name: 'description', label: 'Description', type: 'string', fieldType: 'textarea', groupName: 'note' },
    { name: 'date', label: 'Date', type: 'date', fieldType: 'date', groupName: 'note' },
    { name: 'created_at', label: 'Created At', type: 'datetime', fieldType: 'date', groupName: 'note' },
    { name: 'updated_at', label: 'Updated At', type: 'datetime', fieldType: 'date', groupName: 'note' },
  ],
};

// Maps MyCase custom field parent_type to our ObjectType
const MC_PARENT_TYPE_MAP: Record<string, ObjectType> = {
  Case: 'deal',
  Contact: 'contact',
  Client: 'contact',
  Note: 'note',
};

// Maps MyCase field_type to HsProperty type
function mcFieldTypeToHs(fieldType: string): { type: string; fieldType: string } {
  switch (fieldType?.toLowerCase()) {
    case 'date': return { type: 'date', fieldType: 'date' };
    case 'number': case 'currency': return { type: 'number', fieldType: 'number' };
    case 'checkbox': case 'boolean': return { type: 'bool', fieldType: 'booleancheckbox' };
    case 'select': case 'dropdown': return { type: 'enumeration', fieldType: 'select' };
    default: return { type: 'string', fieldType: 'text' };
  }
}

// Operators available per field type
const OPS_TEXT = ['EQ','NEQ','CONTAINS','NOT_CONTAINS','STARTS_WITH','ENDS_WITH','HAS_PROPERTY','NOT_HAS_PROPERTY'];
const OPS_NUMBER = ['EQ','NEQ','GT','GTE','LT','LTE','BETWEEN','HAS_PROPERTY','NOT_HAS_PROPERTY'];
const OPS_ENUM = ['EQ','NEQ','IN','NOT_IN','HAS_PROPERTY','NOT_HAS_PROPERTY'];
const OPS_BOOL = ['EQ','NEQ','HAS_PROPERTY','NOT_HAS_PROPERTY'];
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

// Date-specific operators (separate list, not part of ALL_OPERATORS)
const DATE_OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: 'DATE_IS', label: 'is' },
  { value: 'DATE_EQ', label: 'is equal to' },
  { value: 'DATE_BEFORE', label: 'is before' },
  { value: 'DATE_AFTER', label: 'is after' },
  { value: 'DATE_BETWEEN', label: 'is between' },
  { value: 'DATE_GT_DAYS', label: 'is more than X days ago' },
  { value: 'DATE_LT_DAYS', label: 'is less than X days ago' },
  { value: 'HAS_PROPERTY', label: 'is known', noValue: true },
  { value: 'NOT_HAS_PROPERTY', label: 'is unknown', noValue: true },
];

const DATE_PRESETS: { label: string; value: string; divider?: boolean }[] = [
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Today', value: 'today' },
  { label: 'Tomorrow', value: 'tomorrow' },
  { label: '— Week', value: '', divider: true },
  { label: 'Last week', value: 'last_week' },
  { label: 'This week', value: 'this_week' },
  { label: '— Month', value: '', divider: true },
  { label: 'Last month', value: 'last_month' },
  { label: 'This month', value: 'this_month' },
  { label: '— Quarter', value: '', divider: true },
  { label: 'Last quarter', value: 'last_quarter' },
  { label: 'This quarter', value: 'this_quarter' },
  { label: 'Last fiscal quarter', value: 'last_fiscal_quarter' },
  { label: 'This fiscal quarter', value: 'this_fiscal_quarter' },
  { label: '— Year', value: '', divider: true },
  { label: 'Last year', value: 'last_year' },
  { label: 'This year', value: 'this_year' },
  { label: 'Last fiscal year', value: 'last_fiscal_year' },
  { label: 'This fiscal year', value: 'this_fiscal_year' },
];

// Combined lookup for noValue check (covers both normal + date ops)
const ALL_OP_MAP = Object.fromEntries(
  [...ALL_OPERATORS, ...DATE_OPERATORS].map((o) => [o.value, o]),
);
const OP_MAP = ALL_OP_MAP;

function isDateType(type: string, fieldType: string): boolean {
  return type === 'date' || type === 'datetime' || fieldType === 'date';
}

function getOpsForType(type: string, fieldType = ''): typeof ALL_OPERATORS {
  if (isDateType(type, fieldType)) return DATE_OPERATORS;
  let allowed: string[];
  if (type === 'enumeration') allowed = OPS_ENUM;
  else if (type === 'number') allowed = OPS_NUMBER;
  else if (type === 'bool') allowed = OPS_BOOL;
  else if (type === 'string' || type === 'phone_number' || type === 'email') allowed = OPS_TEXT;
  else allowed = OPS_ALL;
  return ALL_OPERATORS.filter((o) => allowed.includes(o.value));
}

function defaultOpForType(type: string, fieldType = ''): string {
  if (isDateType(type, fieldType)) return 'DATE_IS';
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

// ── Date value input ──────────────────────────────────────────────────────────

function DateValueInput({ filter, onChange }: { filter: SyncFilter; onChange: (v: string) => void }) {
  const cls = 'flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0';

  if (filter.operator === 'DATE_IS') {
    return (
      <select value={filter.value} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">Select period…</option>
        {DATE_PRESETS.map((p, i) =>
          p.divider ? (
            <option key={i} disabled value="">{p.label}</option>
          ) : (
            <option key={p.value} value={p.value}>{p.label}</option>
          ),
        )}
      </select>
    );
  }

  if (filter.operator === 'DATE_EQ' || filter.operator === 'DATE_BEFORE' || filter.operator === 'DATE_AFTER') {
    return (
      <input
        type="date"
        value={filter.value}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
      />
    );
  }

  if (filter.operator === 'DATE_BETWEEN') {
    const parts = filter.value.split(',');
    const lo = parts[0] ?? '';
    const hi = parts[1] ?? '';
    return (
      <div className="flex gap-1 flex-1 items-center">
        <input type="date" value={lo} onChange={(e) => onChange(`${e.target.value},${hi}`)} className={cls} />
        <span className="text-xs text-slate-400 flex-shrink-0">and</span>
        <input type="date" value={hi} onChange={(e) => onChange(`${lo},${e.target.value}`)} className={cls} />
      </div>
    );
  }

  if (filter.operator === 'DATE_GT_DAYS' || filter.operator === 'DATE_LT_DAYS') {
    return (
      <div className="flex gap-1 flex-1 items-center">
        <input
          type="number"
          min="0"
          placeholder="7"
          value={filter.value}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
          style={{ width: '80px', flex: 'none' }}
        />
        <span className="text-xs text-slate-500 flex-shrink-0">days ago</span>
      </div>
    );
  }

  return null;
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

  // Date field: delegate to DateValueInput
  if (property && isDateType(property.type, property.fieldType)) {
    return <DateValueInput filter={filter} onChange={onChange} />;
  }

  const options = (property?.options ?? []).filter((o) => !(o as { hidden?: boolean }).hidden);
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
            <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} className="accent-blue-600" />
            <span className="text-slate-700">{opt.label}</span>
          </label>
        ))}
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
        <input type="number" placeholder="min" value={lo} onChange={(e) => onChange(`${e.target.value},${hi}`)} className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0" />
        <span className="text-xs text-slate-400 self-center">–</span>
        <input type="number" placeholder="max" value={hi} onChange={(e) => onChange(`${lo},${e.target.value}`)} className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0" />
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
  const [mcCustomFields, setMcCustomFields] = useState<HsProperty[]>([]);
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
  const [testMode, setTestMode] = useState<'email' | 'id'>('email');
  const [testInput, setTestInput] = useState('');
  type FilterDetail = { field: string; operator: string; value: unknown; actualValue: unknown; passed: boolean };
  type GroupDetail = { passed: boolean; filters: FilterDetail[] };
  type RuleDetail = { ruleId: string; ruleName: string | null; passed: boolean; groups: GroupDetail[] };

  const [testResult, setTestResult] = useState<{
    passed: boolean;
    recordId: string;
    detail?: { passed: boolean; rules: RuleDetail[] };
    properties: Record<string, unknown>;
  } | null>(null);
  const [testError, setTestError] = useState('');
  const [testing, setTesting] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncNowDone, setSyncNowDone] = useState(false);

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

  const fetchMcCustomFields = useCallback(async () => {
    if (!installationId) return;
    try {
      const res = await fetch(`${API}/installations/${installationId}/field-mappings/mycase-custom-fields`);
      if (!res.ok) return;
      const raw = (await res.json()) as Array<{ name: string; parent_type: string; field_type: string; list_options?: Array<{ key: string; option: string }> }>;
      const mapped: HsProperty[] = raw.map((f) => {
        const { type, fieldType } = mcFieldTypeToHs(f.field_type);
        return {
          name: `custom.${f.name}`,
          label: `${f.name} (custom)`,
          type,
          fieldType,
          groupName: f.parent_type,
          options: f.list_options?.map((o) => ({ label: o.option, value: o.key })),
        };
      });
      setMcCustomFields(mapped);
    } catch { /* non-fatal */ }
  }, [installationId]);

  // Re-fetch properties when modal opens or object type / source changes
  useEffect(() => {
    if (!showModal) return;
    if (modalSourceSystem === 'hubspot') {
      void fetchProperties(modalObjectType);
    } else {
      void fetchMcCustomFields();
    }
  }, [showModal, modalObjectType, modalSourceSystem, fetchProperties, fetchMcCustomFields]);

  const mcParentType = modalObjectType === 'deal' ? 'Case' : modalObjectType === 'contact' ? 'Contact' : 'Note';
  const activeProperties =
    modalSourceSystem === 'mycase'
      ? [
          ...(MC_FIELDS[modalObjectType] ?? []),
          ...mcCustomFields.filter((f) => f.groupName === mcParentType || f.groupName === 'Client'),
        ]
      : hsProperties;

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
    const prop = activeProperties.find((p) => p.name === fieldName);
    const op = prop ? defaultOpForType(prop.type, prop.fieldType) : 'EQ';
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
    if (!testInput.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestError('');
    setSyncNowDone(false);
    try {
      const body: Record<string, unknown> = { objectType, sourceSystem };
      if (testMode === 'email') {
        body.email = testInput.trim();
      } else {
        body.recordId = testInput.trim();
      }
      const res = await fetch(`${API}/installations/${installationId}/sync-criteria/test-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try { msg = (await res.json() as { message?: string }).message ?? msg; } catch { /* */ }
        setTestError(msg);
        return;
      }
      setTestResult((await res.json()) as { passed: boolean; recordId: string; properties: Record<string, unknown>; detail?: { passed: boolean; rules: RuleDetail[] } });
    } catch (e: unknown) {
      setTestError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setTesting(false);
    }
  }

  async function handleSyncNow(force = false) {
    if (!testResult || objectType === 'note') return;
    setSyncingNow(true);
    setSyncNowDone(false);
    try {
      const direction = sourceSystem === 'hubspot' ? 'hs_to_mc' : 'mc_to_hs';
      await fetch(`${API}/installations/${installationId}/sync-jobs/force-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType, recordId: testResult.recordId, direction, force }),
      });
      setSyncNowDone(true);
    } finally {
      setSyncingNow(false);
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
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Live Record Test</h2>
        <p className="text-xs text-slate-500 mb-4">
          Fetch a real HubSpot record and test it against all active sync criteria rules.
        </p>

        {objectType === 'note' ? (
          <p className="text-xs text-slate-400 italic">Live testing is only available for contacts and deals.</p>
        ) : (
          <>
            {/* Mode toggle — email only available for contacts */}
            <div className="flex gap-0 mb-3 border border-slate-200 rounded-lg overflow-hidden w-fit">
              {objectType === 'contact' && sourceSystem === 'hubspot' && (
                <button
                  onClick={() => { setTestMode('email'); setTestInput(''); setTestResult(null); setTestError(''); }}
                  className={`text-xs font-medium px-3 py-1.5 transition-colors ${testMode === 'email' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  By Email
                </button>
              )}
              <button
                onClick={() => { setTestMode('id'); setTestInput(''); setTestResult(null); setTestError(''); }}
                className={`text-xs font-medium px-3 py-1.5 transition-colors ${testMode === 'id' || objectType === 'deal' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                By Record ID
              </button>
            </div>

            {/* Input + button */}
            <div className="flex gap-2 mb-3">
              <input
                type={testMode === 'email' && objectType === 'contact' && sourceSystem === 'hubspot' ? 'email' : 'text'}
                placeholder={testMode === 'email' && sourceSystem === 'hubspot' ? 'contact@example.com' : sourceSystem === 'mycase' ? `MyCase ${objectType === 'contact' ? 'client' : 'case'} ID` : 'HubSpot record ID'}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleTest()}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => void handleTest()}
                disabled={testing || !testInput.trim()}
                className="flex items-center gap-2 bg-[#fd7958] hover:bg-[#fb6a44] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                <span className={`material-symbols-outlined text-[18px] ${testing ? 'animate-spin' : ''}`}>
                  {testing ? 'autorenew' : 'travel_explore'}
                </span>
                {testing ? 'Fetching…' : 'Find & Test'}
              </button>
            </div>

            {/* Error */}
            {testError && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-start gap-2">
                <span className="material-symbols-outlined text-[14px] flex-shrink-0 mt-0.5">error_outline</span>
                <span>{testError}</span>
              </div>
            )}

            {/* Result */}
            {testResult && (
              <div className="space-y-3">
                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold ${testResult.passed ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                  <span className="material-symbols-outlined text-[20px]">{testResult.passed ? 'check_circle' : 'cancel'}</span>
                  <span>{testResult.passed ? 'PASS — this record would sync' : 'FAIL — this record would be skipped'}</span>
                  <span className="ml-auto text-xs font-normal opacity-70">ID: {testResult.recordId}</span>
                </div>

                {/* Criteria breakdown — always shown */}
                {testResult.detail && testResult.detail.rules.length > 0 && (
                  <div className="space-y-2">
                    {testResult.detail.rules.map((rule) => (
                      <div key={rule.ruleId} className={`border rounded-xl overflow-hidden ${rule.passed ? 'border-green-200' : 'border-red-200'}`}>
                        <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold ${rule.passed ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                          <span className="material-symbols-outlined text-[14px]">{rule.passed ? 'check_circle' : 'cancel'}</span>
                          {rule.ruleName ?? `Rule ${rule.ruleId.slice(0, 8)}`}
                        </div>
                        <div className="divide-y divide-slate-100">
                          {rule.groups.map((group, gi) => (
                            <div key={gi} className="px-4 py-2.5 bg-white">
                              {rule.groups.length > 1 && (
                                <p className="text-[10px] font-bold text-[#fd7958] uppercase tracking-wider mb-1.5">
                                  {gi > 0 ? 'OR — ' : ''}Group {gi + 1} {group.passed ? '✓' : '✗'}
                                </p>
                              )}
                              <div className="space-y-1.5">
                                {group.filters.map((f, fi) => (
                                  <div key={fi} className={`flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5 ${f.passed ? 'bg-green-50' : 'bg-red-50'}`}>
                                    <span className={`material-symbols-outlined text-[14px] flex-shrink-0 mt-0.5 ${f.passed ? 'text-green-600' : 'text-red-500'}`}>
                                      {f.passed ? 'check' : 'close'}
                                    </span>
                                    <div className="min-w-0">
                                      <span className="font-mono font-semibold text-slate-700">{f.field}</span>
                                      {' '}<span className="text-slate-500">{f.operator}</span>
                                      {f.value != null && <span className="text-blue-600 font-mono"> {Array.isArray(f.value) ? (f.value as unknown[]).join(', ') : String(f.value)}</span>}
                                      {!f.passed && (
                                        <span className="ml-2 text-red-600">
                                          (actual: <span className="font-mono">{f.actualValue != null ? String(f.actualValue) : <em>empty</em>}</span>)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                    {testResult.passed && (
                      <button
                        onClick={() => void handleSyncNow(false)}
                        disabled={syncingNow || syncNowDone}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <span className={`material-symbols-outlined text-[16px] ${syncingNow ? 'animate-spin' : ''}`}>
                          {syncingNow ? 'autorenew' : 'sync'}
                        </span>
                        {syncingNow ? 'Queuing…' : syncNowDone ? 'Queued!' : 'Sync Now'}
                      </button>
                    )}
                    <button
                      onClick={() => void handleSyncNow(true)}
                      disabled={syncingNow || syncNowDone}
                      className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <span className={`material-symbols-outlined text-[16px] ${syncingNow ? 'animate-spin' : ''}`}>
                        {syncingNow ? 'autorenew' : 'bolt'}
                      </span>
                      {syncingNow ? 'Queuing…' : syncNowDone ? 'Queued!' : 'Force Sync'}
                    </button>
                    {syncNowDone && (
                      <span className="text-xs text-slate-500">Job enqueued — check Sync History to track progress.</span>
                    )}
                  </div>

                {/* Properties preview */}
                <details className="border border-slate-200 rounded-xl overflow-hidden">
                  <summary className="px-4 py-2.5 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-50 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">expand_more</span>
                    Record properties ({Object.keys(testResult.properties).filter((k) => testResult.properties[k] != null && testResult.properties[k] !== '').length} non-empty)
                  </summary>
                  <div className="max-h-64 overflow-y-auto border-t border-slate-100">
                    <table className="w-full text-xs">
                      <tbody>
                        {Object.entries(testResult.properties)
                          .filter(([, v]) => v != null && v !== '')
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([k, v]) => (
                            <tr key={k} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="px-4 py-1.5 font-mono text-slate-500 w-1/2">{k}</td>
                              <td className="px-4 py-1.5 text-slate-800 w-1/2 truncate max-w-0">{String(v)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            )}
          </>
        )}
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
                    <span>Could not load {modalSourceSystem === 'mycase' ? 'MyCase' : 'HubSpot'} fields: {propsError}.</span>
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
                            const prop = activeProperties.find((p) => p.name === filter.field);
                            const opsForField = prop ? getOpsForType(prop.type, prop.fieldType) : ALL_OPERATORS;
                            return (
                              <div key={fi} className="flex gap-2 items-start">
                                {/* Field picker */}
                                <FieldPicker
                                  value={filter.field}
                                  onChange={(v) => handleFieldChange(gi, fi, v)}
                                  properties={activeProperties}
                                  loading={modalSourceSystem === 'hubspot' && loadingProps}
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
