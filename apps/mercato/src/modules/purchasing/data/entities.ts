import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'purchasing_requests' })
export class PurchasingRequest {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'request_number', type: 'text' })
  requestNumber!: string

  @Property({ name: 'customer_nip', type: 'text', nullable: true })
  customerNip?: string | null

  @Property({ name: 'customer_name', type: 'text', nullable: true })
  customerName?: string | null

  @Property({ name: 'customer_company_id', type: 'uuid', nullable: true })
  customerCompanyId?: string | null

  @Property({ name: 'source_channel', type: 'text', default: 'other' })
  sourceChannel: string = 'other'

  @Property({ name: 'form_variant', type: 'text', default: 'simple' })
  formVariant: string = 'simple'

  @Property({ name: 'request_status', type: 'text', default: 'unassigned' })
  requestStatus: string = 'unassigned'

  @Property({ name: 'sales_owner_user_id', type: 'uuid', nullable: true })
  salesOwnerUserId?: string | null

  @Property({ name: 'purchasing_owner_user_id', type: 'uuid', nullable: true })
  purchasingOwnerUserId?: string | null

  @Property({ name: 'customer_order_number', type: 'text', nullable: true })
  customerOrderNumber?: string | null

  @Property({ name: 'request_text', type: 'text', nullable: true })
  requestText?: string | null

  @Property({ name: 'attachments_count', type: 'integer', default: 0 })
  attachmentsCount: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'purchasing_request_items' })
export class PurchasingRequestItem {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ name: 'line_no', type: 'integer' })
  lineNo!: number

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ name: 'reference_number', type: 'text', nullable: true })
  referenceNumber?: string | null

  @Property({ name: 'product_name', type: 'text' })
  productName!: string

  @Property({ type: 'integer' })
  quantity!: number

  @Property({ name: 'item_status', type: 'text', default: 'to_order' })
  itemStatus: string = 'to_order'

  @Property({ name: 'delivery_due_at', type: Date, nullable: true })
  deliveryDueAt?: Date | null

  @Property({ name: 'supplier_order_number', type: 'text', nullable: true })
  supplierOrderNumber?: string | null

  @Property({ name: 'purchasing_note', type: 'text', nullable: true })
  purchasingNote?: string | null

  @Property({ name: 'catalog_product_id', type: 'uuid', nullable: true })
  catalogProductId?: string | null

  @Property({ name: 'subiekt_document_id', type: 'text', nullable: true })
  subiektDocumentId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'purchasing_comments' })
export class PurchasingComment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ name: 'request_item_id', type: 'uuid', nullable: true })
  requestItemId?: string | null

  @Property({ type: 'text' })
  body!: string

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
