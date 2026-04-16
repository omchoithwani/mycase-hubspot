'use client';

import { useEffect, useState, useCallback } from 'react';
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

interface HsProperty {
  name: string;
  label: string;
}

const MC_FIELDS: Record<ObjectType, string[]> = {
  contact: ['first_name', 'last_name', 'email', 'phone_numbers[0].number', 'company_name'],
  deal: ['name', 'status', 'close_date', 'rate'],
  note: ['description', 'date'],
};

const DIRECTION_LABELS: Record<Direction, string> = {
  both: 'Both directions',
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

export default function FieldMappingPage() {
  const params = useSearchParams();
  const installationId = params.get('installationId') ?? '';

  const [objectType, setObjectType] = useState<ObjectType>('contact');
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [hsProps, setHsProps] = useState<HsProperty[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const hsObjectType = objectType === 'contact' ? 'contacts' : objectType === 'deal' ? 'deals' : 'notes';

  const fetchMappings = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/installations/${installationId}/field-mappings?objectType=${objectType}`,
      );
      const data = await res.json();
      setMappings(Array.isArray(data) ? data : []);
    } catch {
      setMappings([]);
    } finally {
      setLoading(false);
    }
  }, [installationId, objectType]);

  const fetchHsProps = useCallback(async () => {
    if (!installationId) return;
    try {
      const res = await fetch(
        `${API}/installations/${installationId}/field-mappings/hubspot-properties?objectType=${hsObjectType}`,
      );
      const data = await res.json();
      setHsProps(Array.isArray(data) ? data : []);
    } catch {
      setHsProps([]);
    }
  }, [installationId, hsObjectType]);

  useEffect(() => {
    fetchMappings();
    fetchHsProps();
  }, [fetchMappings, fetchHsProps]);

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
        transformConfig = JSON.parse(form.transformConfig);
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
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
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
    await fetch(`${API}/installations/${installationId}/field-mappings/${id}`, {
      method: 'DELETE',
    });
    await fetchMappings();
  }

  async function handleSeedDefaults() {
    if (!confirm('Seed default field mappings? Existing mappings will not be overwritten.')) return;
    await fetch(`${API}/installations/${installationId}/field-mappings/seed-defaults`, {
      method: 'POST',
    });
    await fetchMappings();
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
          <h1 className="text-2xl font-bold">Field Mapping</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure which fields sync between HubSpot and MyCase
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSeedDefaults}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
          >
            Seed Defaults
          </button>
          <button
            onClick={openAdd}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + Add Mapping
          </button>
        </div>
      </div>

      {/* Object type tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {(['contact', 'deal', 'note'] as ObjectType[]).map((t) => (
          <button
            key={t}
            onClick={() => setObjectType(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              objectType === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Mappings table */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mappings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No mappings configured. Click &ldquo;Seed Defaults&rdquo; to get started.
        </p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4 font-medium">HubSpot Field</th>
              <th className="py-2 pr-4 font-medium">MyCase Field</th>
              <th className="py-2 pr-4 font-medium">Direction</th>
              <th className="py-2 pr-4 font-medium">Transform</th>
              <th className="py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id} className="border-b hover:bg-gray-50">
                <td className="py-2 pr-4 font-mono text-xs">{m.hubspotField}</td>
                <td className="py-2 pr-4 font-mono text-xs">{m.mycaseField}</td>
                <td className="py-2 pr-4 text-xs">{DIRECTION_LABELS[m.direction]}</td>
                <td className="py-2 pr-4 text-xs">{TRANSFORM_LABELS[m.transformType]}</td>
                <td className="py-2 flex gap-2">
                  <button
                    onClick={() => openEdit(m)}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="text-red-500 hover:underline text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">
              {editId ? 'Edit Mapping' : 'Add Mapping'}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">HubSpot Field</label>
                <select
                  value={form.hubspotField}
                  onChange={(e) => setForm({ ...form, hubspotField: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">Select a field…</option>
                  {hsProps.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.label} ({p.name})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">MyCase Field</label>
                <select
                  value={form.mycaseField}
                  onChange={(e) => setForm({ ...form, mycaseField: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">Select a field…</option>
                  {MC_FIELDS[objectType].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Direction</label>
                <select
                  value={form.direction}
                  onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  {(Object.keys(DIRECTION_LABELS) as Direction[]).map((d) => (
                    <option key={d} value={d}>
                      {DIRECTION_LABELS[d]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Transform Type</label>
                <select
                  value={form.transformType}
                  onChange={(e) =>
                    setForm({ ...form, transformType: e.target.value as TransformType })
                  }
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  {(Object.keys(TRANSFORM_LABELS) as TransformType[]).map((t) => (
                    <option key={t} value={t}>
                      {TRANSFORM_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              {['select_remap', 'truncate'].includes(form.transformType) && (
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Transform Config (JSON)
                    {form.transformType === 'select_remap' && (
                      <span className="text-gray-400 font-normal">
                        {' '}
                        — e.g. {`{"map":{"lead":"Lead"}}`}
                      </span>
                    )}
                    {form.transformType === 'truncate' && (
                      <span className="text-gray-400 font-normal">
                        {' '}
                        — e.g. {`{"maxLength":255}`}
                      </span>
                    )}
                  </label>
                  <textarea
                    value={form.transformConfig}
                    onChange={(e) => setForm({ ...form, transformConfig: e.target.value })}
                    rows={3}
                    className="w-full border rounded px-2 py-1.5 text-xs font-mono"
                    placeholder="{}"
                  />
                </div>
              )}

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
