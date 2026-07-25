-- Half-day leave support for LOEI SMART GROUP.
-- Leave requests may now record 0.5 days. The days column and the annual-leave
-- quota trigger must therefore use numeric arithmetic instead of integers, so a
-- half day is never rounded away when summing personal/vacation entitlements.

-- 1) Store fractional leave days (0.5). No-op if already numeric.
alter table public.leave_requests
  alter column days type numeric using days::numeric;

-- 2) Recreate the quota trigger with numeric totals so half days sum correctly.
create or replace function private.enforce_annual_leave_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_role text;
  leave_year integer;
  employee_start_date date;
  eligible_from date;
  annual_quota integer := 6;
  other_approved_days numeric := 0;
  previous_target_total numeric := 0;
  candidate_total numeric := 0;
  final_state_changed boolean := false;
  approved_fields_changed boolean := false;
begin
  actor_role := private.current_employee_role();

  if tg_op = 'DELETE' then
    if (select auth.uid()) is not null
       and coalesce(actor_role, '') <> 'owner'
       and old.status in ('approved', 'rejected') then
      raise exception using
        errcode = 'P0001',
        message = 'เฉพาะ Owner เท่านั้นที่ลบรายการซึ่งตัดสินผลแล้วได้';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    final_state_changed := new.status in ('approved', 'rejected');
  else
    approved_fields_changed :=
      new.employee_id is distinct from old.employee_id
      or new.leave_type is distinct from old.leave_type
      or new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date
      or new.days is distinct from old.days
      or new.reason is distinct from old.reason
      or new.approved_by is distinct from old.approved_by;

    final_state_changed :=
      (new.status is distinct from old.status
        and (new.status in ('approved', 'rejected') or old.status in ('approved', 'rejected')))
      or (approved_fields_changed and old.status in ('approved', 'rejected'));
  end if;

  -- Authenticated HR may acknowledge and prepare requests, but only Owner can
  -- create, change, or revoke a final decision. Service-side maintenance has no auth.uid().
  if (select auth.uid()) is not null
     and coalesce(actor_role, '') <> 'owner'
     and final_state_changed then
    raise exception using
      errcode = 'P0001',
      message = 'เฉพาะ Owner เท่านั้นที่อนุมัติหรือแก้ไขผลอนุมัติวันลาได้';
  end if;

  if new.status <> 'approved' or new.leave_type not in ('personal', 'vacation') then
    return new;
  end if;

  if new.employee_id is null or new.start_date is null or new.end_date is null
     or new.days is null or new.days <= 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ข้อมูลวันลาไม่ครบหรือจำนวนวันลาไม่ถูกต้อง';
  end if;

  if new.end_date < new.start_date then
    raise exception using
      errcode = 'P0001',
      message = 'วันสิ้นสุดการลาต้องไม่น้อยกว่าวันเริ่มลา';
  end if;

  leave_year := extract(year from new.start_date)::integer;
  if extract(year from new.end_date)::integer <> leave_year then
    raise exception using
      errcode = 'P0001',
      message = 'ลากิจและลาพักร้อนต้องแยกคำขอตามปีปฏิทิน';
  end if;

  if new.leave_type = 'vacation' then
    select employee.start_date
      into employee_start_date
    from public.employees employee
    where employee.id = new.employee_id;

    if employee_start_date is null then
      raise exception using
        errcode = 'P0001',
        message = 'ไม่พบวันเริ่มงาน จึงยังอนุมัติลาพักร้อนไม่ได้';
    end if;

    eligible_from := (employee_start_date + interval '1 year')::date;
    if new.start_date < eligible_from then
      raise exception using
        errcode = 'P0001',
        message = format('ลาพักร้อนได้ตั้งแต่ %s หลังทำงานครบ 1 ปี', to_char(eligible_from, 'YYYY-MM-DD'));
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      format('annual-leave:%s:%s:%s', new.employee_id, new.leave_type, leave_year),
      0
    )
  );

  select coalesce(sum(request.days), 0)::numeric
    into other_approved_days
  from public.leave_requests request
  where request.employee_id = new.employee_id
    and request.leave_type = new.leave_type
    and request.status = 'approved'
    and request.start_date >= pg_catalog.make_date(leave_year, 1, 1)
    and request.start_date < pg_catalog.make_date(leave_year + 1, 1, 1)
    and request.id is distinct from new.id;

  previous_target_total := other_approved_days;
  if tg_op = 'UPDATE'
     and old.status = 'approved'
     and old.employee_id = new.employee_id
     and old.leave_type = new.leave_type
     and extract(year from old.start_date)::integer = leave_year then
    previous_target_total := previous_target_total + coalesce(old.days, 0);
  end if;

  candidate_total := other_approved_days + new.days;

  -- Preserve existing historical over-quota records, but never allow a new
  -- approval or edit to increase the excess.
  if candidate_total > annual_quota and candidate_total > previous_target_total then
    raise exception using
      errcode = 'P0001',
      message = format(
        '%sปี %s ใช้ได้ไม่เกิน %s วัน (อนุมัติแล้ว %s วัน ขอเพิ่ม %s วัน)',
        case when new.leave_type = 'personal' then 'ลากิจ' else 'ลาพักร้อน' end,
        leave_year + 543,
        annual_quota,
        other_approved_days,
        new.days
      );
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_annual_leave_policy() from public, anon, authenticated;

drop trigger if exists enforce_annual_leave_policy on public.leave_requests;
create trigger enforce_annual_leave_policy
before insert or update or delete on public.leave_requests
for each row execute function private.enforce_annual_leave_policy();

comment on function private.enforce_annual_leave_policy() is
  'Enforces Owner final approval, six-day annual personal/vacation quotas (numeric, half-day aware), one-year vacation eligibility, and calendar-year expiry.';
