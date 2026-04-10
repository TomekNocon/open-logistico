import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { hsSearchSchema } from '../../data/validators'
import { searchHsCodes } from '../../lib/isztar4'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customs_documents.view'] },
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const payload = hsSearchSchema.parse(body)

  const proposals = await searchHsCodes(payload.description, payload.language)

  return NextResponse.json({ ok: true, data: { proposals } })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customs Documents',
  summary: 'Search ISZTAR4 for HS codes',
  methods: {
    POST: { summary: 'Get HS code proposals for a product description', responses: [{ status: 200, description: 'HS code proposals' }] },
  },
}
