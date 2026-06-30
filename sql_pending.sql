-- ============================================================
-- LSMG Attendance System — SQL Scripts งานค้าง
-- รัน script นี้ใน Supabase SQL Editor
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- งาน #1: เพิ่มคอลัมน์ audit trail ในตาราง attendance
-- ──────────────────────────────────────────────────────────
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS edited_by  UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS edit_note  TEXT,
  ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source     TEXT DEFAULT 'app';
  -- source: 'app' | 'excel_import' | 'manual_edit'

-- ──────────────────────────────────────────────────────────
-- งาน #2: RLS + Policy ตาราง announcements
-- ──────────────────────────────────────────────────────────

-- เปิด RLS
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- ทุกคนที่ login แล้วอ่านได้
CREATE POLICY "announcements_select_all"
  ON announcements FOR SELECT
  USING (auth.role() = 'authenticated');

-- เฉพาะ owner และ hr เท่านั้น insert/update/delete
CREATE POLICY "announcements_write_hr_owner"
  ON announcements FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND role IN ('owner', 'hr')
    )
  );

-- ──────────────────────────────────────────────────────────
-- งาน Payroll Phase: สร้างตารางระบบเงินเดือน
-- ──────────────────────────────────────────────────────────

-- ตารางข้อมูลเงินเดือนรายคน
CREATE TABLE IF NOT EXISTS employee_salary (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  base_salary     NUMERIC(10,2) NOT NULL DEFAULT 0,   -- เงินเดือนพื้นฐาน
  position_pay    NUMERIC(10,2) DEFAULT 0,             -- ค่าตำแหน่ง
  driving_license BOOLEAN DEFAULT FALSE,               -- สวัสดิการค่าใบขับขี่
  license_pay     NUMERIC(10,2) DEFAULT 0,             -- จำนวนเงินค่าใบขับขี่
  commission_type TEXT DEFAULT 'none',                 -- 'none' | 'fixed' | 'percent'
  commission_value NUMERIC(10,2) DEFAULT 0,            -- จำนวน/เปอร์เซ็นต์
  effective_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  other_pay       NUMERIC(10,2) DEFAULT 0,   -- เงินเพิ่มอื่นๆ
  other_desc      TEXT,                       -- ชื่อรายการเงินเพิ่มอื่นๆ
  UNIQUE(employee_id)
);

-- ถ้าสร้างตาราง employee_salary ไปแล้ว ให้รัน ALTER นี้แทน
ALTER TABLE employee_salary
  ADD COLUMN IF NOT EXISTS other_pay    NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_desc   TEXT,
  ADD COLUMN IF NOT EXISTS other_deduct NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deduct_desc TEXT;

-- ตารางรอบการจ่ายเงินเดือน
CREATE TABLE IF NOT EXISTS payroll_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month      CHAR(7) NOT NULL,                    -- '2026-06'
  run_type        TEXT NOT NULL,                       -- 'advance' (15th) | 'final' (30th)
  pay_date        DATE NOT NULL,
  ot_period_start DATE,                                -- OT รอบ: วันที่ 21 เดือนก่อน
  ot_period_end   DATE,                                -- ถึง วันที่ 20 เดือนนี้
  status          TEXT DEFAULT 'draft',                -- 'draft' | 'confirmed' | 'paid'
  created_by      UUID REFERENCES employees(id),
  confirmed_at    TIMESTAMPTZ,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ตารางรายการเงินเดือนแต่ละคน (payslip)
CREATE TABLE IF NOT EXISTS payroll_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id      UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES employees(id),
  -- รายรับ
  base_salary         NUMERIC(10,2) DEFAULT 0,
  position_pay        NUMERIC(10,2) DEFAULT 0,
  license_pay         NUMERIC(10,2) DEFAULT 0,
  commission          NUMERIC(10,2) DEFAULT 0,
  bonus_attendance    NUMERIC(10,2) DEFAULT 0,         -- เบี้ยขยัน
  ot_pay              NUMERIC(10,2) DEFAULT 0,
  advance_paid        NUMERIC(10,2) DEFAULT 0,         -- เงินจ่ายรอบ 1 (รอบ advance)
  other_income        NUMERIC(10,2) DEFAULT 0,
  -- รายหัก
  social_security     NUMERIC(10,2) DEFAULT 0,         -- ประกันสังคม
  advance_deduct      NUMERIC(10,2) DEFAULT 0,         -- เงินเบิกกลางเดือน
  other_deduct        NUMERIC(10,2) DEFAULT 0,
  tax                 NUMERIC(10,2) DEFAULT 0,
  -- สรุป
  gross_pay           NUMERIC(10,2) DEFAULT 0,
  total_deduct        NUMERIC(10,2) DEFAULT 0,
  net_pay             NUMERIC(10,2) DEFAULT 0,
  -- ข้อมูลประกอบ
  work_days           INT DEFAULT 0,                   -- วันทำงาน
  total_days_in_month INT DEFAULT 0,                   -- วันทำงานในเดือน
  late_count          INT DEFAULT 0,
  absent_count        INT DEFAULT 0,
  ot_minutes          INT DEFAULT 0,
  note                TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ตารางเงินเบิกกลางเดือน
CREATE TABLE IF NOT EXISTS salary_advances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id),
  amount        NUMERIC(10,2) NOT NULL,
  advance_date  DATE NOT NULL,
  year_month    CHAR(7) NOT NULL,                      -- จะหักรอบไหน
  note          TEXT,
  approved_by   UUID REFERENCES employees(id),
  status        TEXT DEFAULT 'pending',                -- 'pending' | 'approved' | 'rejected'
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS สำหรับตารางใหม่
ALTER TABLE employee_salary   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_advances   ENABLE ROW LEVEL SECURITY;

-- employee_salary: เจ้าของเท่านั้นที่เห็นและแก้ไขได้
-- (HR เห็นได้เฉพาะของตัวเอง เพื่อใช้ในการคำนวณ payslip ตัวเอง)
CREATE POLICY "emp_salary_select" ON employee_salary FOR SELECT
  USING (
    employee_id = auth.uid()   -- พนักงานเห็นเฉพาะข้อมูลตัวเอง
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'owner')
  );
CREATE POLICY "emp_salary_write"  ON employee_salary FOR ALL
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'owner'));

-- payroll: อ่านได้ทุกคน (payslip ตัวเอง), จัดการได้เฉพาะ owner/hr
CREATE POLICY "payroll_runs_select"  ON payroll_runs FOR SELECT USING (true);
CREATE POLICY "payroll_runs_write"   ON payroll_runs FOR ALL
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('owner','hr')));

CREATE POLICY "payroll_items_select" ON payroll_items FOR SELECT
  USING (employee_id = auth.uid() OR
         EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('owner','hr')));
CREATE POLICY "payroll_items_write"  ON payroll_items FOR ALL
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('owner','hr')));

CREATE POLICY "advances_select" ON salary_advances FOR SELECT
  USING (employee_id = auth.uid() OR
         EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('owner','hr')));
CREATE POLICY "advances_write"  ON salary_advances FOR ALL
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('owner','hr')));
