import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import {
  CustomsDeclaration,
  CustomsDiscrepancy,
  CustomsLineItem,
} from '../../../../data/entities'
import { exportDeclarationQuerySchema } from '../../../../data/validators'
import {
  buildCustomsTransferCsv,
  buildCustomsTransferFileName,
  buildCustomsTransferPayload,
} from '../../../../lib/export'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customs_documents.view'] },
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const query = exportDeclarationQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const declaration = await em.findOne(CustomsDeclaration, {
    id,
    tenantId: auth.tenantId,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    deletedAt: null,
  })
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 })

  const [lineItems, discrepancies] = await Promise.all([
    em.find(CustomsLineItem, { declarationId: id }, { orderBy: { createdAt: 'ASC' } }),
    em.find(CustomsDiscrepancy, { declarationId: id }, { orderBy: { createdAt: 'ASC' } }),
  ])

  const payloadInput = {
    target: query.target,
    declaration,
    lineItems,
    discrepancies,
  } as const

  const fileName = buildCustomsTransferFileName({
    declarationId: id,
    target: query.target,
    format: query.format,
  })

  if (query.format === 'csv') {
    const csv = buildCustomsTransferCsv(payloadInput)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName}"`,
        'cache-control': 'no-store',
      },
    })
  }

  const payload = buildCustomsTransferPayload(payloadInput)
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Export declaration for customs transfer',
  methods: {
    GET: {
      summary: 'Export declaration payload in WinSAD-ready or generic format',
      description: 'Query params: target=winsad|generic, format=json|csv',
      responses: [{ status: 200, description: 'Export file' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Declaration not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
