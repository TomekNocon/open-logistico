import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { promises as fs } from 'fs'
import path from 'path'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  CustomsDeclaration,
  CustomsUploadedDocument,
  CustomsLineItem,
  CustomsDiscrepancy,
} from '../../../../data/entities'
import { parseBillOfLading, parseCommercialInvoice, parsePackingList } from '../../../../lib/parser'
import { checkConsistency } from '../../../../lib/consistency'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customs_documents.manage'] },
}

function resolvePartitionRoot(code: string): string {
  const envKey = `OM_ATTACHMENT_PARTITION_${code.toUpperCase().replace(/-/g, '_')}_PATH`
  const envPath = process.env[envKey]
  if (envPath?.trim()) return path.resolve(envPath)
  return path.join(process.cwd(), 'storage', 'attachments', code)
}

async function readAttachmentBytes(em: EntityManager, attachmentId: string): Promise<Buffer | null> {
  const attachment = await em.findOne(Attachment, { id: attachmentId })
  if (!attachment) return null
  const absolutePath = path.join(resolvePartitionRoot(attachment.partitionCode), attachment.storagePath)
  try {
    return await fs.readFile(absolutePath)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const declaration = await em.findOne(CustomsDeclaration, {
    id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 })

  const uploadedDocs = await em.find(CustomsUploadedDocument, { declarationId: id })
  if (uploadedDocs.length === 0) {
    return NextResponse.json({ error: 'No documents uploaded yet' }, { status: 422 })
  }

  const blDoc = uploadedDocs.find(d => d.documentType === 'bl')
  const invoiceDoc = uploadedDocs.find(d => d.documentType === 'invoice')
  const packingDoc = uploadedDocs.find(d => d.documentType === 'packing_list')

  let blData = null
  let invoiceData = null
  let packingData = null

  // Parse each document
  if (blDoc?.attachmentId) {
    const bytes = await readAttachmentBytes(em, blDoc.attachmentId)
    if (bytes) {
      blData = await parseBillOfLading(bytes)
      blDoc.parsedData = blData as unknown as Record<string, unknown>
      blDoc.parsedAt = new Date()
    }
  }

  if (invoiceDoc?.attachmentId) {
    const bytes = await readAttachmentBytes(em, invoiceDoc.attachmentId)
    if (bytes) {
      invoiceData = await parseCommercialInvoice(bytes)
      invoiceDoc.parsedData = invoiceData as unknown as Record<string, unknown>
      invoiceDoc.parsedAt = new Date()
    }
  }

  if (packingDoc?.attachmentId) {
    const bytes = await readAttachmentBytes(em, packingDoc.attachmentId)
    if (bytes) {
      packingData = await parsePackingList(bytes)
      packingDoc.parsedData = packingData as unknown as Record<string, unknown>
      packingDoc.parsedAt = new Date()
    }
  }

  // Update declaration with parsed fields
  if (blData) {
    declaration.blNumber = blData.blNumber
    declaration.shipperName = blData.shipper
    declaration.consigneeName = blData.consignee
    declaration.portOfLoading = blData.portOfLoading
    declaration.portOfDischarge = blData.portOfDischarge
    declaration.grossWeightBl = blData.grossWeightKg
    declaration.packageCountBl = blData.packageCount
  }

  if (invoiceData) {
    declaration.invoiceNumber = invoiceData.invoiceNumber
    declaration.totalValueUsd = invoiceData.totalValueUsd
    declaration.currency = invoiceData.currency || 'USD'
    if (!blData && invoiceData.seller) declaration.shipperName = invoiceData.seller
    if (!blData && invoiceData.buyer) declaration.consigneeName = invoiceData.buyer
  }

  if (packingData) {
    declaration.grossWeightPl = packingData.totalGrossWeightKg
    declaration.packageCountPl = packingData.totalQuantity
  }

  // Remove old line items for this declaration
  await em.nativeDelete(CustomsLineItem, { declarationId: id })

  // Create new line items from invoice
  const newLineItems: CustomsLineItem[] = []
  if (invoiceData?.lineItems) {
    for (const item of invoiceData.lineItems) {
      // Find matching packing list item for weights
      const packingItem = packingData?.lineItems.find(p =>
        (item.vin && p.vin && item.vin === p.vin) ||
        (item.containerNumber && p.containerNumber && item.containerNumber === p.containerNumber),
      )

      const lineItem = em.create(CustomsLineItem, {
        declarationId: id,
        description: item.description,
        quantity: item.quantity,
        unitPriceUsd: item.unitPriceUsd,
        totalValueUsd: item.totalValueUsd,
        containerNumber: item.containerNumber,
        vin: item.vin,
        engineNumber: item.engineNumber,
        grossWeightKg: packingItem?.grossWeightKg ?? null,
        netWeightKg: packingItem?.netWeightKg ?? null,
      })
      em.persist(lineItem)
      newLineItems.push(lineItem)
    }
  }

  // Run consistency check
  await em.nativeDelete(CustomsDiscrepancy, { declarationId: id })
  const discrepancyData = checkConsistency(blData, invoiceData, packingData)
  const newDiscrepancies: CustomsDiscrepancy[] = []
  for (const d of discrepancyData) {
    const disc = em.create(CustomsDiscrepancy, {
      declarationId: id,
      fieldName: d.fieldName,
      sourceA: d.sourceA,
      valueA: d.valueA,
      sourceB: d.sourceB,
      valueB: d.valueB,
      severity: d.severity,
    })
    em.persist(disc)
    newDiscrepancies.push(disc)
  }

  const hasErrors = discrepancyData.some(d => d.severity === 'error')
  declaration.status = hasErrors ? 'parsed' : 'verified'

  await em.flush()

  return NextResponse.json({
    ok: true,
    data: {
      declaration,
      lineItems: newLineItems,
      discrepancies: newDiscrepancies,
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Parse declaration documents',
  methods: {
    POST: { summary: 'Parse all uploaded PDFs and run consistency check', responses: [{ status: 200, description: 'Parse results' }] },
  },
}
