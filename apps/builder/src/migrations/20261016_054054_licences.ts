import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_licences_modules" AS ENUM('inventory', 'customers', 'discounts', 'multiOutlet');
  CREATE TYPE "public"."enum_licences_term" AS ENUM('trial', '3m', '12m');
  CREATE TABLE "licences_modules" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_licences_modules",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "licences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"client_id" integer NOT NULL,
  	"licence_id" varchar NOT NULL,
  	"term" "enum_licences_term" NOT NULL,
  	"max_registers" numeric NOT NULL,
  	"issued_at" timestamp(3) with time zone NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"issued_by_id" integer,
  	"file" jsonb NOT NULL,
  	"superseded_by_id" integer,
  	"revoked_at" timestamp(3) with time zone,
  	"revoked_reason" varchar,
  	"revoked_by_id" integer,
  	"last_check_in_at" timestamp(3) with time zone,
  	"last_check_in_host" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "licences_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "licences_id" integer;
  ALTER TABLE "licences_modules" ADD CONSTRAINT "licences_modules_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."licences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "licences" ADD CONSTRAINT "licences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "licences" ADD CONSTRAINT "licences_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "licences" ADD CONSTRAINT "licences_superseded_by_id_licences_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."licences"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "licences" ADD CONSTRAINT "licences_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "licences_texts" ADD CONSTRAINT "licences_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."licences"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "licences_modules_order_idx" ON "licences_modules" USING btree ("order");
  CREATE INDEX "licences_modules_parent_idx" ON "licences_modules" USING btree ("parent_id");
  CREATE INDEX "licences_client_idx" ON "licences" USING btree ("client_id");
  CREATE UNIQUE INDEX "licences_licence_id_idx" ON "licences" USING btree ("licence_id");
  CREATE INDEX "licences_issued_by_idx" ON "licences" USING btree ("issued_by_id");
  CREATE INDEX "licences_superseded_by_idx" ON "licences" USING btree ("superseded_by_id");
  CREATE INDEX "licences_revoked_by_idx" ON "licences" USING btree ("revoked_by_id");
  CREATE INDEX "licences_updated_at_idx" ON "licences" USING btree ("updated_at");
  CREATE INDEX "licences_created_at_idx" ON "licences" USING btree ("created_at");
  CREATE INDEX "licences_texts_order_parent" ON "licences_texts" USING btree ("order","parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_licences_fk" FOREIGN KEY ("licences_id") REFERENCES "public"."licences"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_licences_id_idx" ON "payload_locked_documents_rels" USING btree ("licences_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "licences_modules" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "licences" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "licences_texts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "licences_modules" CASCADE;
  DROP TABLE "licences" CASCADE;
  DROP TABLE "licences_texts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_licences_fk";
  
  DROP INDEX "payload_locked_documents_rels_licences_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "licences_id";
  DROP TYPE "public"."enum_licences_modules";
  DROP TYPE "public"."enum_licences_term";`)
}
