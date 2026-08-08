-- VERALUZ PROMPT 020 — veraluz_payroll_items
-- Migration appliquée via Supabase MCP le 2026-06-28
CREATE TABLE IF NOT EXISTS veraluz_payroll_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id UUID REFERENCES veraluz_pay_periods(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  employee_name_snapshot TEXT NOT NULL,
  role_snapshot TEXT, team_snapshot TEXT,
  base_salary NUMERIC(12,2) DEFAULT 0,
  days_worked NUMERIC(6,2) DEFAULT 0, hours_worked NUMERIC(8,2) DEFAULT 0,
  overtime_amount NUMERIC(12,2) DEFAULT 0,
  bonus_amount NUMERIC(12,2) DEFAULT 0,
  advance_amount NUMERIC(12,2) DEFAULT 0,
  deduction_amount NUMERIC(12,2) DEFAULT 0,
  transport_allowance NUMERIC(12,2) DEFAULT 0,
  other_allowance NUMERIC(12,2) DEFAULT 0,
  gross_amount NUMERIC(12,2) DEFAULT 0,
  cnps_employee NUMERIC(12,2) DEFAULT 0, cnps_employer NUMERIC(12,2) DEFAULT 0,
  irpp NUMERIC(12,2) DEFAULT 0, taxable_income NUMERIC(12,2) DEFAULT 0,
  net_amount NUMERIC(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  anomaly_flags JSONB DEFAULT '[]'::jsonb, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pay_period_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_items_period   ON veraluz_payroll_items(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_employee ON veraluz_payroll_items(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_status   ON veraluz_payroll_items(status);
