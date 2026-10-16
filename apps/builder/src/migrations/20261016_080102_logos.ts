import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "logos" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"client_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"filename" varchar,
  	"mime_type" varchar NOT NULL,
  	"size" numeric NOT NULL,
  	"sha256" varchar NOT NULL,
  	"data" varchar NOT NULL,
  	"uploaded_by_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "logos_id" integer;
  ALTER TABLE "logos" ADD CONSTRAINT "logos_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "logos" ADD CONSTRAINT "logos_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "logos_client_idx" ON "logos" USING btree ("client_id");
  CREATE INDEX "logos_uploaded_by_idx" ON "logos" USING btree ("uploaded_by_id");
  CREATE INDEX "logos_updated_at_idx" ON "logos" USING btree ("updated_at");
  CREATE INDEX "logos_created_at_idx" ON "logos" USING btree ("created_at");
  CREATE UNIQUE INDEX "client_path_idx" ON "logos" USING btree ("client_id","path");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_logos_fk" FOREIGN KEY ("logos_id") REFERENCES "public"."logos"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_logos_id_idx" ON "payload_locked_documents_rels" USING btree ("logos_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "logos" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "logos" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_logos_fk";
  
  DROP INDEX "payload_locked_documents_rels_logos_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "logos_id";`)
}
