const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'attendance-app.html', 'payroll.html', 'time-report.html'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

for (const file of htmlFiles) {
  const source = read(file);
  const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]);
  scripts.forEach((script) => new Function(script));

  for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(https?:|data:|#|javascript:)/.test(ref) || /\$\{|\s\+\s/.test(ref)) continue;
    const localPath = ref.split('?')[0];
    assert(fs.existsSync(path.join(root, localPath)), `${file}: missing local reference ${ref}`);
  }
}

new Function(read('sw.js'));
new Function(read('auth-helpers.js'));
assert(read('auth-helpers.js').includes('resetPasswordForEmail'), 'Auth helper must support secure password reset');
JSON.parse(read('manifest.json').replace(/^\uFEFF/, ''));

const attendance = read('attendance-app.html');
assert(!attendance.includes('`${location.origin}/index.html`'), 'Auth email redirects must preserve the deployed subdirectory');
assert(attendance.includes("new URL('index.html',location.href).href"), 'Auth email redirects should resolve index.html relative to the current app page');
for (const functionName of [
  'doLogin', 'doCheckin', 'doCheckout', 'doBreakStart', 'doBreakEnd',
  'submitLeave', 'loadReport', 'loadMonthly', 'changePin', 'loadMyPayslip',
  'exportMyPayslipPdf',
  'requestEmployeeAccount', 'inviteEmployeeAccount', 'disableEmployeeAccount',
  'enableEmployeeAccount',
]) {
  assert(new RegExp(`function\\s+${functionName}\\s*\\(`).test(attendance), `missing ${functionName}()`);
}
assert(attendance.includes(".eq('status','active')"), 'employee login must require active status');
assert(attendance.includes('LSMGAuth.signIn') && attendance.includes("['employee','hr','owner']"), 'attendance Auth login must validate linked roles');
assert(attendance.includes('requestAuthPasswordReset'), 'attendance must expose password reset');
assert(attendance.includes("functions.invoke('admin-user-management'"), 'attendance must use protected account management');
assert(attendance.includes("functions.invoke('attendance-admin'"), 'HR and Owner attendance corrections must use a protected Edge Function');
assert(attendance.includes('➕ เพิ่มเวลา') && attendance.includes('edit-att-employee-id'), 'Management must be able to request or create a missing attendance row');
assert(attendance.includes('pending_approval') && attendance.includes('openAttendanceRequests'), 'HR attendance corrections must wait for Owner approval');
assert(attendance.includes("id=\"admin-payroll-link\"") && attendance.includes("role==='owner'?'flex':'none'"), 'HR admin must not see the Payroll system link');
assert(attendance.includes("btnCheckout.style.display=hasCin&&!hasCout&&!inBreak?'flex':'none'"), 'checkout must be hidden while an employee is on break');
assert(attendance.includes('ยืนยันว่าจะเช็กเอาต์ก่อนเวลาจริงหรือไม่'), 'early checkout must require an explicit confirmation');
assert(attendance.includes("navigator.serviceWorker.register('sw.js?v=19')"), 'attendance changes must refresh the production service worker');
assert(attendance.includes('/functions/v1/employee-account-request'), 'employee must be able to request an Email account');
assert(attendance.includes('/functions/v1/pin-attendance'), 'PIN attendance must go through the protected Edge Function');
assert(attendance.includes("pinAttendanceRequest('leave_summary')"), 'PIN employees must load only their own leave summary through the Edge Function');
assert(attendance.includes("document.getElementById('nav-leave').style.display='flex'"), 'PIN employees must be able to open their own leave summary');
assert(attendance.includes("document.getElementById('nav-profile').style.display='flex'"), 'PIN employees must be able to open their own profile');
assert(attendance.includes("pinAttendanceRequest('update_profile_photo'"), 'PIN profile photos must use the protected Edge Function');
assert(attendance.includes('compressProfilePhoto'), 'profile photos must be resized before PIN upload');
assert(attendance.includes('profile-initials'), 'profile initials must not remove the photo element before first upload');
assert(attendance.includes("pinAttendanceRequest('change_pin'"), 'PIN changes must use the protected Edge Function');
assert(attendance.includes('normalizePinInput'), 'PIN login must normalize Thai and full-width digits');
assert(!attendance.includes(".eq('id',id).eq('pin',pin)"), 'PIN login must not query the employees table directly');
assert(!/if\s*\(user\.role===['"]owner['"]\)cleanupResigned\(\)/.test(attendance), 'resigned employee history must not be auto-deleted');
assert(attendance.includes('a.break_start') && attendance.includes('ออกพัก'), 'employee report must show break start');
assert(attendance.includes('a.break_end') && attendance.includes('กลับ'), 'employee report must show break end');
assert(attendance.includes("from('employee_work_patterns')"), 'attendance management must load employee weekly schedules');
assert(attendance.includes('empf-weekly-off-days') && attendance.includes('empf-schedule-effective'), 'employee form must configure effective-dated weekly days off');
assert(attendance.includes("badge='รอตั้งตาราง'"), 'daily report must not mark an unconfigured schedule as absent');
assert(attendance.includes("payroll_runs!inner(year_month,run_type,status,pay_date)"), 'employee payslip must load the finalized payroll run');
assert(attendance.includes('manual_income_adjustment') && attendance.includes('manual_deduction_adjustment'), 'employee payslip must include per-run payroll adjustments');
assert(attendance.includes('attendance_required===false') && attendance.includes('ยกเว้นลงเวลา'), 'attendance reports must support attendance-exempt owners');
assert(attendance.includes('payroll_eligible!==false'), 'attendance management must hide non-operational placeholder accounts');
assert(attendance.includes('openLeaveSummary()') && attendance.includes('สรุปวันลาสะสม'), 'Owner admin must expose accumulated leave summary');
assert(attendance.includes(".eq('status','approved')") && attendance.includes('leaveDaysInsideYear'), 'leave summary must count approved leave within the selected year');
assert(attendance.includes('id="leave-summary-employee"') && attendance.includes(".in('role',['employee','hr'])"), 'leave summary must select from the operational employee roster, including HR staff who work as employees');
assert(attendance.includes('const QUOTAS={sick:30,personal:6,vacation:6}'), 'annual personal and vacation leave quotas must both be six days');
assert(attendance.includes('vacationEligibleDate') && attendance.includes('leaveQuotaForDate'), 'vacation leave must require one full year of service');
assert(attendance.includes('สิทธิ์ที่เหลือสิ้นสุดวันที่ 31 ธันวาคมและไม่ทบไปปีถัดไป'), 'leave summary must explain calendar-year expiry');
for (const leaveType of ['row.sick','row.personal','row.vacation','row.unpaid']) {
  assert(attendance.includes(leaveType), `leave summary missing ${leaveType}`);
}
assert(attendance.includes('exportLeaveSummary()'), 'leave summary must support Excel export');
assert(attendance.includes('openDayOffSwapModal') && attendance.includes('สลับวันหยุดรายเดือน'), 'HR and Owner admin must expose monthly day-off swaps');
assert(attendance.includes("functions.invoke('schedule-admin'") && attendance.includes("action:'approve_month'"), 'day-off swaps must use the protected Edge Function and Owner monthly approval');
assert(attendance.includes("from('employee_day_off_swaps')") && attendance.includes('pendingSchedule'), 'daily report must distinguish pending day-off swaps from absence');

for (const [name,html] of [['attendance-app.html',attendance]]) {
  const inlineScripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(code=>code.trim());
  for (const code of inlineScripts) {
    try { new Function(code); }
    catch (error) { throw new Error(`${name} contains invalid inline JavaScript: ${error.message}`); }
  }
}

const report = read('time-report.html');
assert(report.includes('LSMGAuth.signIn') && report.includes("['hr','owner']"), 'time report must require HR or Owner Auth');
assert(report.includes('requestReportPasswordReset'), 'time report must expose password reset');
for (const label of ['<th>ออกพัก</th>', '<th>กลับเข้าทำงาน</th>', 'เวลาออกพัก:', 'เวลากลับเข้าทำงาน:']) {
  assert(report.includes(label), `time report missing ${label}`);
}
assert(report.includes('BREAK_LIMIT_MINUTES=60'), 'time report must enforce a 60-minute break warning threshold');
assert(report.includes('break-over') && report.includes('พักเกิน'), 'time report must highlight overlong breaks');
assert(!report.includes('break-over-note'), 'time report must not show the overlong-break duration inside the table');
assert(report.includes("from('employee_work_patterns')"), 'time report must use employee-specific weekly schedules');
assert(report.includes("status='unscheduled'"), 'time report must flag unconfigured schedules instead of false absence');
assert(report.includes("status='future'") && report.includes('ยังไม่ถึงวันทำงาน'), 'time report must not count future dates as absence');
assert(report.includes("status='exempt'") && report.includes('ยกเว้นลงเวลา'), 'time report must not require schedules for attendance-exempt owners');
assert(!report.includes('<th>รวมเวลา</th>') && !report.includes('รวมชั่วโมง:'), 'time report and Excel export must hide total work duration');
assert(!report.includes('isWeekend&&!shift'), 'time report must not infer weekly days off from weekends');
assert(report.includes("from('employee_day_off_swaps')") && report.includes("status='pending_swap'"), 'time report must apply approved swaps and hold pending swaps for review');

const payroll = read('payroll.html');
assert(payroll.includes('LSMGAuth.signIn') && payroll.includes("['owner']"), 'payroll login must require Owner Auth');
assert(payroll.includes('requestPayrollPasswordReset'), 'payroll must expose password reset');
for (const functionName of ['createRun', 'calcAndSaveItems', 'confirmRun', 'showPayslip', 'exportPayslipPdf', 'openPayrollAdjustment', 'savePayrollAdjustment', 'goPayrollHome']) {
  assert(new RegExp(`function\\s+${functionName}\\s*\\(`).test(payroll), `missing payroll ${functionName}()`);
}
assert(payroll.includes('manual_income_adjustment') && payroll.includes('manual_deduction_adjustment'), 'payroll must support per-run income and deduction adjustments');
assert(payroll.includes('eligibleEmployeesForRun'), 'payroll run must build a complete eligible employee roster');
assert(payroll.includes('getRunReadiness') && payroll.includes('missingSalary'), 'payroll must block runs when salary configuration is incomplete');
assert(payroll.includes('hasScheduleForPeriod') && payroll.includes('missingSchedule'), 'final payroll must require complete employee work schedules');
assert(payroll.includes('id="btn-create-run"') && payroll.includes('button.disabled=!readiness.ok'), 'payroll create button must reflect readiness');
assert(payroll.includes("db.from('employee_work_patterns').select('*').order('effective_from'"), 'payroll readiness must load employee schedules');
assert(payroll.includes('โหลดข้อมูล Payroll ไม่สำเร็จ'), 'payroll must surface database loading errors');
assert(payroll.includes('setPaymentStatus') && payroll.includes('advance_principal_paid'), 'payroll must track actual transfers per employee');
assert(payroll.includes(".eq('payment_status','paid')"), 'final payroll must deduct only confirmed paid advances');
assert(payroll.includes('employee.start_date<=tenureCutoff'), 'advance payroll must require one month of service');
assert(payroll.includes('employedDays/daysInMonth'), 'new employee salary must be prorated by employment days');
assert(payroll.includes('employee.payroll_eligible!==false'), 'payroll runs must exclude non-payroll placeholder accounts');
assert(payroll.includes("document.getElementById('sg-emp').textContent=visibleEmps.length"), 'payroll summary count must exclude Owners and other ineligible accounts');
assert(payroll.includes('employee.attendance_required===false'), 'payroll readiness must skip schedules for attendance-exempt owners');
assert(payroll.includes('aria-label="กลับหน้าหลัก PAYROLL LOEI SMART GROUP"'), 'payroll back control must return to payroll home');
assert(payroll.includes('pendingSwaps') && payroll.includes('refreshDayOffSwaps'), 'final payroll must block pending day-off swaps using fresh data');
assert(payroll.includes('isScheduledWorkDate(pattern,approvedSwaps'), 'payroll attendance totals must apply approved day-off swaps');

const adminUserFunction = read('supabase/functions/admin-user-management/index.ts');
assert(adminUserFunction.includes('["hr", "owner"]'), 'HR and Owner must be validated server-side');
assert(adminUserFunction.includes('ban_duration: "876000h"'), 'disabled Auth users must be banned server-side');

const employeeAccountFunction = read('supabase/functions/employee-account-request/index.ts');
assert(employeeAccountFunction.includes('employee_account_request_failed'), 'employee account requests must be rate limited and audited');
assert(employeeAccountFunction.includes('account_request_status: "pending"'), 'employee account requests must stay pending for approval');

const pinAttendanceFunction = read('supabase/functions/pin-attendance/index.ts');
for (const action of ['list_employees', 'leave_summary', 'submit_leave', 'update_profile_photo', 'change_pin', 'check_in', 'break_start', 'break_end', 'check_out']) {
  assert(pinAttendanceFunction.includes(`action === "${action}"`), `PIN attendance missing ${action}`);
}
assert(pinAttendanceFunction.includes('pin_attendance_auth_failed'), 'PIN attendance must rate limit and audit failed PINs');
assert(pinAttendanceFunction.includes('.in("role", ["employee", "hr"])'), 'attendance-required HR staff must appear in the PIN employee list');
assert(pinAttendanceFunction.includes('["employee", "hr"].includes(employee.role)'), 'attendance-required HR staff must be allowed to authenticate by PIN');
assert(pinAttendanceFunction.includes('.eq("resolved", false)') && pinAttendanceFunction.includes('existingAlert'), 'PIN attendance must deduplicate unresolved device alerts');
assert(pinAttendanceFunction.includes('normalizePin'), 'PIN Edge Function must normalize Thai and full-width digits');
assert(pinAttendanceFunction.includes('start_date: employee.start_date'), 'PIN employees need their start date for vacation eligibility');
assert(pinAttendanceFunction.includes('.eq("employee_id", employee.id)'), 'PIN leave summary must be scoped to the authenticated employee');
assert(pinAttendanceFunction.includes('new Date().toISOString()'), 'attendance timestamps must be generated server-side');
assert(pinAttendanceFunction.includes('distanceMeters'), 'attendance GPS must be verified server-side');
assert(pinAttendanceFunction.includes('decodeProfilePhoto'), 'PIN profile photos must validate MIME type, signature and size server-side');
assert(pinAttendanceFunction.includes('pin_profile_photo_updated'), 'PIN profile photo updates must be audited');
assert(pinAttendanceFunction.includes('กรุณากดกลับเข้าทำงานก่อนเช็กเอาต์'), 'PIN checkout must be blocked during an open break');
assert(pinAttendanceFunction.includes('early_checkout_confirmed'), 'PIN early checkout must require server-side confirmation');
assert(pinAttendanceFunction.includes('pin_attendance_early_checkout'), 'confirmed early checkout must be audited');

const attendanceAdminFunction = read('supabase/functions/attendance-admin/index.ts');
assert(attendanceAdminFunction.includes('["hr", "owner"].includes(actor.role)'), 'attendance requests must validate HR or Owner server-side');
assert(attendanceAdminFunction.includes('actor.role !== "owner"') && attendanceAdminFunction.includes('review_request'), 'attendance approval must require Owner server-side');
assert(attendanceAdminFunction.includes('attendance_change_requested'), 'HR attendance requests must be audited');
assert(attendanceAdminFunction.includes('attendance_change_approved'), 'Owner attendance approvals must be audited');
assert(attendanceAdminFunction.includes('attendance_manual_created'), 'manual attendance creation must be audited');
assert(attendanceAdminFunction.includes('attendance_manual_updated'), 'manual attendance updates must be audited');
assert(attendanceAdminFunction.includes('"owner_manual"') && attendanceAdminFunction.includes('"hr_request_approved"'), 'manual attendance rows must record whether Owner or approved HR initiated them');

const stage2 = read('supabase/migrations/20260715113847_stage2_enforce_authenticated_rls.sql');
assert(stage2.includes('to authenticated'), 'Stage 2 policies must target authenticated users');
assert(stage2.includes('drop policy if exists allow_all_attendance'), 'Stage 2 must remove legacy anonymous attendance access');
assert(stage2.includes('protect_employee_attendance_fields'), 'Stage 2 must protect employee attendance transitions');
assert(stage2.includes("new.work_date := event_date") && stage2.includes("new.check_in := event_time"), 'Stage 2 must generate employee attendance dates and times in the database');
assert(stage2.includes("new.ot_minutes := case"), 'Stage 2 must calculate employee OT in the database');
assert(read('supabase/migrations/20260715154500_attendance_daily_uniqueness.sql').includes('unique index'), 'attendance must prevent duplicate daily rows');

const schedulePayrollMigration = read('supabase/migrations/20260716090000_weekly_schedules_payroll_adjustments.sql');
assert(schedulePayrollMigration.includes('create table if not exists public.employee_work_patterns'), 'weekly schedule table migration is required');
assert(schedulePayrollMigration.includes('payroll_item_adjustment_log'), 'payroll adjustment audit log is required');
assert(schedulePayrollMigration.includes('drop policy if exists allow_all_items'), 'legacy public payroll access must be removed');
assert(schedulePayrollMigration.includes('An adjustment reason is required'), 'payroll adjustment reason must be enforced in the database');

const payslipAccessMigration = read('supabase/migrations/20260716103000_tighten_schedule_policies_and_payslip_access.sql');
assert(payslipAccessMigration.includes('payroll_runs_select_finalized_staff'), 'employees need finalized payroll-run metadata for their own payslip');
assert(payslipAccessMigration.includes('employee_work_patterns_created_by_idx'), 'weekly schedule creator foreign key must be indexed');
assert(!payslipAccessMigration.includes('for all to authenticated'), 'management writes must not create duplicate SELECT policies');
assert(read('supabase/migrations/20260716111500_payroll_foreign_key_indexes.sql').includes('payroll_items_employee_id_idx'), 'payroll foreign keys must have covering indexes');
const reportReadMigration = read('supabase/migrations/20260716140000_authenticated_report_reads.sql');
assert(reportReadMigration.includes('attendance_select_self_or_management'), 'authenticated attendance reports need self/management read policy');
assert(reportReadMigration.includes('leave_requests_select_self_or_management'), 'authenticated leave reports need self/management read policy');
const payrollIntegrityMigration = read('supabase/migrations/20260716153000_payroll_run_integrity.sql');
assert(payrollIntegrityMigration.includes('payroll_runs_month_type_uidx'), 'duplicate payroll runs must be prevented');
assert(payrollIntegrityMigration.includes('Payroll employee roster is incomplete'), 'empty or incomplete payroll runs must not be confirmed');
assert(payrollIntegrityMigration.includes('A confirmed or paid payroll run is locked'), 'finalized payroll runs must be immutable');
const payrollPaymentMigration = read('supabase/migrations/20260716163000_payroll_payment_tracking.sql');
assert(payrollPaymentMigration.includes("payment_status in ('pending', 'paid', 'cancelled')"), 'payroll payment status must be constrained');
assert(payrollPaymentMigration.includes('payroll_payment_status_log'), 'payroll payment changes must be audited');
assert(payrollPaymentMigration.includes('advance_principal_paid'), 'paid advance principal must be tracked separately from bonuses');
assert(payrollPaymentMigration.includes("least(4000, old.net_pay - old.manual_income_adjustment)"), 'bonus income must not be deducted at final payroll');
assert(payrollPaymentMigration.includes("run_pay_date - interval '1 month'"), 'advance eligibility must require one month of service');
const payrollPaymentIndexes = read('supabase/migrations/20260716164500_payroll_payment_log_indexes.sql');
assert(payrollPaymentIndexes.includes('payroll_payment_status_log_auth_user_idx'), 'payment audit auth user foreign key must be indexed');
assert(payrollPaymentIndexes.includes('payroll_payment_status_log_changed_employee_idx'), 'payment audit employee foreign key must be indexed');
const employeeScopeMigration = read('supabase/migrations/20260716173000_employee_payroll_attendance_scope.sql');
assert(employeeScopeMigration.includes('payroll_eligible boolean') && employeeScopeMigration.includes('attendance_required boolean'), 'employee operational scope fields are required');
assert(employeeScopeMigration.includes("name='HR'") && employeeScopeMigration.includes('payroll_eligible=false'), 'placeholder HR must be excluded from payroll');
assert(employeeScopeMigration.includes("role='owner'") && employeeScopeMigration.includes('attendance_required=false'), 'owners must be attendance-exempt');
assert(employeeScopeMigration.includes("resigned_at=date '2026-07-16'"), 'Ice resignation date must be recorded');
const ownerScopeMigration = read('supabase/migrations/20260721084000_exclude_owner_from_payroll.sql');
assert(ownerScopeMigration.includes("where role = 'owner'") && ownerScopeMigration.includes('payroll_eligible = false'), 'owners must be excluded from future payroll rosters');
assert(ownerScopeMigration.includes('employees_enforce_owner_operational_scope'), 'new or edited Owner accounts must remain outside payroll and attendance');

const dayOffSwapMigration = read('supabase/migrations/20260721062425_monthly_day_off_approval.sql');
assert(dayOffSwapMigration.includes('create table if not exists public.employee_day_off_swaps'), 'monthly day-off swaps need a dedicated table');
assert(dayOffSwapMigration.includes('employee_day_off_swaps_select_management'), 'day-off swap reads must be restricted to management');
assert(dayOffSwapMigration.includes('block_final_payroll_with_pending_day_off_swaps'), 'database must block final payroll while swaps are pending');
assert(dayOffSwapMigration.includes('revoke insert, update, delete') && dayOffSwapMigration.includes('from authenticated'), 'day-off swap writes must be denied directly to clients');
assert(read('supabase/migrations/20260721084500_index_day_off_swap_shift.sql').includes('employee_day_off_swaps_shift_id_idx'), 'day-off swap shift foreign key must have a covering index');

const scheduleAdminFunction = read('supabase/functions/schedule-admin/index.ts');
assert(scheduleAdminFunction.includes('["hr", "owner"].includes(actor.role)'), 'day-off swap requests must validate HR or Owner server-side');
assert(scheduleAdminFunction.includes('actor.role !== "owner"') && scheduleAdminFunction.includes('body.action === "approve_month"'), 'day-off swap final approval must require Owner server-side');
for (const action of ['create_swap', 'approve_month', 'cancel_swap']) {
  assert(scheduleAdminFunction.includes(`body.action === "${action}"`), `schedule admin missing ${action}`);
}
assert(scheduleAdminFunction.includes('day_off_swap_month_approved'), 'monthly day-off approval must be audited');
const hrApprovalMigration = read('supabase/migrations/20260722110000_hr_attendance_approval.sql');
assert(hrApprovalMigration.includes('create table if not exists public.attendance_change_requests'), 'HR attendance changes need a dedicated approval table');
assert(hrApprovalMigration.includes('attendance_change_requests_select_authorized'), 'attendance change requests need scoped RLS reads');
assert(hrApprovalMigration.includes('block_final_payroll_with_pending_attendance_changes'), 'final payroll must block pending attendance changes');
assert(hrApprovalMigration.includes("private.current_employee_role()) = 'hr'") && hrApprovalMigration.includes("role = 'employee'"), 'HR must only update employee-role records');
const annualLeaveMigration = read('supabase/migrations/20260722111937_enforce_annual_leave_policy.sql');
assert(annualLeaveMigration.includes('annual_quota integer := 6'), 'database must enforce six-day personal and vacation quotas');
assert(annualLeaveMigration.includes('leave_requests_employee_type_status_start_idx'), 'annual leave lookups and the employee foreign key must have a covering index');
assert(annualLeaveMigration.includes("employee_start_date + interval '1 year'"), 'database must enforce one-year vacation eligibility');
assert(annualLeaveMigration.includes("extract(year from new.end_date)") && annualLeaveMigration.includes('แยกคำขอตามปีปฏิทิน'), 'database must prevent annual leave from crossing calendar years');
assert(annualLeaveMigration.includes("coalesce(actor_role, '') <> 'owner'") && annualLeaveMigration.includes('before insert or update or delete'), 'only Owner may make or revoke final leave decisions');
assert(read('sw.js').includes("lsg-attendance-v18"), 'production cache version must be refreshed');

console.log('Static validation passed');
