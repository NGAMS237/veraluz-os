-- VERALUZ PROMPT 020 — veraluz_payroll_adjustments
-- Migration appliquée via Supabase MCP le 2026-06-28
CREATE TABLE IF NOT EXISTS veraluz_payroll_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id UUID REFERENCES veraluz_pay_periods(id) ON DELETE SET NULL,
  employee_id TEXT NOT NULL,
  adjustment_type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT, approved_by TEXT, approved_at TIMESTAMPTZ, applied_at TIMESTAMPTZ,
  source_table TEXT, source_record_id TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_adj_period   ON veraluz_payroll_adjustments(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adj_employee ON veraluz_payroll_adjustments(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adj_status   ON veraluz_payroll_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_payroll_adj_type     ON veraluz_payroll_adjustments(adjustment_type);
