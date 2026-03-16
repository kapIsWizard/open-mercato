import { z, type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const purchasingTag = 'Purchasing'

export const purchasingOkSchema = z.object({
  ok: z.literal(true),
})

export const purchasingCreatedSchema = z.object({
  id: z.string().uuid().nullable(),
})

export function createPurchasingPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildPurchasingCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: purchasingTag,
  defaultCreateResponseSchema: purchasingCreatedSchema,
  defaultOkResponseSchema: purchasingOkSchema,
})

export function createPurchasingCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildPurchasingCrudOpenApi(options)
}

