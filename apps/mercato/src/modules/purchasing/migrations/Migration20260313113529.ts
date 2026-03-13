import { Migration } from '@mikro-orm/migrations';

export class Migration20260313113529 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "purchasing_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "request_id" uuid not null, "request_item_id" uuid null, "body" text not null, "author_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "purchasing_comments_pkey" primary key ("id"));`);

    this.addSql(`create table "purchasing_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "request_number" text not null, "customer_nip" text null, "customer_name" text null, "customer_company_id" uuid null, "source_channel" text not null default 'other', "form_variant" text not null default 'simple', "request_status" text not null default 'unassigned', "sales_owner_user_id" uuid null, "purchasing_owner_user_id" uuid null, "customer_order_number" text null, "request_text" text null, "attachments_count" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "purchasing_requests_pkey" primary key ("id"));`);

    this.addSql(`create table "purchasing_request_items" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "request_id" uuid not null, "line_no" int not null, "sku" text null, "product_name" text not null, "quantity" int not null, "item_status" text not null default 'to_order', "delivery_due_at" timestamptz null, "supplier_order_number" text null, "purchasing_note" text null, "catalog_product_id" uuid null, "subiekt_document_id" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "purchasing_request_items_pkey" primary key ("id"));`);
  }

}
