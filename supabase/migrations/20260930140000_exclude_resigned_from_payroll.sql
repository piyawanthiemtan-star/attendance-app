-- พนักงานที่กดลาออกแล้ว (status = 'resigned') ไม่เข้ารอบเงินเดือนเลย ทั้งเบิกล่วงหน้าและสิ้นเดือน
-- [Owner เคาะ 30 ก.ย. 2569] ค่าจ้างค้างของคนลาออก Owner/HR จัดการนอกระบบเอง
-- ให้ตัวตรวจตอนยืนยันรอบ (guard_payroll_run_integrity) ใช้กติกาเดียวกับหน้า payroll.html (inPayroll)
-- ไม่แตะรอบที่ยืนยัน/จ่ายไปแล้ว — ฟังก์ชันนี้ใช้ตอนเปลี่ยน draft -> confirmed เท่านั้น
create or replace function private.employee_eligible_for_payroll_run(
  employee_row public.employees,
  run_month character,
  run_type_value text,
  run_pay_date date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(employee_row.payroll_eligible,true)
    and coalesce(employee_row.status,'active') <> 'resigned'
    and case
    when run_type_value = 'advance' then
      (employee_row.start_date is null or employee_row.start_date <= (run_pay_date - interval '1 month')::date)
      and (employee_row.resigned_at is null or employee_row.resigned_at >= run_pay_date)
    else
      (employee_row.start_date is null or employee_row.start_date <= (to_date(trim(run_month) || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date)
      and (employee_row.resigned_at is null or employee_row.resigned_at >= to_date(trim(run_month) || '-01', 'YYYY-MM-DD'))
  end;
$$;
revoke all on function private.employee_eligible_for_payroll_run(public.employees, character, text, date)
from public, anon, authenticated;
