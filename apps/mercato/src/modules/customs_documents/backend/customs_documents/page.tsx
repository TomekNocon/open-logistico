"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type Declaration = {
  id: string
  status: string
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

export default function CustomsDeclarationsListPage() {
  const router = useRouter()
  const { organizationId } = useOrganizationScopeDetail()
  const [declarations, setDeclarations] = React.useState<Declaration[]>([])
  const [loading, setLoading] = React.useState(true)
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    loadDeclarations()
  }, [])

  async function loadDeclarations() {
    setLoading(true)
    try {
      const res = await apiCallOrThrow<{ data: Declaration[] }>('/api/customs_documents/declarations')
      setDeclarations(res.result?.data ?? [])
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
            <button
              onClick={createDeclaration}
              disabled={creating}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: creating ? 'not-allowed' : 'pointer',
                opacity: creating ? 0.7 : 1,
              }}
            >
              {creating ? 'Creating…' : '+ New Declaration'}
            </button>
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
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
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
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{d.blNumber ?? '—'}</td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{d.invoiceNumber ?? '—'}</td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{d.shipperName ?? '—'}</td>
                    <td style={{ padding: '12px', fontSize: '14px', color: '#6b7280' }}>
                      {d.portOfLoading && d.portOfDischarge ? `${d.portOfLoading} → ${d.portOfDischarge}` : '—'}
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>
                      {d.totalValueUsd ? `${d.currency} ${d.totalValueUsd.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>
                      {d.grossWeightBl ? `${d.grossWeightBl.toLocaleString()} kg` : '—'}
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
      </PageBody>
    </Page>
  )
}
