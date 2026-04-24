'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Direction = 'both' | 'hs_to_mc' | 'mc_to_hs';
type ObjectType = 'contact' | 'deal' | 'note';
type TransformType =
  | 'direct'
  | 'date_format'
  | 'currency_cents'
  | 'boolean_string'
  | 'select_remap'
  | 'phone_format'
  | 'truncate'
  | 'html_strip';

interface FieldMapping {
  id: string;
  hubspotField: string;
  mycaseField: string;
  direction: Direction;
  transformType: TransformType;
  transformConfig: Record<string, unknown> | null;
}

interface HsProperty { name: string; label: string }
interface McCustomField { id: number; name: string; parent_type: string; field_type: string }

const MC_FIELDS: Record<ObjectType, string[]> = {
  contact: ['first_name', 'last_name', 'middle_name', 'email', 'cell_phone_number', 'work_phone_number', 'home_phone_number', 'birthdate', 'notes', 'address.address1', 'address.city', 'address.state', 'address.zip_code'],
  deal: ['name', 'case_number', 'status', 'case_stage', 'practice_area', 'description', 'opened_date', 'sol_date', 'outstanding_balance'],
  note: ['subject', 'note', 'date'],
};

const DIRECTION_LABELS: Record<Direction, string> = {
  both: 'Both ↔',
  hs_to_mc: 'HubSpot → MyCase',
  mc_to_hs: 'MyCase → HubSpot',
};

const TRANSFORM_LABELS: Record<TransformType, string> = {
  direct: 'Direct copy',
  date_format: 'Date format',
  currency_cents: 'Currency (cents)',
  boolean_string: 'Boolean ↔ string',
  select_remap: 'Value remap',
  phone_format: 'Phone format',
  truncate: 'Truncate',
  html_strip: 'Strip HTML',
};

const BLANK_FORM = {
  hubspotField: '',
  mycaseField: '',
  direction: 'both' as Direction,
  transformType: 'direct' as TransformType,
  transformConfig: '',
};

interface SearchOption { value: string; label: string; group?: string }

function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchOption[];
  placeholder?: string;
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

  const selected = options.find((o) => o.value === value);
  const filtered = options.filter(
    (o) =>
      !query ||
      o.label.toLowerCase().includes(query.toLowerCase()) ||
      o.value.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto text-sm">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-slate-400 text-xs">No results</li>
          ) : (
            filtered.map((o) => (
              <li
                key={o.value}
                onMouseDown={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                className={`px-3 py-2 cursor-pointer hover:bg-blue-50 transition-colors ${o.value === value ? 'bg-blue-100 font-medium' : ''}`}
              >
                {o.group && (
                  <span className="text-slate-400 text-xs mr-1.5">[{o.group}]</span>
                )}
                {o.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function FieldMappingContent() {
  const params = useSearchParams();
  const installationId = params.get('installationId') ?? '';

  const [objectType, setObjectType] = useState<ObjectType>('contact');
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [search, setSearch] = useState('');
  const [hsProps, setHsProps] = useState<HsProperty[]>([]);
  const [mcCustomFields, setMcCustomFields] = useState<McCustomField[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const hsObjectType = objectType === 'contact' ? 'contacts' : objectType === 'deal' ? 'deals' : 'notes';

  const fetchMappings = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    setFetchError(false);
    try {
      const res = await fetch(`${API}/installations/${installationId}/field-mappings?objectType=${objectType}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as FieldMapping[];
      setMappings(Array.isArray(data) ? data : []);
    } catch {
      setFetchError(true);
      setMappings([]);
    } finally {
      setLoading(false);
    }
  }, [installationId, objectType]);

  const fetchHsProps = useCallback(async () => {
    if (!installationId) return;
    try {
      const res = await fetch(`${API}/installations/${installationId}/field-mappings/hubspot-properties?objectType=${hsObjectType}`);
      const data = (await res.json()) as HsProperty[];
      setHsProps(Array.isArray(data) ? data : []);
    } catch {
      setHsProps([]);
    }
  }, [installationId, hsObjectType]);

  const fetchMcCustomFields = useCallback(async () => {
    if (!installationId) return;
    try {
      const res = await fetch(`${API}/installations/${installationId}/field-mappings/mycase-custom-fields`);
      const data = (await res.json()) as McCustomField[];
      setMcCustomFields(Array.isArray(data) ? data : []);
    } catch {
      setMcCustomFields([]);
    }
  }, [installationId]);

  useEffect(() => {
    void fetchMappings();
    void fetchHsProps();
    void fetchMcCustomFields();
  }, [fetchMappings, fetchHsProps, fetchMcCustomFields]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK_FORM);
    setError('');
    setShowModal(true);
  }

  function openEdit(m: FieldMapping) {
    setEditId(m.id);
    setForm({
      hubspotField: m.hubspotField,
      mycaseField: m.mycaseField,
      direction: m.direction,
      transformType: m.transformType,
      transformConfig: m.transformConfig ? JSON.stringify(m.transformConfig, null, 2) : '',
    });
    setError('');
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.hubspotField || !form.mycaseField) {
      setError('HubSpot field and MyCase field are required.');
      return;
    }
    let transformConfig: Record<string, unknown> | undefined;
    if (form.transformConfig.trim()) {
      try {
        transformConfig = JSON.parse(form.transformConfig) as Record<string, unknown>;
      } catch {
        setError('Transform config must be valid JSON.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        objectType,
        hubspotField: form.hubspotField,
        mycaseField: form.mycaseField,
        direction: form.direction,
        transformType: form.transformType,
        transformConfig: transformConfig ?? null,
      };
      const url = editId
        ? `${API}/installations/${installationId}/field-mappings/${editId}`
        : `${API}/installations/${installationId}/field-mappings`;
      const res = await fetch(url, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowModal(false);
      await fetchMappings();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this field mapping?')) return;
    await fetch(`${API}/installations/${installationId}/field-mappings/${id}`, { method: 'DELETE' });
    await fetchMappings();
  }

  async function handleSeedDefaults() {
    if (!confirm('Seed default field mappings? Existing mappings will not be overwritten.')) return;
    await fetch(`${API}/installations/${installationId}/field-mappings/seed-defaults`, { method: 'POST' });
    await fetchMappings();
  }

  if (!installationId) {
    return (
      <div className="p-8">
        <MissingId />
      </div>
    );
  }

  const filteredMappings = mappings.filter((m) => {
    const q = search.toLowerCase();
    return !q || m.hubspotField.toLowerCase().includes(q) || m.mycaseField.toLowerCase().includes(q);
  });

  const mcFieldOptions: SearchOption[] = [
    ...MC_FIELDS[objectType].map((f) => ({ value: f, label: f, group: 'standard' })),
    ...mcCustomFields
      .filter((cf) =>
        objectType === 'contact' ? cf.parent_type === 'client' :
        objectType === 'deal' ? cf.parent_type === 'case' : false,
      )
      .map((cf) => ({
        value: `custom_field:${cf.id}`,
        label: `${cf.name} (${cf.field_type})`,
        group: 'custom',
      })),
  ];

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Field Mapping</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure which fields sync between HubSpot and MyCase
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void handleSeedDefaults()}
            className="flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">auto_fix_high</span>
            Seed Defaults
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-[#fd7958] hover:bg-[#fb6a44] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add Mapping
          </button>
        </div>
      </div>

      {/* Object type tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {(['contact', 'deal', 'note'] as ObjectType[]).map((t) => {
          const count = mappings.filter((m) => m !== undefined).length;
          return (
            <button
              key={t}
              onClick={() => { setObjectType(t); setSearch(''); }}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                objectType === t
                  ? 'border-[#fd7958] text-[#fd7958]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t}
              {objectType === t && mappings.length > 0 && (
                <span className="ml-1.5 bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 rounded-full">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <span className="material-symbols-outlined text-[18px] text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">
          search
        </span>
        <input
          type="text"
          placeholder="Search fields…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      {fetchError ? (
        <FetchErrorBanner />
      ) : loading ? (
        <SkeletonTable />
      ) : filteredMappings.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <span className="material-symbols-outlined text-[48px] text-slate-300 block mb-3">swap_horiz</span>
          <p className="text-sm font-semibold text-slate-700 mb-1">No field mappings yet</p>
          <p className="text-xs text-slate-500 mb-4">
            Click &ldquo;Seed Defaults&rdquo; to start with recommended mappings, or add your own.
          </p>
          <button
            onClick={() => void handleSeedDefaults()}
            className="bg-[#fd7958] hover:bg-[#fb6a44] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Seed Defaults
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">HubSpot Field</th>
                <th className="px-4 py-3 text-left">MyCase Field</th>
                <th className="px-4 py-3 text-left">Direction</th>
                <th className="px-4 py-3 text-left">Transform</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMappings.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                      {m.hubspotField}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                      {m.mycaseField}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{DIRECTION_LABELS[m.direction]}</td>
                  <td className="px-4 py-3">
                    <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                      {TRANSFORM_LABELS[m.transformType]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button
                        onClick={() => openEdit(m)}
                        className="text-xs text-blue-600 hover:underline font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(m.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">
                {editId ? 'Edit Field Mapping' : 'Add Field Mapping'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  HubSpot Field
                </label>
                <SearchableSelect
                  value={form.hubspotField}
                  onChange={(v) => setForm({ ...form, hubspotField: v })}
                  placeholder="Search HubSpot fields…"
                  options={hsProps.map((p) => ({ value: p.name, label: `${p.label} (${p.name})` }))}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  MyCase Field
                </label>
                <SearchableSelect
                  value={form.mycaseField}
                  onChange={(v) => setForm({ ...form, mycaseField: v })}
                  placeholder="Search MyCase fields…"
                  options={mcFieldOptions}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Direction</label>
                <select
                  value={form.direction}
                  onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {(Object.keys(DIRECTION_LABELS) as Direction[]).map((d) => (
                    <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Transform Type</label>
                <select
                  value={form.transformType}
                  onChange={(e) => setForm({ ...form, transformType: e.target.value as TransformType })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {(Object.keys(TRANSFORM_LABELS) as TransformType[]).map((t) => (
                    <option key={t} value={t}>{TRANSFORM_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              {['select_remap', 'truncate'].includes(form.transformType) && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Transform Config (JSON)
                    <span className="text-slate-400 font-normal ml-1">
                      {form.transformType === 'select_remap' && '— e.g. {"map":{"lead":"Lead"}}'}
                      {form.transformType === 'truncate' && '— e.g. {"maxLength":255}'}
                    </span>
                  </label>
                  <textarea
                    value={form.transformConfig}
                    onChange={(e) => setForm({ ...form, transformConfig: e.target.value })}
                    rows={3}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="{}"
                  />
                </div>
              )}

              {error && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">error_outline</span>
                  {error}
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
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
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
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

function FetchErrorBanner() {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
      <span className="material-symbols-outlined text-[20px]">error_outline</span>
      Failed to load data. Check your API connection.
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 h-10 border-b border-slate-200" />
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-slate-100">
          {[...Array(5)].map((_, j) => (
            <div key={j} className="h-4 bg-slate-100 rounded animate-pulse flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function FieldMappingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <FieldMappingContent />
    </Suspense>
  );
}
