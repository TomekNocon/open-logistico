import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  CustomsDeclaration,
  CustomsUploadedDocument,
  CustomsLineItem,
  CustomsDiscrepancy,
} from '../../../data/entities'
import { updateDeclarationSchema } from '../../../data/validators'
import { normalizeDeclarationNumerics, normalizeLineItemNumerics } from '../../../lib/numbers'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customs_documents.view'] },
  PUT: { requireAuth: true, requireFeatures: ['customs_documents.manage'] },
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const declaration = await em.findOne(CustomsDeclaration, {
    id,
    tenantId: auth.tenantId,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    deletedAt: null,
  })
  if (!declaration) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [documents, lineItems, discrepancies] = await Promise.all([
    em.find(CustomsUploadedDocument, { declarationId: id }),
    em.find(CustomsLineItem, { declarationId: id }, { orderBy: { createdAt: 'ASC' } }),
    em.find(CustomsDiscrepancy, { declarationId: id }),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      declaration: normalizeDeclarationNumerics(declaration),
      documents,
      lineItems: lineItems.map((lineItem) => normalizeLineItemNumerics(lineItem)),
      discrepancies,
    },
  })
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json()
  const payload = updateDeclarationSchema.parse(body)

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const declaration = await em.findOne(CustomsDeclaration, {
    id,
    tenantId: auth.tenantId,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    deletedAt: null,
  })
  if (!declaration) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (payload.status !== undefined) declaration.status = payload.status
  if (payload.notes !== undefined) declaration.notes = payload.notes
  if (payload.isNew !== undefined) declaration.isNew = payload.isNew

  await em.flush()
  return NextResponse.json({ ok: true, data: normalizeDeclarationNumerics(declaration) })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Customs declaration detail',
  methods: {
    GET: { summary: 'Get declaration with documents, line items and discrepancies', responses: [{ status: 200, description: 'Declaration detail' }] },
    PUT: { summary: 'Update declaration', responses: [{ status: 200, description: 'Updated declaration' }] },
  },
}
