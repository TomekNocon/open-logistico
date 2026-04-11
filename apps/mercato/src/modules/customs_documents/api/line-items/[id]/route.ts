import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomsLineItem, CustomsDeclaration } from '../../../data/entities'
import { updateLineItemSchema } from '../../../data/validators'
import { normalizeLineItemNumerics } from '../../../lib/numbers'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['customs_documents.manage'] },
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json()
  const payload = updateLineItemSchema.parse(body)

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const lineItem = await em.findOne(CustomsLineItem, { id })
  if (!lineItem) return NextResponse.json({ error: 'Line item not found' }, { status: 404 })

  // Verify the user has access to the declaration this line item belongs to
  const declaration = await em.findOne(CustomsDeclaration, {
    id: lineItem.declarationId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })
  if (!declaration) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  if (payload.hsCodeSelected !== undefined) lineItem.hsCodeSelected = payload.hsCodeSelected
  if (payload.hsProposals !== undefined) lineItem.hsProposals = payload.hsProposals

  // If all line items now have an HS code, mark declaration as classified
  await em.flush()

  const allLineItems = await em.find(CustomsLineItem, { declarationId: lineItem.declarationId })
  const allClassified = allLineItems.every(li => li.hsCodeSelected)
  if (allClassified && declaration.status !== 'classified') {
    declaration.status = 'classified'
    await em.flush()
  }

  return NextResponse.json({ ok: true, data: normalizeLineItemNumerics(lineItem) })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Update line item',
  methods: {
    PUT: { summary: 'Save HS code selection for a line item', responses: [{ status: 200, description: 'Updated line item' }] },
  },
}
