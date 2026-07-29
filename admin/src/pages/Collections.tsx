import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { admin } from '../api'

type FieldDraft = {
  name: string
  type: string
  required: boolean
  unique: boolean
  ref?: string
  defaultValue?: string
}

type Stored = {
  id: string
  name: string
  schema: {
    name: string
    fields: Record<string, any>
    indexes?: any[]
    access?: any
  }
  draft: any
  version: number
  fingerprint: string
  hasDraft: boolean
}

const FIELD_TYPES = [
  'string',
  'text',
  'integer',
  'real',
  'boolean',
  'date',
  'json',
  'reference',
  'vector',
]

export default function Collections() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [fields, setFields] = useState<FieldDraft[]>([
    { name: 'title', type: 'string', required: true, unique: false },
  ])
  const [ownerField, setOwnerField] = useState('authorId')
  const [readAccess, setReadAccess] = useState('authenticated')
  const [message, setMessage] = useState('')

  const list = useQuery({
    queryKey: ['admin', 'schema-collections'],
    queryFn: () => admin<{ data: Stored[] }>('/schema/collections'),
  })

  const status = useQuery({
    queryKey: ['admin', 'schema', 'status'],
    queryFn: () =>
      admin<{ data: { plan: unknown; formatted: string } }>('/schema/status'),
  })

  const save = useMutation({
    mutationFn: async (asDraft: boolean) => {
      const fieldMap: Record<string, any> = {}
      for (const f of fields) {
        if (!f.name) continue
        fieldMap[f.name] = {
          type: f.type,
          required: f.required,
          optional: !f.required,
          unique: f.unique,
          ...(f.type === 'reference' ? { ref: f.ref || 'user' } : {}),
          ...(f.type === 'vector' ? { vectorSize: 3 } : {}),
          ...(f.defaultValue !== undefined && f.defaultValue !== ''
            ? {
                default:
                  f.defaultValue === 'true'
                    ? true
                    : f.defaultValue === 'false'
                      ? false
                      : Number.isNaN(Number(f.defaultValue))
                        ? f.defaultValue
                        : Number(f.defaultValue),
              }
            : {}),
        }
      }
      const schema = {
        name,
        fields: fieldMap,
        indexes: [],
        access: {
          create: ownerField ? 'owner' : 'authenticated',
          read: readAccess,
          update: ownerField ? 'owner' : 'authenticated',
          delete: ownerField ? 'owner' : 'authenticated',
          ...(ownerField ? { ownerField } : {}),
        },
      }
      return admin(`/schema/collections/${name}${asDraft ? '?draft=true' : ''}`, {
        method: 'PUT',
        body: JSON.stringify(schema),
      })
    },
    onSuccess: (_res, asDraft) => {
      setMessage(asDraft ? 'Draft saved' : 'Collection published + migrated')
      setCreating(false)
      void qc.invalidateQueries({ queryKey: ['admin', 'schema-collections'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'schema'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'collections'] })
    },
  })

  const exportJson = useMutation({
    mutationFn: () => admin<{ data: unknown }>('/schema/export'),
    onSuccess: (res) => {
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: 'application/json',
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'base-schema.json'
      a.click()
    },
  })

  const apply = useMutation({
    mutationFn: () => admin('/schema/apply', { method: 'POST', body: '{}' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'schema'] })
    },
  })

  function loadIntoEditor(c: Stored) {
    setCreating(true)
    setSelected(c.name)
    setName(c.schema.name)
    setFields(
      Object.entries(c.schema.fields).map(([n, f]) => ({
        name: n,
        type: f.type,
        required: Boolean(f.required),
        unique: Boolean(f.unique),
        ref: f.ref,
        defaultValue:
          f.default === undefined || f.default === null
            ? ''
            : String(f.default),
      })),
    )
    setOwnerField(c.schema.access?.ownerField || '')
    setReadAccess(c.schema.access?.read || 'authenticated')
  }

  return (
    <div>
      <h1 className="page-title">Collections</h1>
      <p className="muted" style={{ marginTop: -8, marginBottom: '1rem' }}>
        Visual schema builder — source of truth is the database. Import/export JSON anytime.
      </p>

      <div className="toolbar">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setCreating(true)
            setSelected(null)
            setName('posts')
            setFields([
              { name: 'title', type: 'string', required: true, unique: false },
              {
                name: 'authorId',
                type: 'reference',
                required: true,
                unique: false,
                ref: 'user',
              },
            ])
            setOwnerField('authorId')
            setReadAccess('authenticated')
          }}
        >
          New collection
        </button>
        <button type="button" className="btn" onClick={() => exportJson.mutate()}>
          Export JSON
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (confirm('Apply additive SQL migrations?')) apply.mutate()
          }}
        >
          Apply SQL plan
        </button>
      </div>

      {message && <div className="ok-banner">{message}</div>}
      {(list.error || save.error) && (
        <div className="error-banner">
          {((list.error || save.error) as Error).message}
        </div>
      )}

      {status.data?.data.formatted && (
        <pre
          className="panel"
          style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: '1rem' }}
        >
          {status.data.data.formatted}
        </pre>
      )}

      <div className="table-wrap" style={{ marginBottom: '1rem' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Fields</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data || []).map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.name}</td>
                <td>{c.version}</td>
                <td>{Object.keys(c.schema.fields).length}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => loadIntoEditor(c)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <section className="panel">
          <h2 style={{ fontSize: 14, margin: '0 0 0.75rem' }}>
            {selected ? `Edit ${selected}` : 'Create collection'}
          </h2>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={Boolean(selected)}
            />
          </label>
          <label className="field">
            <span>Read access</span>
            <select
              value={readAccess}
              onChange={(e) => setReadAccess(e.target.value)}
            >
              <option value="authenticated">authenticated</option>
              <option value="owner">owner</option>
              <option value="public">public</option>
            </select>
          </label>
          <label className="field">
            <span>Owner field (optional)</span>
            <input
              value={ownerField}
              onChange={(e) => setOwnerField(e.target.value)}
              placeholder="authorId"
            />
          </label>

          <h3 style={{ fontSize: 13, margin: '1rem 0 0.5rem' }}>Fields</h3>
          {fields.map((f, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <input
                placeholder="name"
                value={f.name}
                onChange={(e) => {
                  const next = [...fields]
                  next[i] = { ...f, name: e.target.value }
                  setFields(next)
                }}
              />
              <select
                value={f.type}
                onChange={(e) => {
                  const next = [...fields]
                  next[i] = { ...f, type: e.target.value }
                  setFields(next)
                }}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => {
                    const next = [...fields]
                    next[i] = { ...f, required: e.target.checked }
                    setFields(next)
                  }}
                />
                required
              </label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={f.unique}
                  onChange={(e) => {
                    const next = [...fields]
                    next[i] = { ...f, unique: e.target.checked }
                    setFields(next)
                  }}
                />
                unique
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => setFields(fields.filter((_, j) => j !== i))}
              >
                ✕
              </button>
              {f.type === 'reference' && (
                <input
                  style={{ gridColumn: '1 / -1' }}
                  placeholder="ref collection (user)"
                  value={f.ref || ''}
                  onChange={(e) => {
                    const next = [...fields]
                    next[i] = { ...f, ref: e.target.value }
                    setFields(next)
                  }}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() =>
              setFields([
                ...fields,
                { name: '', type: 'string', required: false, unique: false },
              ])
            }
          >
            Add field
          </button>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              className="btn primary"
              disabled={!name || save.isPending}
              onClick={() => save.mutate(false)}
            >
              Publish
            </button>
            <button
              type="button"
              className="btn"
              disabled={!name || save.isPending}
              onClick={() => save.mutate(true)}
            >
              Save draft
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
