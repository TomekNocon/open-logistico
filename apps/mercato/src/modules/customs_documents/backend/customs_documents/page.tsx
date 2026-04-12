"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Layers, Package, Plus, Sparkles, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { normalizeDeclarationNumerics } from '../../lib/numbers'

type Declaration = {
  id: string
  status: string
  isNew: boolean
  blNumber: string | null
  invoiceNumber: string | null
  shipperName: string | null
  consigneeName: string | null
  portOfLoading: string | null
  portOfDischarge: string | null
  totalValueUsd: number | null
  currency: string
  grossWeightBl: number | null
  packageCountBl: number | null
  createdAt: string
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  uploaded: 'Uploaded',
  parsed: 'Parsed',
  verified: 'Verified',
  classified: 'Classified',
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280',
  uploaded: '#2563eb',
  parsed: '#d97706',
  verified: '#16a34a',
  classified: '#7c3aed',
}

// ─── Client-side grouping (mirrors lib/batcher.ts, no server imports) ─────────

const YEAR_RE_CLIENT = /^(199\d|200\d|201\d|202[0-9]|2030|2031|2032|2033|2034|2035)$/
const IGNORED_TOKENS_CLIENT = new Set([
  'bl', 'bill', 'lading', 'invoice', 'commercial', 'packing', 'list', 'pl', 'ci',
  'doc', 'document', 'pdf', 'file', 'copy', 'original', 'draft', 'final',
  'transport', 'cargo', 'shipment', 'shipping', 'freight', 'new',
  'of', 'the', 'and', 'for',
])

function extractNumbers(name: string): string[] {
  const base = name.replace(/\.[^.]+$/, '')
  return (base.match(/\d+/g) ?? []).filter(n => !YEAR_RE_CLIENT.test(n))
}

function extractTokensClient(name: string): string[] {
  return name.replace(/\.[^.]+$/, '').toLowerCase().split(/[_\-\s.]+/).filter(t => t.length > 1 && !IGNORED_TOKENS_CLIENT.has(t))
}

function groupFilesClientSide(files: File[]): Array<{ transportKey: string; files: File[] }> {
  if (files.length === 0) return []

  const parent = files.map((_, i) => i)
  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }
  function union(a: number, b: number) { parent[find(a)] = find(b) }

  function applyIndex(idx: Map<string, number[]>) {
    for (const indices of idx.values()) {
      if (indices.length > 1 && indices.length < files.length) {
        for (let i = 1; i < indices.length; i++) union(indices[0], indices[i])
      }
    }
  }

  // Primary: numbers
  const numIdx = new Map<string, number[]>()
  files.forEach((f, i) => {
    for (const n of extractNumbers(f.name)) {
      if (!numIdx.has(n)) numIdx.set(n, [])
      numIdx.get(n)!.push(i)
    }
  })
  const hasNumGroups = [...numIdx.values()].some(v => v.length > 1 && v.length < files.length)
  applyIndex(numIdx)

  // Fallback: tokens
  if (!hasNumGroups) {
    const tokIdx = new Map<string, number[]>()
    files.forEach((f, i) => {
      for (const t of extractTokensClient(f.name)) {
        if (!tokIdx.has(t)) tokIdx.set(t, [])
        tokIdx.get(t)!.push(i)
      }
    })
    applyIndex(tokIdx)
  }

  const groupMap = new Map<number, number[]>()
  for (let i = 0; i < files.length; i++) {
    const root = find(i)
    if (!groupMap.has(root)) groupMap.set(root, [])
    groupMap.get(root)!.push(i)
  }

  return Array.from(groupMap.values()).map((indices, gIdx) => {
    const gFiles = indices.map(i => files[i])
    const numSets = gFiles.map(f => new Set(extractNumbers(f.name)))
    const sharedNums = numSets.length > 0 ? [...numSets[0]].filter(n => numSets.every(s => s.has(n))) : []
    const key = sharedNums.sort((a, b) => b.length - a.length)[0]
      ?? extractTokensClient(gFiles[0]?.name ?? '').sort((a, b) => b.length - a.length)[0]
      ?? `GROUP ${gIdx + 1}`
    return { transportKey: key.toUpperCase(), files: gFiles }
  })
}

// ─── Attachment upload ────────────────────────────────────────────────────────

async function uploadToAttachments(file: File): Promise<string | null> {
  const form = new FormData()
  form.append('file', file)
  form.append('entityId', 'customs_documents:document')
  form.append('recordId', 'pending')
  try {
    const res = await fetch('/api/attachments', { method: 'POST', body: form })
    const json = await res.json() as { item?: { id?: string } }
    return json.item?.id ?? null
  } catch {
    return null
  }
}

// ─── Batch Upload Modal ───────────────────────────────────────────────────────

function BatchUploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [files, setFiles] = React.useState<File[]>([])
  const [dragOver, setDragOver] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const groups = React.useMemo(() => groupFilesClientSide(files), [files])

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const pdfs = Array.from(incoming).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...pdfs.filter(f => !existing.has(f.name))]
    })
  }

  function removeFile(name: string) {
    setFiles(prev => prev.filter(f => f.name !== name))
  }

  async function handleCreate() {
    if (files.length === 0) return
    setUploading(true)
    try {
      const uploaded = await Promise.all(
        files.map(async file => {
          const attachmentId = await uploadToAttachments(file)
          if (!attachmentId) throw new Error(`Failed to upload ${file.name}`)
          return { attachmentId, fileName: file.name }
        }),
      )

      const res = await apiCallOrThrow<{ data: { declarations: Array<{ declarationId: string; transportKey: string }> } }>(
        '/api/customs_documents/declarations/batch',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: uploaded }),
        },
      )

      const count = res.result?.data?.declarations?.length ?? 0
      flash(`Created ${count} declaration${count === 1 ? '' : 's'}`, 'success')
      onSuccess()
    } catch {
      flash('Batch upload failed', 'error')
      setUploading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: '12px', width: '600px', maxWidth: '95vw',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Layers style={{ width: '20px', height: '20px', color: '#2563eb' }} />
            <span style={{ fontWeight: 700, fontSize: '16px' }}>Batch Declaration Upload</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '4px' }}
          >
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#6b7280' }}>
            Drop all PDF files for multiple transports. Files are automatically grouped by the
            transport number found in each filename.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#2563eb' : '#d1d5db'}`,
              borderRadius: '10px',
              padding: '32px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? '#eff6ff' : '#fafafa',
              transition: 'all 0.15s',
              marginBottom: '20px',
            }}
          >
            <Sparkles style={{ width: '28px', height: '28px', color: '#9ca3af', margin: '0 auto 8px' }} />
            <p style={{ margin: 0, fontSize: '14px', color: '#374151', fontWeight: 500 }}>
              Drop PDF files here or click to browse
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>
              Select files from multiple transports — they will be grouped automatically
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={e => addFiles(e.target.files)}
            />
          </div>

          {/* Grouping preview */}
          {groups.length > 0 && (
            <div>
              <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: '#374151' }}>
                Preview — {groups.length} declaration{groups.length === 1 ? '' : 's'} will be created:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {groups.map((group) => (
                  <div key={group.transportKey} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
                        background: '#dbeafe', color: '#1d4ed8',
                      }}>
                        {group.transportKey}
                      </span>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>
                        {group.files.length} file{group.files.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {group.files.map(f => (
                        <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '13px', color: '#374151', fontFamily: 'monospace' }}>{f.name}</span>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); removeFile(f.name) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px' }}
                          >
                            <X style={{ width: '12px', height: '12px' }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button type="button" variant="outline" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={files.length === 0 || uploading}>
            {uploading
              ? 'Creating…'
              : `Create ${groups.length > 0 ? groups.length : ''} Declaration${groups.length === 1 ? '' : 's'}`
            }
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── List page ────────────────────────────────────────────────────────────────

export default function CustomsDeclarationsListPage() {
  const router = useRouter()
  const { organizationId } = useOrganizationScopeDetail()
  const [declarations, setDeclarations] = React.useState<Declaration[]>([])
  const [loading, setLoading] = React.useState(true)
  const [creating, setCreating] = React.useState(false)
  const [showBatchModal, setShowBatchModal] = React.useState(false)

  React.useEffect(() => {
    loadDeclarations()
  }, [])

  async function loadDeclarations() {
    setLoading(true)
    try {
      const res = await apiCallOrThrow<{ data: Declaration[] }>('/api/customs_documents/declarations')
      setDeclarations((res.result?.data ?? []).map((declaration) => normalizeDeclarationNumerics(declaration)))
    } catch {
      flash('Failed to load declarations', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function createDeclaration() {
    setCreating(true)
    try {
      const res = await apiCallOrThrow<{ data: Declaration }>('/api/customs_documents/declarations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })
      if (res.result?.data?.id) {
        router.push(`/backend/customs_documents/${res.result.data.id}`)
      }
    } catch {
      flash('Failed to create declaration', 'error')
      setCreating(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Customs Declarations</h1>
              <p style={{ color: '#6b7280', margin: '4px 0 0 0', fontSize: '14px' }}>
                Process B/L, Commercial Invoice and Packing List documents
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button type="button" variant="outline" onClick={() => setShowBatchModal(true)}>
                <Layers className="size-4" />
                Batch Upload
              </Button>
              <Button type="button" onClick={createDeclaration} disabled={creating}>
                <Plus className="size-4" />
                {creating ? 'Creating…' : 'New Declaration'}
              </Button>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#6b7280' }}>Loading…</div>
          ) : declarations.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '64px 24px',
              border: '2px dashed #e5e7eb',
              borderRadius: '12px',
            }}>
              <Package style={{ width: '40px', height: '40px', color: '#9ca3af', margin: '0 auto 12px' }} />
              <p style={{ color: '#374151', fontWeight: 600, margin: '0 0 4px' }}>No declarations yet</p>
              <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>
                Create a new declaration to start processing customs documents
              </p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  {['Status', 'B/L Number', 'Invoice', 'Shipper', 'Route', 'Value', 'Weight', 'Created', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {declarations.map(d => (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/backend/customs_documents/${d.id}`)}
                    style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 600,
                          background: `${STATUS_COLORS[d.status] ?? '#6b7280'}20`,
                          color: STATUS_COLORS[d.status] ?? '#6b7280',
                        }}>
                          {STATUS_LABELS[d.status] ?? d.status}
                        </span>
                        {d.isNew && (
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 7px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: '#dcfce7',
                            color: '#15803d',
                          }}>
                            New
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{d.blNumber ?? '—'}</td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{d.invoiceNumber ?? '—'}</td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{d.shipperName ?? '—'}</td>
                    <td style={{ padding: '12px', fontSize: '14px', color: '#6b7280' }}>
                      {d.portOfLoading && d.portOfDischarge ? `${d.portOfLoading} → ${d.portOfDischarge}` : '—'}
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>
                      {d.totalValueUsd != null ? `${d.currency} ${d.totalValueUsd.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>
                      {d.grossWeightBl != null ? `${d.grossWeightBl.toLocaleString()} kg` : '—'}
                    </td>
                    <td style={{ padding: '12px', fontSize: '13px', color: '#9ca3af' }}>
                      {new Date(d.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ color: '#2563eb', fontSize: '14px' }}>Open →</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showBatchModal && (
          <BatchUploadModal
            onClose={() => setShowBatchModal(false)}
            onSuccess={() => { setShowBatchModal(false); loadDeclarations() }}
          />
        )}
      </PageBody>
    </Page>
  )
}
