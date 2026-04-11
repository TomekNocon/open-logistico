import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { promises as fs } from 'fs'
import path from 'path'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { CustomsDeclaration, CustomsUploadedDocument } from '../../../../data/entities'
import { detectDocumentsSchema } from '../../../../data/validators'
import { detectDocumentType } from '../../../../lib/detector'
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
  const body = await req.json()
  const { files } = detectDocumentsSchema.parse(body)

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const declaration = await em.findOne(CustomsDeclaration, {
    id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 })

  // Read all PDF bytes in parallel
  const bytesResults = await Promise.all(
    files.map(async file => ({
      ...file,
      bytes: await readAttachmentBytes(em, file.attachmentId),
    })),
  )

  // Detect document types in parallel
  const detectionResults = await Promise.all(
    bytesResults.map(async file => {
      if (!file.bytes) return { ...file, documentType: null, confidence: null }
      const detection = await detectDocumentType(file.bytes)
      return { ...file, ...detection }
    }),
  )

  // Upsert CustomsUploadedDocument for each detected file
  for (const result of detectionResults) {
    if (!result.documentType) continue

    const existing = await em.findOne(CustomsUploadedDocument, {
      declarationId: id,
      documentType: result.documentType,
    })
    if (existing) {
      em.remove(existing)
    }

    const doc = em.create(CustomsUploadedDocument, {
      declarationId: id,
      documentType: result.documentType,
      attachmentId: result.attachmentId,
      fileName: result.fileName ?? null,
    })
    em.persist(doc)
  }

  if (declaration.status === 'draft') {
    declaration.status = 'uploaded'
  }

  await em.flush()

  return NextResponse.json({
    ok: true,
    data: {
      detected: detectionResults.map(r => ({
        attachmentId: r.attachmentId,
        fileName: r.fileName ?? null,
        documentType: r.documentType,
        confidence: r.confidence,
      })),
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Auto-detect and attach documents',
  methods: {
    POST: {
      summary: 'Detect document types from uploaded PDFs and attach them to the declaration',
      responses: [{ status: 200, description: 'Detection results' }],
    },
  },
}
