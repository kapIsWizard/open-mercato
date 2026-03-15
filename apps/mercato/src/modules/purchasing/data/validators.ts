import { z } from 'zod'
import {
  itemStatusStorageValues,
  itemStatusViewValues,
  requestStatusStorageValues,
  requestStatusViewValues,
} from '../lib/statuses'

const uuidMessage = 'Invalid identifier.'
const productNameRequiredMessage = 'Product name is required.'
const productNameMaxMessage = 'Product name must be 500 characters or fewer.'
const quantityMessage = 'Quantity must be a whole number greater than 0.'
const commentBodyRequiredMessage = 'Comment body is required.'
const commentBodyMaxMessage = 'Comment body must be 4000 characters or fewer.'

export const requestStatusSchema = z.enum([
  ...requestStatusStorageValues,
  ...requestStatusViewValues.filter((value) => !requestStatusStorageValues.includes(value as typeof requestStatusStorageValues[number])),
] as [string, ...string[]])

export const itemStatusSchema = z.enum([
  ...itemStatusStorageValues,
  ...itemStatusViewValues.filter((value) => !itemStatusStorageValues.includes(value as typeof itemStatusStorageValues[number])),
] as [string, ...string[]])

export const sourceChannelSchema = z.enum(['phone', 'email', 'meeting', 'chat', 'other'])
export const formVariantSchema = z.enum(['simple', 'extended'])

export const purchasingRequestItemUpsertSchema = z.object({
  id: z.string().uuid(uuidMessage).optional(),
  catalogProductId: z.string().uuid(uuidMessage).optional().nullable(),
  sku: z.string().trim().max(120, 'SKU must be 120 characters or fewer.').optional().nullable(),
  referenceNumber: z.string().trim().max(120, 'Reference number must be 120 characters or fewer.').optional().nullable(),
  productName: z.string().trim().min(1, productNameRequiredMessage).max(500, productNameMaxMessage),
  quantity: z.coerce.number().int(quantityMessage).positive(quantityMessage),
  itemStatus: itemStatusSchema.optional(),
  deliveryDueAt: z.string().optional().nullable(),
  supplierOrderNumber: z.string().trim().max(120, 'Supplier order number must be 120 characters or fewer.').optional().nullable(),
  purchasingNote: z.string().trim().max(4000, 'Purchasing note must be 4000 characters or fewer.').optional().nullable(),
})

export const purchasingRequestCreateSchema = z.object({
  tenantId: z.string().uuid(uuidMessage).optional().nullable(),
  organizationId: z.string().uuid(uuidMessage).optional().nullable(),
  customerNip: z.string().trim().max(32, 'Customer NIP must be 32 characters or fewer.').optional().nullable(),
  customerName: z.string().trim().max(255, 'Customer name must be 255 characters or fewer.').optional().nullable(),
  customerCompanyId: z.string().uuid(uuidMessage).optional().nullable(),
  sourceChannel: sourceChannelSchema.default('other'),
  formVariant: formVariantSchema.default('simple'),
  salesOwnerUserId: z.string().uuid(uuidMessage).optional().nullable(),
  purchasingOwnerUserId: z.string().uuid(uuidMessage).optional().nullable(),
  customerOrderNumber: z.string().trim().max(120, 'Customer order number must be 120 characters or fewer.').optional().nullable(),
  requestText: z.string().trim().max(12000, 'Request text must be 12000 characters or fewer.').optional().nullable(),
  items: z.array(purchasingRequestItemUpsertSchema).min(1, 'Add at least one request item.'),
}).superRefine((value, ctx) => {
  if (!value.customerCompanyId && !value.customerNip && !value.customerName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide customer name or NIP.',
      path: ['customerName'],
    })
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide customer name or NIP.',
      path: ['customerNip'],
    })
  }
})

export const purchasingRequestUpdateSchema = z.object({
  id: z.string().uuid(uuidMessage),
  tenantId: z.string().uuid(uuidMessage).optional().nullable(),
  organizationId: z.string().uuid(uuidMessage).optional().nullable(),
  customerNip: z.string().trim().max(32, 'Customer NIP must be 32 characters or fewer.').optional().nullable(),
  customerName: z.string().trim().max(255, 'Customer name must be 255 characters or fewer.').optional().nullable(),
  customerCompanyId: z.string().uuid(uuidMessage).optional().nullable(),
  sourceChannel: sourceChannelSchema.optional(),
  formVariant: formVariantSchema.optional(),
  requestStatus: requestStatusSchema.optional(),
  salesOwnerUserId: z.string().uuid(uuidMessage).optional().nullable(),
  purchasingOwnerUserId: z.string().uuid(uuidMessage).optional().nullable(),
  customerOrderNumber: z.string().trim().max(120, 'Customer order number must be 120 characters or fewer.').optional().nullable(),
  requestText: z.string().trim().max(12000, 'Request text must be 12000 characters or fewer.').optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.customerNip !== undefined && value.customerName !== undefined) {
    const customerNip = value.customerNip?.trim() ?? ''
    const customerName = value.customerName?.trim() ?? ''
    const customerCompanyId = value.customerCompanyId?.trim() ?? ''
    if (!customerCompanyId && !customerNip && !customerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide customer name or NIP.',
        path: ['customerName'],
      })
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide customer name or NIP.',
        path: ['customerNip'],
      })
    }
  }
})

export const purchasingRequestDeleteSchema = z.object({
  id: z.string().uuid(uuidMessage),
})

export const purchasingRequestItemCreateSchema = z.object({
  tenantId: z.string().uuid(uuidMessage).optional().nullable(),
  organizationId: z.string().uuid(uuidMessage).optional().nullable(),
  requestId: z.string().uuid(uuidMessage),
  catalogProductId: z.string().uuid(uuidMessage).optional().nullable(),
  sku: z.string().trim().max(120, 'SKU must be 120 characters or fewer.').optional().nullable(),
  referenceNumber: z.string().trim().max(120, 'Reference number must be 120 characters or fewer.').optional().nullable(),
  productName: z.string().trim().min(1, productNameRequiredMessage).max(500, productNameMaxMessage),
  quantity: z.coerce.number().int(quantityMessage).positive(quantityMessage),
  itemStatus: itemStatusSchema.optional(),
  deliveryDueAt: z.string().optional().nullable(),
  supplierOrderNumber: z.string().trim().max(120, 'Supplier order number must be 120 characters or fewer.').optional().nullable(),
  purchasingNote: z.string().trim().max(4000, 'Purchasing note must be 4000 characters or fewer.').optional().nullable(),
})

export const purchasingRequestItemUpdateSchema = z.object({
  id: z.string().uuid(uuidMessage),
  tenantId: z.string().uuid(uuidMessage).optional().nullable(),
  organizationId: z.string().uuid(uuidMessage).optional().nullable(),
  catalogProductId: z.string().uuid(uuidMessage).optional().nullable(),
  sku: z.string().trim().max(120, 'SKU must be 120 characters or fewer.').optional().nullable(),
  referenceNumber: z.string().trim().max(120, 'Reference number must be 120 characters or fewer.').optional().nullable(),
  productName: z.string().trim().min(1, productNameRequiredMessage).max(500, productNameMaxMessage).optional(),
  quantity: z.coerce.number().int(quantityMessage).positive(quantityMessage).optional(),
  itemStatus: itemStatusSchema.optional(),
  deliveryDueAt: z.string().optional().nullable(),
  supplierOrderNumber: z.string().trim().max(120, 'Supplier order number must be 120 characters or fewer.').optional().nullable(),
  purchasingNote: z.string().trim().max(4000, 'Purchasing note must be 4000 characters or fewer.').optional().nullable(),
})

export const purchasingRequestItemDeleteSchema = z.object({
  id: z.string().uuid(uuidMessage),
})

export const purchasingCommentCreateSchema = z.object({
  tenantId: z.string().uuid(uuidMessage).optional().nullable(),
  organizationId: z.string().uuid(uuidMessage).optional().nullable(),
  requestId: z.string().uuid(uuidMessage),
  requestItemId: z.string().uuid(uuidMessage).optional().nullable(),
  body: z.string().trim().min(1, commentBodyRequiredMessage).max(4000, commentBodyMaxMessage),
  authorUserId: z.string().uuid(uuidMessage).optional().nullable(),
})

export const purchasingCommentUpdateSchema = z.object({
  id: z.string().uuid(uuidMessage),
  body: z.string().trim().min(1, commentBodyRequiredMessage).max(4000, commentBodyMaxMessage).optional(),
  requestItemId: z.string().uuid(uuidMessage).optional().nullable(),
})

export const purchasingCommentDeleteSchema = z.object({
  id: z.string().uuid(uuidMessage),
})

export const purchasingRequestListSchema = z.object({
  id: z.string().uuid(uuidMessage).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  requestStatus: requestStatusSchema.optional(),
  itemStatus: itemStatusSchema.optional(),
  customerNip: z.string().optional(),
  purchasingOwnerUserId: z.string().uuid(uuidMessage).optional(),
  salesOwnerUserId: z.string().uuid(uuidMessage).optional(),
  sku: z.string().optional(),
  referenceNumber: z.string().optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export const purchasingRequestItemListSchema = z.object({
  id: z.string().uuid(uuidMessage).optional(),
  requestId: z.string().uuid(uuidMessage).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  sku: z.string().optional(),
  referenceNumber: z.string().optional(),
  itemStatus: itemStatusSchema.optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export const purchasingCommentListSchema = z.object({
  requestId: z.string().uuid(uuidMessage).optional(),
  requestItemId: z.string().uuid(uuidMessage).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export type PurchasingRequestCreateInput = z.infer<typeof purchasingRequestCreateSchema>
export type PurchasingRequestUpdateInput = z.infer<typeof purchasingRequestUpdateSchema>
export type PurchasingRequestItemCreateInput = z.infer<typeof purchasingRequestItemCreateSchema>
export type PurchasingRequestItemUpdateInput = z.infer<typeof purchasingRequestItemUpdateSchema>
export type PurchasingCommentCreateInput = z.infer<typeof purchasingCommentCreateSchema>
export type PurchasingCommentUpdateInput = z.infer<typeof purchasingCommentUpdateSchema>
