-- HNSW index on document_chunks embedding column for fast cosine similarity search
CREATE INDEX idx_document_chunks_embedding_hnsw ON vectors.document_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
--> statement-breakpoint

-- Audit trigger function: automatically logs INSERT, UPDATE, DELETE
-- on all tables in the contracts schema
CREATE OR REPLACE FUNCTION audit.log_changes()
RETURNS TRIGGER AS $$
DECLARE
  rec_id uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    rec_id := (to_jsonb(OLD) ->> 'id')::uuid;
    INSERT INTO audit.audit_log (schema_name, table_name, record_id, action, old_values, new_values, changed_by)
    VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, rec_id, 'DELETE', to_jsonb(OLD), NULL,
            coalesce(current_setting('app.current_user', true), 'system'));
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    rec_id := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit.audit_log (schema_name, table_name, record_id, action, old_values, new_values, changed_by)
    VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, rec_id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
            coalesce(current_setting('app.current_user', true), 'system'));
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    rec_id := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit.audit_log (schema_name, table_name, record_id, action, old_values, new_values, changed_by)
    VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, rec_id, 'INSERT', NULL, to_jsonb(NEW),
            coalesce(current_setting('app.current_user', true), 'system'));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Create audit triggers on all contracts schema tables
CREATE TRIGGER audit_contracts
  AFTER INSERT OR UPDATE OR DELETE ON contracts.contracts
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_contract_options
  AFTER INSERT OR UPDATE OR DELETE ON contracts.contract_options
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_modifications
  AFTER INSERT OR UPDATE OR DELETE ON contracts.modifications
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_clins
  AFTER INSERT OR UPDATE OR DELETE ON contracts.clins
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_deliverables
  AFTER INSERT OR UPDATE OR DELETE ON contracts.deliverables
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_subcontracts
  AFTER INSERT OR UPDATE OR DELETE ON contracts.subcontracts
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_parties
  AFTER INSERT OR UPDATE OR DELETE ON contracts.parties
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_ndas
  AFTER INSERT OR UPDATE OR DELETE ON contracts.ndas
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_mous
  AFTER INSERT OR UPDATE OR DELETE ON contracts.mous
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_mou_parties
  AFTER INSERT OR UPDATE OR DELETE ON contracts.mou_parties
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_contract_clauses
  AFTER INSERT OR UPDATE OR DELETE ON contracts.contract_clauses
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_clause_library
  AFTER INSERT OR UPDATE OR DELETE ON contracts.clause_library
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_flowdown_requirements
  AFTER INSERT OR UPDATE OR DELETE ON contracts.flowdown_requirements
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_compliance_milestones
  AFTER INSERT OR UPDATE OR DELETE ON contracts.compliance_milestones
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_government_property
  AFTER INSERT OR UPDATE OR DELETE ON contracts.government_property
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_small_business_plans
  AFTER INSERT OR UPDATE OR DELETE ON contracts.small_business_plans
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_contract_requests
  AFTER INSERT OR UPDATE OR DELETE ON contracts.contract_requests
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_approval_queue
  AFTER INSERT OR UPDATE OR DELETE ON contracts.approval_queue
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint
CREATE TRIGGER audit_communications_log
  AFTER INSERT OR UPDATE OR DELETE ON contracts.communications_log
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
--> statement-breakpoint

-- Make audit_log append-only: prevent DELETE operations
CREATE RULE audit_log_no_delete AS
  ON DELETE TO audit.audit_log
  DO INSTEAD NOTHING;
