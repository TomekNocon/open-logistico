import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { promises as fs } from 'fs'
import path from 'path'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { CustomsDeclaration, CustomsUploadedDocument } from '../../../data/entities'
import { batchDeclarationSchema } from '../../../data/validators'
import { detectDocumentType } from '../../../lib/detector'
import { groupFilesByTransport } from '../../../lib/batcher'
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

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 })

  const body = await req.json()
  const { files } = batchDeclarationSchema.parse(body)

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const groups = groupFilesByTransport(files)
  const results = []

  for (const group of groups) {
    const declaration = em.create(CustomsDeclaration, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      status: 'draft',
      currency: 'USD',
      isNew: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(declaration)
    await em.flush()

    const bytesResults = await Promise.all(
      group.files.map(async file => ({
        ...file,
        bytes: await readAttachmentBytes(em, file.attachmentId),
      })),
    )

    const detectionResults = await Promise.all(
      bytesResults.map(async file => {
        if (!file.bytes) return { ...file, documentType: null as string | null, confidence: null as string | null }
        try {
          const detection = await detectDocumentType(file.bytes, file.fileName ?? undefined)
          return { ...file, ...detection }
        } catch {
          return { ...file, documentType: null as string | null, confidence: null as string | null }
        }
      }),
    )

    for (const result of detectionResults) {
      if (!result.documentType) continue
      const doc = em.create(CustomsUploadedDocument, {
        declarationId: declaration.id,
        documentType: result.documentType as 'bl' | 'invoice' | 'packing_list',
        attachmentId: result.attachmentId,
        fileName: result.fileName ?? null,
        createdAt: new Date(),
      })
      em.persist(doc)
    }

    declaration.status = 'uploaded'
    await em.flush()

    results.push({
      declarationId: declaration.id,
      transportKey: group.transportKey,
      files: detectionResults.map(r => ({
        fileName: r.fileName ?? null,
        documentType: r.documentType,
        confidence: r.confidence,
      })),
    })
  }

  return NextResponse.json({ ok: true, data: { declarations: results } }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Batch create declarations from multiple files',
  methods: {
    POST: {
      summary: 'Group uploaded files by transport number and create one declaration per transport',
      responses: [{ status: 201, description: 'Created declarations with grouped files' }],
    },
  },
}
