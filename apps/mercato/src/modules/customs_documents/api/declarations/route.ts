import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomsDeclaration } from '../../data/entities'
import { createDeclarationSchema, listDeclarationsSchema } from '../../data/validators'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customs_documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['customs_documents.manage'] },
}

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = Object.fromEntries(req.nextUrl.searchParams.entries())
  const query = listDeclarationsSchema.parse(params)

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    deletedAt: null,
  }
  if (query.status) where.status = query.status
  if (query.search) where.blNumber = { $ilike: `%${query.search}%` }

  const [items, total] = await em.findAndCount(CustomsDeclaration, where, {
    orderBy: { createdAt: 'DESC' },
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  })

  return NextResponse.json({
    ok: true,
    data: items,
    meta: { page: query.page, pageSize: query.pageSize, total },
  })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const payload = createDeclarationSchema.parse({
    ...body,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const declaration = em.create(CustomsDeclaration, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    notes: payload.notes,
    status: 'draft',
  })
  await em.persistAndFlush(declaration)

  return NextResponse.json({ ok: true, data: declaration }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Customs declarations',
  methods: {
    GET: { summary: 'List customs declarations', responses: [{ status: 200, description: 'List of declarations' }] },
    POST: { summary: 'Create customs declaration', responses: [{ status: 201, description: 'Created declaration' }] },
  },
}
