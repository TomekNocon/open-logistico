"use client"

import * as React from 'react'
import { Check, FileText, Loader2, Search, Sparkles } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { normalizeDeclarationNumerics, normalizeLineItemNumerics, sumBy } from '../../../lib/numbers'

// ─── Types ───────────────────────────────────────────────────────────────────

type DocumentType = 'bl' | 'invoice' | 'packing_list'

type UploadedDocument = {
  id: string
  documentType: DocumentType
  attachmentId: string | null
  fileName: string | null
  parsedAt: string | null
}

type LineItem = {
  id: string
  description: string
  quantity: number
  containerNumber: string | null
  vin: string | null
  engineNumber: string | null
  unitPriceUsd: number | null
  totalValueUsd: number | null
  grossWeightKg: number | null
  netWeightKg: number | null
  hsCodeSelected: string | null
  hsProposals: Array<{ code: string; description: string; dutyAmount: string }> | null
}

type Discrepancy = {
  id: string
  fieldName: string
  sourceA: string
  valueA: string
  sourceB: string
  valueB: string
  severity: 'error' | 'warning'
}

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
  grossWeightPl: number | null
  packageCountBl: number | null
  packageCountPl: number | null
}

type HsProposal = {
  code: string
  description: string
  breadcrumb?: string
  reasoning?: string
  dutyAmount: string
  tariffMeasures: Array<{ country: string; description: string; dutyAmount: string }>
  nonTariffMeasures: string[]
  confidence: 'high' | 'medium' | 'low'
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DOC_LABELS: Record<DocumentType, string> = {
  bl: 'Bill of Lading',
  invoice: 'Commercial Invoice',
  packing_list: 'Packing List',
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#16a34a',
  medium: '#d97706',
  low: '#9ca3af',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function buildDeclarationExportUrl(declarationId: string, format: 'json' | 'csv'): string {
  return `/api/customs_documents/declarations/${encodeURIComponent(declarationId)}/export?target=winsad&format=${format}`
}

// ─── Section components ───────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px', paddingBottom: '8px', borderBottom: '2px solid #e5e7eb' }}>
      {children}
    </h2>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '20px', ...style }}>
      {children}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    draft: ['#f3f4f6', '#374151'],
    uploaded: ['#dbeafe', '#1d4ed8'],
    parsed: ['#fef3c7', '#b45309'],
    verified: ['#dcfce7', '#15803d'],
    classified: ['#f3e8ff', '#6d28d9'],
  }
  const [bg, fg] = colors[status] ?? ['#f3f4f6', '#374151']
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: bg, color: fg }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomsDeclarationDetailPage({ params }: { params?: { id?: string } }) {
  const declarationId = params?.id

  const [declaration, setDeclaration] = React.useState<Declaration | null>(null)
  const [documents, setDocuments] = React.useState<UploadedDocument[]>([])
  const [lineItems, setLineItems] = React.useState<LineItem[]>([])
  const [discrepancies, setDiscrepancies] = React.useState<Discrepancy[]>([])
  const [loading, setLoading] = React.useState(true)
  const [parsing, setParsing] = React.useState(false)
  const [uploadingType, setUploadingType] = React.useState<DocumentType | null>(null)
  const [smartUploading, setSmartUploading] = React.useState(false)
  const [searchingHs, setSearchingHs] = React.useState<string | null>(null)
  const [hsResults, setHsResults] = React.useState<Record<string, HsProposal[]>>({})

  React.useEffect(() => {
    if (declarationId) loadDeclaration()
  }, [declarationId])

  async function loadDeclaration() {
    setLoading(true)
    try {
      const res = await apiCallOrThrow<{ data: { declaration: Declaration; documents: UploadedDocument[]; lineItems: LineItem[]; discrepancies: Discrepancy[] } }>(
        `/api/customs_documents/declarations/${declarationId}`,
      )
      if (res.result?.data) {
        setDeclaration(normalizeDeclarationNumerics(res.result.data.declaration))
        setDocuments(res.result.data.documents)
        setLineItems(res.result.data.lineItems.map((lineItem) => normalizeLineItemNumerics(lineItem)))
        setDiscrepancies(res.result.data.discrepancies)
      }
    } catch {
      flash('Failed to load declaration', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSmartUpload(files: FileList) {
    if (files.length === 0) return
    setSmartUploading(true)
    try {
      const uploaded = await Promise.all(
        Array.from(files).map(async file => {
          const attachmentId = await uploadToAttachments(file)
          if (!attachmentId) throw new Error(`Failed to upload ${file.name}`)
          return { attachmentId, fileName: file.name }
        }),
      )

      const res = await apiCallOrThrow<{ data: { detected: Array<{ fileName: string | null; documentType: string; confidence: string }> } }>(
        `/api/customs_documents/declarations/${declarationId}/detect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: uploaded }),
        },
      )

      const detected = res.result?.data?.detected ?? []
      const summary = detected
        .filter(d => d.documentType)
        .map(d => `${d.fileName ?? 'file'} → ${DOC_LABELS[d.documentType as DocumentType] ?? d.documentType}`)
        .join(', ')
      flash(summary ? `Detected: ${summary}` : 'Documents uploaded', 'success')
      await loadDeclaration()
    } catch {
      flash('Smart upload failed', 'error')
    } finally {
      setSmartUploading(false)
    }
  }

  async function handleFileUpload(docType: DocumentType, file: File) {
    setUploadingType(docType)
    try {
      const attachmentId = await uploadToAttachments(file)
      if (!attachmentId) throw new Error('Upload failed')

      await apiCallOrThrow(`/api/customs_documents/declarations/${declarationId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType: docType, attachmentId, fileName: file.name }),
      })

      flash(`${DOC_LABELS[docType]} uploaded`, 'success')
      await loadDeclaration()
    } catch {
      flash(`Failed to upload ${DOC_LABELS[docType]}`, 'error')
    } finally {
      setUploadingType(null)
    }
  }

  async function handleParse() {
    setParsing(true)
    try {
      await apiCallOrThrow(`/api/customs_documents/declarations/${declarationId}/parse`, {
        method: 'POST',
      })
      flash('Documents parsed successfully', 'success')
      await loadDeclaration()
    } catch {
      flash('Parsing failed', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleHsSearch(lineItemId: string, description: string) {
    setSearchingHs(lineItemId)
    try {
      const res = await apiCallOrThrow<{ data: { proposals: HsProposal[] } }>('/api/customs_documents/hs-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      setHsResults(prev => ({ ...prev, [lineItemId]: res.result?.data?.proposals ?? [] }))
    } catch {
      flash('HS code search failed', 'error')
    } finally {
      setSearchingHs(null)
    }
  }

  async function handleSelectHsCode(lineItemId: string, proposal: HsProposal) {
    const proposals = (hsResults[lineItemId] ?? []).map(p => ({
      code: p.code,
      description: p.description,
      dutyAmount: p.dutyAmount,
    }))
    try {
      await apiCallOrThrow(`/api/customs_documents/line-items/${lineItemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hsCodeSelected: proposal.code, hsProposals: proposals }),
      })
      setLineItems(prev => prev.map(li =>
        li.id === lineItemId ? { ...li, hsCodeSelected: proposal.code, hsProposals: proposals } : li,
      ))
      flash(`HS code ${proposal.code} saved`, 'success')
    } catch {
      flash('Failed to save HS code', 'error')
    }
  }

  function getDutyRate(item: LineItem): string | null {
    const code = item.hsCodeSelected
    if (!code) return null
    const fromSearch = (hsResults[item.id] ?? []).find(p => p.code === code)?.dutyAmount
    if (fromSearch && fromSearch !== '—') return fromSearch
    const fromPersisted = (item.hsProposals ?? []).find(p => p.code === code)?.dutyAmount
    return (fromPersisted && fromPersisted !== '—') ? fromPersisted : null
  }

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>Loading…</div>
        </PageBody>
      </Page>
    )
  }

  if (!declaration) {
    return (
      <Page>
        <PageBody>
          <div style={{ padding: '48px', textAlign: 'center', color: '#ef4444' }}>Declaration not found.</div>
        </PageBody>
      </Page>
    )
  }

  const isParsed = ['parsed', 'verified', 'classified'].includes(declaration.status)
  const hasDocuments = documents.length > 0
  const errorCount = discrepancies.filter(d => d.severity === 'error').length
  const warnCount = discrepancies.filter(d => d.severity === 'warning').length
  const totalLineQuantity = sumBy(lineItems, (lineItem) => lineItem.quantity)
  const totalLineValueUsd = sumBy(lineItems, (lineItem) => lineItem.totalValueUsd)
  const totalLineGrossWeightKg = sumBy(lineItems, (lineItem) => lineItem.grossWeightKg)

  return (
    <Page>
      <PageBody>
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '32px' }}>
            <a href="/backend/customs_documents" style={{ color: '#6b7280', textDecoration: 'none', fontSize: '14px', marginTop: '4px' }}>← Back</a>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>
                  {declaration.blNumber ? `B/L ${declaration.blNumber}` : 'New Declaration'}
                </h1>
                <StatusBadge status={declaration.status} />
              </div>
              {declaration.invoiceNumber && (
                <p style={{ color: '#6b7280', margin: '4px 0 0', fontSize: '14px' }}>
                  Invoice: {declaration.invoiceNumber}
                  {declaration.portOfLoading && ` · ${declaration.portOfLoading} → ${declaration.portOfDischarge}`}
                  {declaration.totalValueUsd != null && ` · ${declaration.currency} ${declaration.totalValueUsd.toLocaleString()}`}
                </p>
              )}
            </div>
            {isParsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '200px' }}>
                <a
                  href={buildDeclarationExportUrl(declaration.id, 'json')}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '8px',
                    border: '1px solid #2563eb',
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    padding: '8px 12px',
                  }}
                >
                  Export WinSAD JSON
                </a>
                <a
                  href={buildDeclarationExportUrl(declaration.id, 'csv')}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '8px',
                    border: '1px solid #93c5fd',
                    background: '#f8fbff',
                    color: '#1d4ed8',
                    fontSize: '13px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    padding: '8px 12px',
                  }}
                >
                  Export WinSAD CSV
                </a>
              </div>
            )}
          </div>

          {/* ─── SECTION 1: Upload ─── */}
          <div style={{ marginBottom: '40px' }}>
            <SectionTitle>1. Upload Documents</SectionTitle>

            {/* Smart multi-file upload */}
            <label style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '28px 16px',
              marginBottom: '20px',
              border: '2px dashed #93c5fd',
              borderRadius: '10px',
              background: smartUploading ? '#f0f9ff' : '#f8faff',
              cursor: smartUploading ? 'not-allowed' : 'pointer',
            }}>
              <Sparkles style={{ width: '32px', height: '32px', color: '#2563eb' }} />
              <span style={{ fontWeight: 600, fontSize: '14px', color: '#1d4ed8' }}>
                {smartUploading ? 'Detecting document types…' : 'Smart Upload — drop up to 3 PDFs at once'}
              </span>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>
                AI will automatically detect which file is the B/L, Invoice and Packing List
              </span>
              <input
                type="file"
                accept=".pdf"
                multiple
                style={{ display: 'none' }}
                disabled={smartUploading}
                onChange={e => e.target.files && handleSmartUpload(e.target.files)}
              />
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
              <span style={{ fontSize: '12px', color: '#9ca3af', flexShrink: 0 }}>or upload individually</span>
              <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              {(['bl', 'invoice', 'packing_list'] as DocumentType[]).map(docType => {
                const uploaded = documents.find(d => d.documentType === docType)
                const isUploading = uploadingType === docType
                return (
                  <Card key={docType}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '12px' }}>
                      {DOC_LABELS[docType]}
                    </div>
                    {uploaded ? (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <Check style={{ width: '16px', height: '16px', color: '#16a34a', flexShrink: 0 }} />
                          <span style={{ fontSize: '13px', color: '#374151', wordBreak: 'break-all' }}>
                            {uploaded.fileName ?? 'File uploaded'}
                          </span>
                        </div>
                        {uploaded.parsedAt && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#16a34a', fontWeight: 500 }}>
                            <Check style={{ width: '12px', height: '12px' }} /> Parsed
                          </div>
                        )}
                        <label style={{ display: 'block', marginTop: '8px', cursor: 'pointer' }}>
                          <span style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'underline' }}>Replace file</span>
                          <input
                            type="file"
                            accept=".pdf"
                            style={{ display: 'none' }}
                            onChange={e => e.target.files?.[0] && handleFileUpload(docType, e.target.files[0])}
                          />
                        </label>
                      </div>
                    ) : (
                      <label style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '24px 12px',
                        border: '2px dashed #d1d5db',
                        borderRadius: '8px',
                        cursor: isUploading ? 'not-allowed' : 'pointer',
                        background: isUploading ? '#f9fafb' : '#fafafa',
                      }}>
                        <FileText style={{ width: '28px', height: '28px', color: '#9ca3af', marginBottom: '8px' }} />
                        <span style={{ fontSize: '13px', color: '#6b7280' }}>
                          {isUploading ? 'Uploading…' : 'Click to upload PDF'}
                        </span>
                        <input
                          type="file"
                          accept=".pdf"
                          style={{ display: 'none' }}
                          disabled={isUploading}
                          onChange={e => e.target.files?.[0] && handleFileUpload(docType, e.target.files[0])}
                        />
                      </label>
                    )}
                  </Card>
                )
              })}
            </div>

            {hasDocuments && (
              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                <Button onClick={handleParse} disabled={parsing}>
                  {parsing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Parsing with Claude AI…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      Parse All Documents
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {isParsed && (
            <>
              {/* ─── SECTION 2: Goods Summary ─── */}
              <div style={{ marginBottom: '40px' }}>
                <SectionTitle>2. Goods Summary</SectionTitle>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '20px' }}>
                  {[
                    ['Shipper / Exporter', declaration.shipperName],
                    ['Consignee / Importer', declaration.consigneeName],
                    ['Port of Loading', declaration.portOfLoading],
                    ['Port of Discharge', declaration.portOfDischarge],
                    ['B/L Number', declaration.blNumber],
                    ['Invoice Number', declaration.invoiceNumber],
                    ['Total Value', declaration.totalValueUsd != null ? `${declaration.currency} ${declaration.totalValueUsd.toLocaleString()}` : null],
                    ['Total Gross Weight', declaration.grossWeightBl != null ? `${declaration.grossWeightBl.toLocaleString()} kg` : null],
                  ].map(([label, value]) => (
                    <div key={label as string} style={{ display: 'flex', gap: '8px', padding: '8px 12px', background: '#f9fafb', borderRadius: '6px' }}>
                      <span style={{ fontSize: '13px', color: '#6b7280', minWidth: '160px' }}>{label}</span>
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>{value ?? '—'}</span>
                    </div>
                  ))}
                </div>

                {lineItems.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: '#f9fafb' }}>
                          {['#', 'Description', 'Container', 'VIN', 'Qty', 'Unit Price', 'Total Value', 'Gross Weight', 'HS Code'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems.map((item, idx) => (
                          <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '10px', color: '#9ca3af' }}>{idx + 1}</td>
                            <td style={{ padding: '10px', maxWidth: '200px' }}>{item.description}</td>
                            <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: '12px' }}>{item.containerNumber ?? '—'}</td>
                            <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: '12px' }}>{item.vin ?? '—'}</td>
                            <td style={{ padding: '10px', textAlign: 'center' }}>{item.quantity}</td>
                            <td style={{ padding: '10px', textAlign: 'right' }}>{item.unitPriceUsd != null ? `$${item.unitPriceUsd.toLocaleString()}` : '—'}</td>
                            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>{item.totalValueUsd != null ? `$${item.totalValueUsd.toLocaleString()}` : '—'}</td>
                            <td style={{ padding: '10px', textAlign: 'right' }}>{item.grossWeightKg != null ? `${item.grossWeightKg.toLocaleString()} kg` : '—'}</td>
                            <td style={{ padding: '10px' }}>
                              {item.hsCodeSelected ? (
                                <div>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#16a34a', fontWeight: 600, fontFamily: 'monospace' }}>
                                    <Check style={{ width: '13px', height: '13px' }} />{item.hsCodeSelected}
                                  </span>
                                  {getDutyRate(item) && (
                                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{getDutyRate(item)}</div>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: '#9ca3af', fontSize: '12px' }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        <tr style={{ background: '#f0f9ff', fontWeight: 700 }}>
                          <td colSpan={4} style={{ padding: '10px', textAlign: 'right', color: '#374151' }}>TOTAL</td>
                          <td style={{ padding: '10px', textAlign: 'center' }}>
                            {totalLineQuantity}
                          </td>
                          <td style={{ padding: '10px' }}></td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>
                            ${totalLineValueUsd.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>
                            {totalLineGrossWeightKg.toLocaleString()} kg
                          </td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ─── SECTION 3: Consistency Check ─── */}
              <div style={{ marginBottom: '40px' }}>
                <SectionTitle>
                  3. Consistency Check
                  {errorCount > 0 && (
                    <span style={{ marginLeft: '12px', fontSize: '14px', color: '#ef4444', fontWeight: 400 }}>
                      {errorCount} error{errorCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {warnCount > 0 && (
                    <span style={{ marginLeft: '8px', fontSize: '14px', color: '#d97706', fontWeight: 400 }}>
                      {warnCount} warning{warnCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {errorCount === 0 && warnCount === 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '12px', fontSize: '14px', color: '#16a34a', fontWeight: 400 }}>
                      <Check style={{ width: '14px', height: '14px' }} /> All consistent
                    </span>
                  )}
                </SectionTitle>

                <ConsistencyTable
                  declaration={declaration}
                  lineItems={lineItems}
                  discrepancies={discrepancies}
                  documents={documents}
                />
              </div>

              {/* ─── SECTION 4: HS Classification ─── */}
              <div style={{ marginBottom: '40px' }}>
                <SectionTitle>4. HS Code Classification (ISZTAR4)</SectionTitle>
                <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 20px' }}>
                  For each product, click Search to get HS code proposals from ISZTAR4. Select the correct code.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {lineItems.map((item, idx) => (
                    <Card key={item.id}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <span style={{ fontWeight: 700, color: '#2563eb' }}>#{idx + 1}</span>
                            <span style={{ fontWeight: 600 }}>{item.description}</span>
                            <span style={{ fontSize: '12px', color: '#6b7280' }}>Qty: {item.quantity}</span>
                            {item.vin && <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#374151' }}>VIN: {item.vin}</span>}
                          </div>
                          {item.hsCodeSelected && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#dcfce7', borderRadius: '6px', padding: '6px 12px', marginBottom: '8px' }}>
                              <Check style={{ width: '14px', height: '14px', color: '#16a34a', flexShrink: 0 }} />
                              <span style={{ color: '#16a34a', fontWeight: 600 }}>Selected:</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#15803d' }}>{item.hsCodeSelected}</span>
                              {getDutyRate(item) && (
                                <span style={{ borderLeft: '1px solid #86efac', paddingLeft: '8px', color: '#15803d', fontWeight: 600 }}>
                                  {getDutyRate(item)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleHsSearch(item.id, item.description)}
                          disabled={searchingHs === item.id}
                          style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                        >
                          {searchingHs === item.id ? (
                            <><Loader2 className="size-4 animate-spin" /> Searching…</>
                          ) : (
                            <><Search className="size-4" /> Search ISZTAR4</>
                          )}
                        </Button>
                      </div>

                      {/* HS Results */}
                      {hsResults[item.id] && (
                        <div style={{ marginTop: '12px' }}>
                          {hsResults[item.id].length === 0 ? (
                            <p style={{ color: '#9ca3af', fontSize: '13px' }}>No results found.</p>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                              <thead>
                                <tr style={{ background: '#f9fafb' }}>
                                  {['Confidence', 'HS Code', 'Description', 'Duty Rate', 'Action'].map(h => (
                                    <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {hsResults[item.id].map(proposal => (
                                  <tr
                                    key={proposal.code}
                                    style={{
                                      borderBottom: '1px solid #f3f4f6',
                                      background: item.hsCodeSelected === proposal.code ? '#f0fdf4' : undefined,
                                    }}
                                  >
                                    <td style={{ padding: '8px 10px' }}>
                                      <span style={{ fontSize: '11px', fontWeight: 600, color: CONFIDENCE_COLORS[proposal.confidence] }}>
                                        {proposal.confidence.toUpperCase()}
                                      </span>
                                    </td>
                                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700 }}>
                                      {proposal.code}
                                    </td>
                                    <td style={{ padding: '8px 10px', color: '#374151', maxWidth: '460px' }}>
                                      <div style={{ fontWeight: 600 }}>{proposal.description}</div>
                                      {proposal.breadcrumb && (
                                        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                                          {proposal.breadcrumb}
                                        </div>
                                      )}
                                      {proposal.reasoning && (
                                        <div style={{ fontSize: '11px', color: '#2563eb', marginTop: '4px', fontStyle: 'italic' }}>
                                          {proposal.reasoning}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#374151' }}>
                                      {proposal.dutyAmount}
                                    </td>
                                    <td style={{ padding: '8px 10px' }}>
                                      {item.hsCodeSelected === proposal.code ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#16a34a', fontWeight: 600 }}>
                                          <Check style={{ width: '14px', height: '14px' }} /> Selected
                                        </span>
                                      ) : (
                                        <Button
                                          type="button"
                                          size="sm"
                                          onClick={() => handleSelectHsCode(item.id, proposal)}
                                        >
                                          Select
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </PageBody>
    </Page>
  )
}

// ─── Consistency Table Component ──────────────────────────────────────────────

function ConsistencyTable({
  declaration,
  lineItems,
  discrepancies,
  documents,
}: {
  declaration: Declaration
  lineItems: LineItem[]
  discrepancies: Discrepancy[]
  documents: UploadedDocument[]
}) {
  const discMap = new Map(discrepancies.map(d => [d.fieldName, d]))

  const totalQtyInvoice = sumBy(lineItems, (lineItem) => lineItem.quantity)
  const totalValueInvoice = sumBy(lineItems, (lineItem) => lineItem.totalValueUsd)
  const hasDoc = (type: DocumentType) => documents.some(d => d.documentType === type)

  type Row = {
    field: string
    label: string
    bl: string | null
    invoice: string | null
    pl: string | null
  }

  const rows: Row[] = [
    {
      field: 'gross_weight_total',
      label: 'Gross Weight (total)',
      bl: declaration.grossWeightBl != null ? `${declaration.grossWeightBl.toLocaleString()} kg` : null,
      invoice: null,
      pl: declaration.grossWeightPl != null ? `${declaration.grossWeightPl.toLocaleString()} kg` : null,
    },
    {
      field: 'package_count',
      label: 'Package / Unit Count',
      bl: declaration.packageCountBl != null ? String(declaration.packageCountBl) : null,
      invoice: lineItems.length > 0 ? String(totalQtyInvoice) : null,
      pl: declaration.packageCountPl != null ? String(declaration.packageCountPl) : null,
    },
    {
      field: 'shipper_name',
      label: 'Shipper / Seller',
      bl: declaration.shipperName,
      invoice: declaration.shipperName,
      pl: null,
    },
    {
      field: 'buyer_name',
      label: 'Consignee / Buyer',
      bl: declaration.consigneeName,
      invoice: declaration.consigneeName,
      pl: null,
    },
    {
      field: 'line_item_count',
      label: 'Line Item Count',
      bl: null,
      invoice: lineItems.length ? String(lineItems.length) : null,
      pl: null,
    },
    {
      field: 'total_value',
      label: 'Invoice Total Value',
      bl: null,
      invoice: lineItems.length > 0 ? `${declaration.currency} ${totalValueInvoice.toLocaleString()}` : null,
      pl: null,
    },
  ]

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            {['Field', 'B/L', 'Commercial Invoice', 'Packing List', 'Status'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const disc = discMap.get(row.field)
            const isOk = !disc
            const rowBg = disc ? (disc.severity === 'error' ? '#fff5f5' : '#fffbeb') : '#ffffff'

            return (
              <tr key={row.field} style={{ borderBottom: '1px solid #f3f4f6', background: rowBg }}>
                <td style={{ padding: '10px 12px', fontWeight: 500, color: '#374151' }}>{row.label}</td>
                <td style={{ padding: '10px 12px', color: !hasDoc('bl') ? '#d1d5db' : '#374151' }}>
                  {hasDoc('bl') ? (row.bl ?? '—') : <span style={{ fontSize: '12px', color: '#d1d5db' }}>not uploaded</span>}
                </td>
                <td style={{ padding: '10px 12px', color: !hasDoc('invoice') ? '#d1d5db' : '#374151' }}>
                  {hasDoc('invoice') ? (row.invoice ?? '—') : <span style={{ fontSize: '12px', color: '#d1d5db' }}>not uploaded</span>}
                </td>
                <td style={{ padding: '10px 12px', color: !hasDoc('packing_list') ? '#d1d5db' : '#374151' }}>
                  {hasDoc('packing_list') ? (row.pl ?? '—') : <span style={{ fontSize: '12px', color: '#d1d5db' }}>not uploaded</span>}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {isOk ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#16a34a', fontWeight: 600, fontSize: '13px' }}>
                      <Check style={{ width: '13px', height: '13px' }} /> OK
                    </span>
                  ) : disc.severity === 'error' ? (
                    <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '13px' }}>
                      ✗ Mismatch: {disc.valueA} ≠ {disc.valueB}
                    </span>
                  ) : (
                    <span style={{ color: '#d97706', fontWeight: 600, fontSize: '13px' }}>
                      ⚠ Check: {disc.valueA} / {disc.valueB}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
