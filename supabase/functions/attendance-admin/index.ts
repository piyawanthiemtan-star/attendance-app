import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00+07:00`));

const normalizeTime = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const time = String(value).trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time) ? time : undefined;
};

const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const bangkokToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const bangkokTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

const attendanceSnapshot = (attendance: Record<string, unknown> | null) =>
  attendance
    ? {
      id: attendance.id,
      check_in: attendance.check_in,
      check_out: attendance.check_out,
      break_start: attendance.break_start,
      break_end: attendance.break_end,
      shift_id: attendance.shift_id,
      branch_id: attendance.branch_id,
    }
    : null;

const snapshotMatches = (
  snapshot: Record<string, unknown> | null,
  attendance: Record<string, unknown> | null,
) => {
  if (!snapshot || !attendance) return snapshot === null && attendance === null;
  return ["id", "check_in", "check_out", "break_start", "break_end", "shift_id", "branch_id"]
    .every((field) => (snapshot[field] ?? null) === (attendance[field] ?? null));
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: "Server configuration error" });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Unauthorized" });

  const { data: actor, error: actorError } = await admin
    .from("employees")
    .select("id, role, status, access_disabled_at")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (
    actorError || !actor || !["hr", "owner"].includes(actor.role) ||
    actor.status !== "active" || actor.access_disabled_at
  ) {
    return json(403, { error: "HR or Owner access required" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const audit = async (
    action: string,
    targetEmployeeId: string | null,
    details: Record<string, unknown>,
  ) =>
    await admin.from("security_audit_log").insert({
      actor_auth_user_id: userData.user.id,
      actor_employee_id: actor.id,
      target_employee_id: targetEmployeeId,
      action,
      details,
      user_agent: req.headers.get("user-agent"),
    });

  const finalPayrollIsLocked = async (workDate: string) => {
    const { data, error } = await admin
      .from("payroll_runs")
      .select("id")
      .eq("year_month", workDate.slice(0, 7))
      .eq("run_type", "final")
      .in("status", ["confirmed", "paid"])
      .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  };

  const loadEmployeeAndAttendance = async (employeeId: string, workDate: string) => {
    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .select("id, name, status, start_date, resigned_at, shift_id, branch_id, attendance_required")
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeError || !employee) return { response: json(404, { error: "ไม่พบพนักงาน" }) };
    if (employee.attendance_required === false) {
      return { response: json(400, { error: "พนักงานรายนี้ไม่บังคับลงเวลา" }) };
    }
    if (employee.start_date && workDate < employee.start_date) {
      return { response: json(400, { error: "วันที่เลือกอยู่ก่อนวันเริ่มงาน" }) };
    }
    if (employee.resigned_at && workDate > employee.resigned_at) {
      return { response: json(400, { error: "วันที่เลือกอยู่หลังวันลาออก" }) };
    }

    const { data: existing, error: existingError } = await admin
      .from("attendance")
      .select("*")
      .eq("employee_id", employee.id)
      .eq("work_date", workDate)
      .maybeSingle();
    if (existingError) return { response: json(500, { error: "ตรวจรายการเวลาไม่สำเร็จ" }) };
    return { employee, existing };
  };

  const buildAttendanceValues = async (
    employee: Record<string, unknown>,
    existing: Record<string, unknown> | null,
    workDate: string,
    checkInIso: string,
    checkOutIso: string | null,
    reason: string,
    overrideShiftId?: string | null,
  ) => {
    const checkInMs = Date.parse(checkInIso);
    const checkOutMs = checkOutIso ? Date.parse(checkOutIso) : null;
    if (existing?.break_start && checkInMs > Date.parse(String(existing.break_start))) {
      return { response: json(400, { error: "เวลาเข้าต้องไม่ช้ากว่าเวลาออกพักเดิม" }) };
    }
    if (existing?.break_end && checkOutMs !== null && checkOutMs < Date.parse(String(existing.break_end))) {
      return { response: json(400, { error: "เวลาออกต้องไม่เร็วกว่าเวลากลับจากพักเดิม" }) };
    }

    const shiftId = isUuid(overrideShiftId) ? overrideShiftId : (existing?.shift_id ?? employee.shift_id ?? null);
    const branchId = existing?.branch_id ?? employee.branch_id ?? null;
    const checkIn = bangkokTime(checkInIso);
    const checkOut = checkOutIso ? bangkokTime(checkOutIso) : null;
    let lateMinutes = 0;
    let otMinutes = 0;
    if (shiftId) {
      const { data: shift } = await admin
        .from("shifts")
        .select("check_in_time, check_out_time")
        .eq("id", shiftId)
        .maybeSingle();
      if (shift?.check_in_time) {
        lateMinutes = Math.max(0, timeToMinutes(checkIn) - timeToMinutes(String(shift.check_in_time).slice(0, 5)));
      }
      if (checkOut && shift?.check_out_time && shift?.check_in_time) {
        // OT = เวลาทำงานจริง (ออก-เข้า) - ความยาวกะ (เลิก-เริ่ม) นับ >= 40 นาที
        // มาเช้าแทนคนก็ได้ OT / มาสายก็ถูกหักในตัว
        // OT cap = เวลาปิดของสาขา + 20 นาทีเคลียร้าน (ฝนปิดเพ็ทช็อป 21:00, คนอื่น 20:00)
        const OT_CAP_MIN =
          (branchId === "dc38e18a-d7d3-40b5-96aa-d53d1e602c35" && employee.id === "102bf977-3554-423f-b481-88e084c53dbb") ? 21 * 60 + 20 // เพ็ทช็อป-ฝน: ปิด 21:00
          : branchId === "dc38e18a-d7d3-40b5-96aa-d53d1e602c35" ? 20 * 60 + 20 // เพ็ทช็อป-คนอื่น: ปิด 20:00
          : branchId === "9bc1090c-9585-4b4d-9a27-029999eee73a" ? 20 * 60 + 20 // โกดัง: ปิด 20:00
          : branchId === "a139c49b-4dc4-44b2-8507-f5a89b61c6d1" ? 19 * 60 + 50 // เมืองเลยสมาร์ทโฟน: ปิด 19:30
          : 20 * 60 + 20; // ไม่ทราบสาขา: default 20:00
        const worked = Math.min(timeToMinutes(checkOut), OT_CAP_MIN) - timeToMinutes(checkIn);
        const shiftLen = timeToMinutes(String(shift.check_out_time).slice(0, 5)) - timeToMinutes(String(shift.check_in_time).slice(0, 5));
        const extra = worked - shiftLen;
        if (extra >= 40) otMinutes = extra;
      }
    }

    return {
      values: {
        check_in: checkInIso,
        check_out: checkOutIso,
        shift_id: shiftId,
        branch_id: branchId,
        ot_minutes: otMinutes,
        is_late: lateMinutes > 5,
        late_minutes: lateMinutes,
        edited_by: actor.id,
        edit_note: reason,
        edited_at: new Date().toISOString(),
      },
    };
  };

  const applyAttendance = async (
    employee: Record<string, unknown>,
    existing: Record<string, unknown> | null,
    workDate: string,
    checkInIso: string,
    checkOutIso: string | null,
    reason: string,
    source: string,
    overrideShiftId?: string | null,
  ) => {
    const built = await buildAttendanceValues(employee, existing, workDate, checkInIso, checkOutIso, reason, overrideShiftId);
    if ("response" in built) return built;
    const mutation = existing
      ? await admin.from("attendance").update(built.values).eq("id", existing.id).select().single()
      : await admin.from("attendance").insert({
        employee_id: employee.id,
        work_date: workDate,
        ...built.values,
        gps_verified: false,
        source,
      }).select().single();
    if (mutation.error || !mutation.data) {
      return { response: json(400, { error: existing ? "แก้ไขเวลาไม่สำเร็จ" : "เพิ่มเวลาย้อนหลังไม่สำเร็จ" }) };
    }
    return { attendance: mutation.data };
  };

  const rollbackAttendance = async (
    existing: Record<string, unknown> | null,
    appliedAttendanceId: string,
  ) => {
    if (existing) {
      await admin.from("attendance").update({
        check_in: existing.check_in,
        check_out: existing.check_out,
        shift_id: existing.shift_id,
        branch_id: existing.branch_id,
        ot_minutes: existing.ot_minutes,
        is_late: existing.is_late,
        late_minutes: existing.late_minutes,
        edited_by: existing.edited_by,
        edit_note: existing.edit_note,
        edited_at: existing.edited_at,
        source: existing.source,
      }).eq("id", existing.id);
    } else {
      await admin.from("attendance").delete().eq("id", appliedAttendanceId);
    }
  };

  try {
    if (body.action === "upsert_attendance") {
      if (!isUuid(body.employee_id) || !isDate(body.work_date)) {
        return json(400, { error: "ข้อมูลพนักงานหรือวันที่ไม่ถูกต้อง" });
      }
      if (body.attendance_id !== null && body.attendance_id !== undefined && !isUuid(body.attendance_id)) {
        return json(400, { error: "รหัสรายการเวลาไม่ถูกต้อง" });
      }
      const checkIn = normalizeTime(body.check_in);
      const checkOut = normalizeTime(body.check_out);
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      if (!checkIn) return json(400, { error: "กรุณาระบุเวลาเข้าให้ถูกต้อง" });
      if (checkOut === undefined) return json(400, { error: "เวลาออกไม่ถูกต้อง" });
      if (checkOut && timeToMinutes(checkOut) <= timeToMinutes(checkIn)) {
        return json(400, { error: "เวลาออกต้องมากกว่าเวลาเข้า" });
      }
      if (reason.length < 3) return json(400, { error: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร" });

      const workDate = body.work_date;
      if (workDate > bangkokToday()) return json(400, { error: "ไม่สามารถเพิ่มเวลาล่วงหน้าได้" });
      if (await finalPayrollIsLocked(workDate)) {
        return json(409, { error: "เดือนนี้ยืนยัน Payroll สิ้นเดือนแล้ว ไม่สามารถแก้เวลาได้" });
      }

      const loaded = await loadEmployeeAndAttendance(body.employee_id, workDate);
      if ("response" in loaded) return loaded.response;
      const { employee, existing } = loaded;
      if (body.attendance_id && existing?.id !== body.attendance_id) {
        return json(409, { error: "รายการเวลาถูกเปลี่ยนแล้ว กรุณาโหลดรายงานใหม่" });
      }
      if (body.attendance_id && !existing) return json(404, { error: "ไม่พบรายการเวลาที่ต้องการแก้" });

      const checkInIso = `${workDate}T${checkIn}:00+07:00`;
      const checkOutIso = checkOut ? `${workDate}T${checkOut}:00+07:00` : null;
      const validated = await buildAttendanceValues(employee, existing, workDate, checkInIso, checkOutIso, reason);
      if ("response" in validated) return validated.response;

      if (actor.role === "hr") {
        const { data: changeRequest, error: requestError } = await admin
          .from("attendance_change_requests")
          .insert({
            employee_id: employee.id,
            attendance_id: existing?.id ?? null,
            work_date: workDate,
            proposed_check_in: checkInIso,
            proposed_check_out: checkOutIso,
            reason,
            existing_snapshot: attendanceSnapshot(existing),
            requested_by: actor.id,
          })
          .select()
          .single();
        if (requestError || !changeRequest) {
          const duplicate = requestError?.code === "23505";
          return json(duplicate ? 409 : 400, {
            error: duplicate ? "พนักงานมีคำขอแก้เวลาในวันนี้รออนุมัติอยู่แล้ว" : "ส่งคำขอแก้เวลาไม่สำเร็จ",
          });
        }
        const { error: auditError } = await audit("attendance_change_requested", employee.id, {
          request_id: changeRequest.id,
          attendance_id: existing?.id ?? null,
          work_date: workDate,
          reason,
          before: attendanceSnapshot(existing),
          proposed: { check_in: checkInIso, check_out: checkOutIso },
        });
        if (auditError) {
          await admin.from("attendance_change_requests").delete().eq("id", changeRequest.id);
          return json(500, { error: "บันทึกประวัติคำขอไม่สำเร็จ กรุณาลองใหม่" });
        }
        return json(200, { success: true, pending_approval: true, request: changeRequest });
      }

      const applied = await applyAttendance(
        employee,
        existing,
        workDate,
        checkInIso,
        checkOutIso,
        reason,
        "owner_manual",
        isUuid(body.shift_id) ? body.shift_id : undefined,
      );
      if ("response" in applied) return applied.response;
      const { error: auditError } = await audit(
        existing ? "attendance_manual_updated" : "attendance_manual_created",
        employee.id,
        {
          attendance_id: applied.attendance.id,
          work_date: workDate,
          reason,
          before: attendanceSnapshot(existing),
          after: attendanceSnapshot(applied.attendance),
        },
      );
      if (auditError) {
        await rollbackAttendance(existing, applied.attendance.id);
        return json(500, { error: "ไม่สามารถบันทึกประวัติการแก้ไขได้ กรุณาลองใหม่" });
      }
      return json(200, { success: true, created: !existing, attendance: applied.attendance });
    }

    if (body.action === "review_request") {
      if (actor.role !== "owner") return json(403, { error: "Owner access required" });
      if (!isUuid(body.request_id) || !["approved", "rejected"].includes(String(body.decision))) {
        return json(400, { error: "คำขอหรือผลการพิจารณาไม่ถูกต้อง" });
      }
      const decision = String(body.decision);
      const reviewNote = typeof body.review_note === "string" ? body.review_note.trim().slice(0, 500) : "";
      if (decision === "rejected" && reviewNote.length < 3) {
        return json(400, { error: "กรุณาระบุเหตุผลที่ไม่อนุมัติอย่างน้อย 3 ตัวอักษร" });
      }

      const { data: changeRequest, error: requestError } = await admin
        .from("attendance_change_requests")
        .select("*")
        .eq("id", body.request_id)
        .maybeSingle();
      if (requestError || !changeRequest) return json(404, { error: "ไม่พบคำขอแก้เวลา" });
      if (changeRequest.status !== "pending") return json(409, { error: "คำขอนี้ถูกพิจารณาแล้ว" });
      if (await finalPayrollIsLocked(changeRequest.work_date)) {
        return json(409, { error: "เดือนนี้ยืนยัน Payroll สิ้นเดือนแล้ว ไม่สามารถพิจารณาคำขอได้" });
      }

      const reviewedAt = new Date().toISOString();
      if (decision === "rejected") {
        const { data: rejected, error: rejectError } = await admin
          .from("attendance_change_requests")
          .update({ status: "rejected", reviewed_by: actor.id, reviewed_at: reviewedAt, review_note: reviewNote })
          .eq("id", changeRequest.id)
          .eq("status", "pending")
          .select()
          .single();
        if (rejectError || !rejected) return json(409, { error: "คำขอมีการเปลี่ยนแปลง กรุณาโหลดใหม่" });
        const { error: auditError } = await audit("attendance_change_rejected", changeRequest.employee_id, {
          request_id: changeRequest.id,
          work_date: changeRequest.work_date,
          review_note: reviewNote,
        });
        if (auditError) {
          await admin.from("attendance_change_requests")
            .update({ status: "pending", reviewed_by: null, reviewed_at: null, review_note: null })
            .eq("id", changeRequest.id);
          return json(500, { error: "บันทึกประวัติการพิจารณาไม่สำเร็จ กรุณาลองใหม่" });
        }
        return json(200, { success: true, request: rejected });
      }

      const loaded = await loadEmployeeAndAttendance(changeRequest.employee_id, changeRequest.work_date);
      if ("response" in loaded) return loaded.response;
      const { employee, existing } = loaded;
      if ((changeRequest.attendance_id ?? null) !== (existing?.id ?? null)) {
        return json(409, { error: "รายการเวลาจริงเปลี่ยนไปแล้ว กรุณาให้ HR ส่งคำขอใหม่" });
      }
      if (!snapshotMatches(changeRequest.existing_snapshot, existing)) {
        return json(409, { error: "ข้อมูลเวลาเปลี่ยนหลังส่งคำขอ กรุณาให้ HR ตรวจสอบและส่งใหม่" });
      }

      const applied = await applyAttendance(
        employee,
        existing,
        changeRequest.work_date,
        changeRequest.proposed_check_in,
        changeRequest.proposed_check_out,
        changeRequest.reason,
        "hr_request_approved",
      );
      if ("response" in applied) return applied.response;

      const { data: approved, error: approveError } = await admin
        .from("attendance_change_requests")
        .update({
          status: "approved",
          reviewed_by: actor.id,
          reviewed_at: reviewedAt,
          review_note: reviewNote || null,
          applied_attendance_id: applied.attendance.id,
        })
        .eq("id", changeRequest.id)
        .eq("status", "pending")
        .select()
        .single();
      if (approveError || !approved) {
        await rollbackAttendance(existing, applied.attendance.id);
        return json(409, { error: "คำขอมีการเปลี่ยนแปลง กรุณาโหลดใหม่" });
      }

      const { error: auditError } = await audit("attendance_change_approved", changeRequest.employee_id, {
        request_id: changeRequest.id,
        attendance_id: applied.attendance.id,
        work_date: changeRequest.work_date,
        requested_by: changeRequest.requested_by,
        reason: changeRequest.reason,
        review_note: reviewNote || null,
        before: attendanceSnapshot(existing),
        after: attendanceSnapshot(applied.attendance),
      });
      if (auditError) {
        await rollbackAttendance(existing, applied.attendance.id);
        await admin.from("attendance_change_requests")
          .update({ status: "pending", reviewed_by: null, reviewed_at: null, review_note: null, applied_attendance_id: null })
          .eq("id", changeRequest.id);
        return json(500, { error: "บันทึกประวัติการอนุมัติไม่สำเร็จ กรุณาลองใหม่" });
      }
      return json(200, { success: true, request: approved, attendance: applied.attendance });
    }

    return json(400, { error: "Unknown action" });
  } catch (error) {
    console.error("attendance-admin error", error);
    return json(500, { error: "ระบบแก้ไขเวลาขัดข้อง กรุณาลองใหม่" });
  }
});
