import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_sales_payments_method_type" AS ENUM('cash', 'card_external', 'qr', 'other');
  CREATE TYPE "public"."enum_sales_status" AS ENUM('completed');
  CREATE TYPE "public"."enum_refunds_payouts_method_type" AS ENUM('cash', 'card_external', 'qr', 'other');
  CREATE TYPE "public"."enum_shifts_status" AS ENUM('open', 'closed');
  CREATE TYPE "public"."enum_cash_movements_type" AS ENUM('in', 'out');
  CREATE TYPE "public"."enum_stock_movements_type" AS ENUM('initial', 'sale', 'refund', 'adjustment');
  CREATE TYPE "public"."enum_users_role" AS ENUM('admin', 'manager', 'cashier');
  CREATE TYPE "public"."enum_payment_methods_type" AS ENUM('cash', 'card_external', 'qr', 'other');
  CREATE TYPE "public"."enum_system_settings_date_format" AS ENUM('yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd.MM.yyyy', 'dd-MM-yyyy');
  CREATE TYPE "public"."enum_system_settings_receipt_paper_width_mm" AS ENUM('58', '80');
  CREATE TABLE "sales_lines" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"variant_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"sku" varchar NOT NULL,
  	"unit_price" numeric NOT NULL,
  	"quantity" numeric NOT NULL,
  	"tax_rate_percent" numeric NOT NULL,
  	"gross" numeric NOT NULL,
  	"line_discount" numeric NOT NULL,
  	"cart_discount" numeric NOT NULL,
  	"tax" numeric NOT NULL,
  	"total" numeric NOT NULL
  );
  
  CREATE TABLE "sales_payments" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"payment_method_id" integer NOT NULL,
  	"method_code" varchar NOT NULL,
  	"method_label" varchar NOT NULL,
  	"method_type" "enum_sales_payments_method_type" NOT NULL,
  	"amount" numeric NOT NULL,
  	"reference" varchar
  );
  
  CREATE TABLE "sales" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"receipt_number" varchar NOT NULL,
  	"number" numeric NOT NULL,
  	"register_id" integer NOT NULL,
  	"outlet_id" integer NOT NULL,
  	"shift_id" integer NOT NULL,
  	"cashier_id" integer NOT NULL,
  	"customer_id" integer,
  	"status" "enum_sales_status" DEFAULT 'completed' NOT NULL,
  	"completed_at" timestamp(3) with time zone NOT NULL,
  	"prices_include_tax" boolean DEFAULT false NOT NULL,
  	"subtotal" numeric NOT NULL,
  	"discount_total" numeric NOT NULL,
  	"tax_total" numeric NOT NULL,
  	"total" numeric NOT NULL,
  	"change" numeric DEFAULT 0 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "refunds_lines" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"sale_line_id" varchar NOT NULL,
  	"variant_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"sku" varchar NOT NULL,
  	"quantity" numeric NOT NULL,
  	"tax_rate_percent" numeric NOT NULL,
  	"tax" numeric NOT NULL,
  	"total" numeric NOT NULL,
  	"restock" boolean DEFAULT true NOT NULL
  );
  
  CREATE TABLE "refunds_payouts" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"payment_method_id" integer NOT NULL,
  	"method_code" varchar NOT NULL,
  	"method_label" varchar NOT NULL,
  	"method_type" "enum_refunds_payouts_method_type" NOT NULL,
  	"amount" numeric NOT NULL,
  	"reference" varchar
  );
  
  CREATE TABLE "refunds" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"sale_id" integer NOT NULL,
  	"outlet_id" integer NOT NULL,
  	"register_id" integer NOT NULL,
  	"shift_id" integer NOT NULL,
  	"tax_total" numeric NOT NULL,
  	"total" numeric NOT NULL,
  	"processed_by_id" integer NOT NULL,
  	"approved_by_id" integer NOT NULL,
  	"reason" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "shifts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"register_id" integer NOT NULL,
  	"outlet_id" integer NOT NULL,
  	"cashier_id" integer NOT NULL,
  	"status" "enum_shifts_status" DEFAULT 'open' NOT NULL,
  	"opened_at" timestamp(3) with time zone NOT NULL,
  	"opening_float" numeric NOT NULL,
  	"closed_at" timestamp(3) with time zone,
  	"expected_cash" numeric,
  	"counted_cash" numeric,
  	"variance" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cash_movements" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"shift_id" integer NOT NULL,
  	"outlet_id" integer NOT NULL,
  	"type" "enum_cash_movements_type" NOT NULL,
  	"amount" numeric NOT NULL,
  	"reason" varchar NOT NULL,
  	"user_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "customers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"phone" varchar,
  	"email" varchar,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "products" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"sku" varchar NOT NULL,
  	"category_id" integer,
  	"image_id" integer,
  	"tax_rate_id" integer NOT NULL,
  	"has_variants" boolean DEFAULT false,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "product_variants_barcodes" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL
  );
  
  CREATE TABLE "product_variants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"sku" varchar NOT NULL,
  	"price" numeric NOT NULL,
  	"cost" numeric,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"parent_id" integer,
  	"sort_order" numeric DEFAULT 0,
  	"colour" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"prefix" varchar DEFAULT '',
  	"_objectkey" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "stock_levels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"variant_id" integer NOT NULL,
  	"outlet_id" integer NOT NULL,
  	"quantity" numeric DEFAULT 0 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "stock_movements" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"variant_id" integer NOT NULL,
  	"outlet_id" integer NOT NULL,
  	"delta" numeric NOT NULL,
  	"type" "enum_stock_movements_type" NOT NULL,
  	"reference" varchar,
  	"user_id" integer NOT NULL,
  	"reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"role" "enum_users_role" DEFAULT 'cashier' NOT NULL,
  	"must_change_password" boolean DEFAULT true,
  	"pin_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "users_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"outlets_id" integer
  );
  
  CREATE TABLE "outlets" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"address" varchar,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "registers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"outlet_id" integer NOT NULL,
  	"next_sale_number" numeric DEFAULT 1 NOT NULL,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tax_rates" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"rate_percent" numeric NOT NULL,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payment_methods" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"label" varchar NOT NULL,
  	"type" "enum_payment_methods_type" NOT NULL,
  	"enabled" boolean DEFAULT true,
  	"requires_reference" boolean DEFAULT false,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "audit_log" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"actor_id" integer,
  	"action" varchar NOT NULL,
  	"entity" varchar NOT NULL,
  	"entity_id" varchar,
  	"data" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"sales_id" integer,
  	"refunds_id" integer,
  	"shifts_id" integer,
  	"cash_movements_id" integer,
  	"customers_id" integer,
  	"products_id" integer,
  	"product_variants_id" integer,
  	"categories_id" integer,
  	"media_id" integer,
  	"stock_levels_id" integer,
  	"stock_movements_id" integer,
  	"users_id" integer,
  	"outlets_id" integer,
  	"registers_id" integer,
  	"tax_rates_id" integer,
  	"payment_methods_id" integer,
  	"audit_log_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "system_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"legal_name" varchar NOT NULL,
  	"display_name" varchar NOT NULL,
  	"address" varchar,
  	"phone" varchar,
  	"email" varchar,
  	"tax_registration_no" varchar,
  	"currency" varchar NOT NULL,
  	"locale" varchar NOT NULL,
  	"timezone" varchar NOT NULL,
  	"date_format" "enum_system_settings_date_format" NOT NULL,
  	"prices_include_tax" boolean DEFAULT true,
  	"default_tax_rate_id" integer,
  	"modules_inventory" boolean DEFAULT false,
  	"modules_customers" boolean DEFAULT false,
  	"modules_discounts" boolean DEFAULT false,
  	"modules_multi_outlet" boolean DEFAULT false,
  	"receipt_paper_width_mm" "enum_system_settings_receipt_paper_width_mm" DEFAULT '80' NOT NULL,
  	"receipt_show_tax_breakdown" boolean DEFAULT true,
  	"receipt_show_cashier_name" boolean DEFAULT true,
  	"client_id" varchar,
  	"config_schema_version" numeric,
  	"seeded_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "branding" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"logo_id" integer,
  	"primary_color" varchar DEFAULT '#0F766E' NOT NULL,
  	"accent_color" varchar DEFAULT '#F59E0B' NOT NULL,
  	"receipt_header" varchar,
  	"receipt_footer" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sales_payments" ADD CONSTRAINT "sales_payments_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sales_payments" ADD CONSTRAINT "sales_payments_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sales" ADD CONSTRAINT "sales_register_id_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."registers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sales" ADD CONSTRAINT "sales_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refunds_lines" ADD CONSTRAINT "refunds_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refunds_lines" ADD CONSTRAINT "refunds_lines_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "refunds_payouts" ADD CONSTRAINT "refunds_payouts_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refunds_payouts" ADD CONSTRAINT "refunds_payouts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_register_id_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."registers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_processed_by_id_users_id_fk" FOREIGN KEY ("processed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shifts" ADD CONSTRAINT "shifts_register_id_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."registers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shifts" ADD CONSTRAINT "shifts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shifts" ADD CONSTRAINT "shifts_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_variants_barcodes" ADD CONSTRAINT "product_variants_barcodes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_rels" ADD CONSTRAINT "users_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_rels" ADD CONSTRAINT "users_rels_outlets_fk" FOREIGN KEY ("outlets_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "registers" ADD CONSTRAINT "registers_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sales_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_refunds_fk" FOREIGN KEY ("refunds_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_shifts_fk" FOREIGN KEY ("shifts_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_cash_movements_fk" FOREIGN KEY ("cash_movements_id") REFERENCES "public"."cash_movements"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_variants_fk" FOREIGN KEY ("product_variants_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stock_levels_fk" FOREIGN KEY ("stock_levels_id") REFERENCES "public"."stock_levels"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stock_movements_fk" FOREIGN KEY ("stock_movements_id") REFERENCES "public"."stock_movements"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_outlets_fk" FOREIGN KEY ("outlets_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_registers_fk" FOREIGN KEY ("registers_id") REFERENCES "public"."registers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tax_rates_fk" FOREIGN KEY ("tax_rates_id") REFERENCES "public"."tax_rates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_payment_methods_fk" FOREIGN KEY ("payment_methods_id") REFERENCES "public"."payment_methods"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_audit_log_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_log"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_default_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("default_tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "branding" ADD CONSTRAINT "branding_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "sales_lines_order_idx" ON "sales_lines" USING btree ("_order");
  CREATE INDEX "sales_lines_parent_id_idx" ON "sales_lines" USING btree ("_parent_id");
  CREATE INDEX "sales_lines_variant_idx" ON "sales_lines" USING btree ("variant_id");
  CREATE INDEX "sales_payments_order_idx" ON "sales_payments" USING btree ("_order");
  CREATE INDEX "sales_payments_parent_id_idx" ON "sales_payments" USING btree ("_parent_id");
  CREATE INDEX "sales_payments_payment_method_idx" ON "sales_payments" USING btree ("payment_method_id");
  CREATE UNIQUE INDEX "sales_receipt_number_idx" ON "sales" USING btree ("receipt_number");
  CREATE INDEX "sales_register_idx" ON "sales" USING btree ("register_id");
  CREATE INDEX "sales_outlet_idx" ON "sales" USING btree ("outlet_id");
  CREATE INDEX "sales_shift_idx" ON "sales" USING btree ("shift_id");
  CREATE INDEX "sales_cashier_idx" ON "sales" USING btree ("cashier_id");
  CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");
  CREATE INDEX "sales_completed_at_idx" ON "sales" USING btree ("completed_at");
  CREATE INDEX "sales_updated_at_idx" ON "sales" USING btree ("updated_at");
  CREATE INDEX "sales_created_at_idx" ON "sales" USING btree ("created_at");
  CREATE UNIQUE INDEX "register_number_idx" ON "sales" USING btree ("register_id","number");
  CREATE INDEX "refunds_lines_order_idx" ON "refunds_lines" USING btree ("_order");
  CREATE INDEX "refunds_lines_parent_id_idx" ON "refunds_lines" USING btree ("_parent_id");
  CREATE INDEX "refunds_lines_variant_idx" ON "refunds_lines" USING btree ("variant_id");
  CREATE INDEX "refunds_payouts_order_idx" ON "refunds_payouts" USING btree ("_order");
  CREATE INDEX "refunds_payouts_parent_id_idx" ON "refunds_payouts" USING btree ("_parent_id");
  CREATE INDEX "refunds_payouts_payment_method_idx" ON "refunds_payouts" USING btree ("payment_method_id");
  CREATE INDEX "refunds_sale_idx" ON "refunds" USING btree ("sale_id");
  CREATE INDEX "refunds_outlet_idx" ON "refunds" USING btree ("outlet_id");
  CREATE INDEX "refunds_register_idx" ON "refunds" USING btree ("register_id");
  CREATE INDEX "refunds_shift_idx" ON "refunds" USING btree ("shift_id");
  CREATE INDEX "refunds_processed_by_idx" ON "refunds" USING btree ("processed_by_id");
  CREATE INDEX "refunds_approved_by_idx" ON "refunds" USING btree ("approved_by_id");
  CREATE INDEX "refunds_updated_at_idx" ON "refunds" USING btree ("updated_at");
  CREATE INDEX "refunds_created_at_idx" ON "refunds" USING btree ("created_at");
  CREATE INDEX "shifts_register_idx" ON "shifts" USING btree ("register_id");
  CREATE INDEX "shifts_outlet_idx" ON "shifts" USING btree ("outlet_id");
  CREATE INDEX "shifts_cashier_idx" ON "shifts" USING btree ("cashier_id");
  CREATE INDEX "shifts_status_idx" ON "shifts" USING btree ("status");
  CREATE INDEX "shifts_updated_at_idx" ON "shifts" USING btree ("updated_at");
  CREATE INDEX "shifts_created_at_idx" ON "shifts" USING btree ("created_at");
  CREATE INDEX "cash_movements_shift_idx" ON "cash_movements" USING btree ("shift_id");
  CREATE INDEX "cash_movements_outlet_idx" ON "cash_movements" USING btree ("outlet_id");
  CREATE INDEX "cash_movements_user_idx" ON "cash_movements" USING btree ("user_id");
  CREATE INDEX "cash_movements_updated_at_idx" ON "cash_movements" USING btree ("updated_at");
  CREATE INDEX "cash_movements_created_at_idx" ON "cash_movements" USING btree ("created_at");
  CREATE INDEX "customers_name_idx" ON "customers" USING btree ("name");
  CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");
  CREATE INDEX "customers_updated_at_idx" ON "customers" USING btree ("updated_at");
  CREATE INDEX "customers_created_at_idx" ON "customers" USING btree ("created_at");
  CREATE INDEX "products_name_idx" ON "products" USING btree ("name");
  CREATE UNIQUE INDEX "products_sku_idx" ON "products" USING btree ("sku");
  CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");
  CREATE INDEX "products_image_idx" ON "products" USING btree ("image_id");
  CREATE INDEX "products_tax_rate_idx" ON "products" USING btree ("tax_rate_id");
  CREATE INDEX "products_updated_at_idx" ON "products" USING btree ("updated_at");
  CREATE INDEX "products_created_at_idx" ON "products" USING btree ("created_at");
  CREATE INDEX "product_variants_barcodes_order_idx" ON "product_variants_barcodes" USING btree ("_order");
  CREATE INDEX "product_variants_barcodes_parent_id_idx" ON "product_variants_barcodes" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "product_variants_barcodes_code_idx" ON "product_variants_barcodes" USING btree ("code");
  CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");
  CREATE UNIQUE INDEX "product_variants_sku_idx" ON "product_variants" USING btree ("sku");
  CREATE INDEX "product_variants_updated_at_idx" ON "product_variants" USING btree ("updated_at");
  CREATE INDEX "product_variants_created_at_idx" ON "product_variants" USING btree ("created_at");
  CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");
  CREATE INDEX "categories_updated_at_idx" ON "categories" USING btree ("updated_at");
  CREATE INDEX "categories_created_at_idx" ON "categories" USING btree ("created_at");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "stock_levels_variant_idx" ON "stock_levels" USING btree ("variant_id");
  CREATE INDEX "stock_levels_outlet_idx" ON "stock_levels" USING btree ("outlet_id");
  CREATE INDEX "stock_levels_updated_at_idx" ON "stock_levels" USING btree ("updated_at");
  CREATE INDEX "stock_levels_created_at_idx" ON "stock_levels" USING btree ("created_at");
  CREATE UNIQUE INDEX "variant_outlet_idx" ON "stock_levels" USING btree ("variant_id","outlet_id");
  CREATE INDEX "stock_movements_variant_idx" ON "stock_movements" USING btree ("variant_id");
  CREATE INDEX "stock_movements_outlet_idx" ON "stock_movements" USING btree ("outlet_id");
  CREATE INDEX "stock_movements_type_idx" ON "stock_movements" USING btree ("type");
  CREATE INDEX "stock_movements_user_idx" ON "stock_movements" USING btree ("user_id");
  CREATE INDEX "stock_movements_updated_at_idx" ON "stock_movements" USING btree ("updated_at");
  CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements" USING btree ("created_at");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "users_rels_order_idx" ON "users_rels" USING btree ("order");
  CREATE INDEX "users_rels_parent_idx" ON "users_rels" USING btree ("parent_id");
  CREATE INDEX "users_rels_path_idx" ON "users_rels" USING btree ("path");
  CREATE INDEX "users_rels_outlets_id_idx" ON "users_rels" USING btree ("outlets_id");
  CREATE UNIQUE INDEX "outlets_code_idx" ON "outlets" USING btree ("code");
  CREATE INDEX "outlets_updated_at_idx" ON "outlets" USING btree ("updated_at");
  CREATE INDEX "outlets_created_at_idx" ON "outlets" USING btree ("created_at");
  CREATE UNIQUE INDEX "registers_code_idx" ON "registers" USING btree ("code");
  CREATE INDEX "registers_outlet_idx" ON "registers" USING btree ("outlet_id");
  CREATE INDEX "registers_updated_at_idx" ON "registers" USING btree ("updated_at");
  CREATE INDEX "registers_created_at_idx" ON "registers" USING btree ("created_at");
  CREATE UNIQUE INDEX "tax_rates_code_idx" ON "tax_rates" USING btree ("code");
  CREATE INDEX "tax_rates_updated_at_idx" ON "tax_rates" USING btree ("updated_at");
  CREATE INDEX "tax_rates_created_at_idx" ON "tax_rates" USING btree ("created_at");
  CREATE UNIQUE INDEX "payment_methods_code_idx" ON "payment_methods" USING btree ("code");
  CREATE INDEX "payment_methods_updated_at_idx" ON "payment_methods" USING btree ("updated_at");
  CREATE INDEX "payment_methods_created_at_idx" ON "payment_methods" USING btree ("created_at");
  CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");
  CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");
  CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity");
  CREATE INDEX "audit_log_entity_id_idx" ON "audit_log" USING btree ("entity_id");
  CREATE INDEX "audit_log_updated_at_idx" ON "audit_log" USING btree ("updated_at");
  CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_sales_id_idx" ON "payload_locked_documents_rels" USING btree ("sales_id");
  CREATE INDEX "payload_locked_documents_rels_refunds_id_idx" ON "payload_locked_documents_rels" USING btree ("refunds_id");
  CREATE INDEX "payload_locked_documents_rels_shifts_id_idx" ON "payload_locked_documents_rels" USING btree ("shifts_id");
  CREATE INDEX "payload_locked_documents_rels_cash_movements_id_idx" ON "payload_locked_documents_rels" USING btree ("cash_movements_id");
  CREATE INDEX "payload_locked_documents_rels_customers_id_idx" ON "payload_locked_documents_rels" USING btree ("customers_id");
  CREATE INDEX "payload_locked_documents_rels_products_id_idx" ON "payload_locked_documents_rels" USING btree ("products_id");
  CREATE INDEX "payload_locked_documents_rels_product_variants_id_idx" ON "payload_locked_documents_rels" USING btree ("product_variants_id");
  CREATE INDEX "payload_locked_documents_rels_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("categories_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_stock_levels_id_idx" ON "payload_locked_documents_rels" USING btree ("stock_levels_id");
  CREATE INDEX "payload_locked_documents_rels_stock_movements_id_idx" ON "payload_locked_documents_rels" USING btree ("stock_movements_id");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_outlets_id_idx" ON "payload_locked_documents_rels" USING btree ("outlets_id");
  CREATE INDEX "payload_locked_documents_rels_registers_id_idx" ON "payload_locked_documents_rels" USING btree ("registers_id");
  CREATE INDEX "payload_locked_documents_rels_tax_rates_id_idx" ON "payload_locked_documents_rels" USING btree ("tax_rates_id");
  CREATE INDEX "payload_locked_documents_rels_payment_methods_id_idx" ON "payload_locked_documents_rels" USING btree ("payment_methods_id");
  CREATE INDEX "payload_locked_documents_rels_audit_log_id_idx" ON "payload_locked_documents_rels" USING btree ("audit_log_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");
  CREATE INDEX "system_settings_default_tax_rate_idx" ON "system_settings" USING btree ("default_tax_rate_id");
  CREATE INDEX "branding_logo_idx" ON "branding" USING btree ("logo_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "sales_lines" CASCADE;
  DROP TABLE "sales_payments" CASCADE;
  DROP TABLE "sales" CASCADE;
  DROP TABLE "refunds_lines" CASCADE;
  DROP TABLE "refunds_payouts" CASCADE;
  DROP TABLE "refunds" CASCADE;
  DROP TABLE "shifts" CASCADE;
  DROP TABLE "cash_movements" CASCADE;
  DROP TABLE "customers" CASCADE;
  DROP TABLE "products" CASCADE;
  DROP TABLE "product_variants_barcodes" CASCADE;
  DROP TABLE "product_variants" CASCADE;
  DROP TABLE "categories" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "stock_levels" CASCADE;
  DROP TABLE "stock_movements" CASCADE;
  DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "users_rels" CASCADE;
  DROP TABLE "outlets" CASCADE;
  DROP TABLE "registers" CASCADE;
  DROP TABLE "tax_rates" CASCADE;
  DROP TABLE "payment_methods" CASCADE;
  DROP TABLE "audit_log" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "system_settings" CASCADE;
  DROP TABLE "branding" CASCADE;
  DROP TYPE "public"."enum_sales_payments_method_type";
  DROP TYPE "public"."enum_sales_status";
  DROP TYPE "public"."enum_refunds_payouts_method_type";
  DROP TYPE "public"."enum_shifts_status";
  DROP TYPE "public"."enum_cash_movements_type";
  DROP TYPE "public"."enum_stock_movements_type";
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_payment_methods_type";
  DROP TYPE "public"."enum_system_settings_date_format";
  DROP TYPE "public"."enum_system_settings_receipt_paper_width_mm";`)
}
