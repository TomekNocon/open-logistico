import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomsDeclaration, CustomsUploadedDocument } from '../../../../data/entities'
import { attachDocumentSchema } from '../../../../data/validators'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customs_documents.manage'] },
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json()
  const payload = attachDocumentSchema.parse(body)

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const declaration = await em.findOne(CustomsDeclaration, {
    id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 })

  // Remove existing document of this type for this declaration (one per type)
  const existing = await em.findOne(CustomsUploadedDocument, {
    declarationId: id,
    documentType: payload.documentType,
  })
  if (existing) {
    em.remove(existing)
  }

  const doc = em.create(CustomsUploadedDocument, {
    declarationId: id,
    documentType: payload.documentType,
    attachmentId: payload.attachmentId,
    fileName: payload.fileName ?? null,
    createdAt: new Date(),
  })
  em.persist(doc)

  // Update declaration status if it's still 'draft'
  if (declaration.status === 'draft') {
    declaration.status = 'uploaded'
  }

  await em.flush()

  return NextResponse.json({ ok: true, data: doc }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Attach document to declaration',
  methods: {
    POST: { summary: 'Attach a B/L, Invoice or Packing List PDF', responses: [{ status: 201, description: 'Document attached' }] },
  },
}
