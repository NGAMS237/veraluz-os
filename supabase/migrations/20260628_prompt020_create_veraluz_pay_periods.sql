-- VERALUZ PROMPT 020 — veraluz_pay_periods
-- Migration appliquée via Supabase MCP le 2026-06-28
CREATE TABLE IF NOT EXISTS veraluz_pay_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total_gross NUMERIC(12,2) DEFAULT 0,
  total_net NUMERIC(12,2) DEFAULT 0,
  total_cnps_employee NUMERIC(12,2) DEFAULT 0,
  total_cnps_employer NUMERIC(12,2) DEFAULT 0,
  total_irpp NUMERIC(12,2) DEFAULT 0,
  employee_count INTEGER DEFAULT 0,
  created_by TEXT, calculated_by TEXT, calculated_at TIMESTAMPTZ,
  validated_by_manager TEXT, validated_by_manager_at TIMESTAMPTZ,
  validated_by_owner TEXT, validated_by_owner_at TIMESTAMPTZ,
  paid_by TEXT, paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pay_periods_status     ON veraluz_pay_periods(status);
CREATE INDEX IF NOT EXISTS idx_pay_periods_start_date ON veraluz_pay_periods(start_date);
CREATE INDEX IF NOT EXISTS idx_pay_periods_end_date   ON veraluz_pay_periods(end_date);
