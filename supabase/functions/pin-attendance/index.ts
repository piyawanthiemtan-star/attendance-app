import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
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

const normalizePin = (value: unknown) => String(value ?? "")
  .trim()
  .replace(/[๐-๙]/g, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)))
  .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xFF10))
  .replace(/\s+/g, "");

type ProfilePhotoResult =
  | { error: string }
  | { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" | "image/webp"; extension: "jpg" | "png" | "webp" };

const decodeProfilePhoto = (value: unknown): ProfilePhotoResult => {
  if (typeof value !== "string") return { error: "กรุณาเลือกรูปโปรไฟล์" };
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return { error: "รองรับเฉพาะ JPG, PNG และ WEBP" };
  if (match[2].length > 2_800_000) return { error: "รูปใหญ่เกิน 2MB หลังย่อ กรุณาเลือกรูปใหม่" };

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  } catch {
    return { error: "ข้อมูลรูปไม่ถูกต้อง" };
  }
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) {
    return { error: "รูปใหญ่เกิน 2MB หลังย่อ กรุณาเลือกรูปใหม่" };
  }

  const mimeType = match[1] as "image/jpeg" | "image/png" | "image/webp";
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  const isWebp = bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if ((mimeType === "image/jpeg" && !isJpeg) || (mimeType === "image/png" && !isPng) ||
    (mimeType === "image/webp" && !isWebp)) {
    return { error: "ชนิดไฟล์รูปไม่ตรงกับข้อมูลจริง" };
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
  return { bytes, mimeType, extension };
};

const bangkokDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const minutesInBangkok = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
};

const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const safeEmployee = (employee: Record<string, unknown>) => ({
  id: employee.id,
  name: employee.name,
  role: employee.role,
  department: employee.department,
  photo_url: employee.photo_url,
  shift_id: employee.shift_id,
  start_date: employee.start_date,
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Server configuration error" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request" });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "list_employees") {
    const { data, error } = await admin
      .from("employees")
      .select("id, name, role")
      .eq("status", "active")
      .in("role", ["employee", "hr"])
      .eq("attendance_required", true)
      .is("access_disabled_at", null)
      .order("name");
    if (error) return json(500, { error: "โหลดรายชื่อพนักงานไม่สำเร็จ" });
    return json(200, { employees: data ?? [] });
  }

  const employeeId = body.employee_id;
  const pin = normalizePin(body.pin);
  const deviceId = typeof body.device_id === "string" ? body.device_id.slice(0, 200) : "";
  const deviceName = typeof body.device_name === "string" ? body.device_name.slice(0, 200) : "";
  if (!isUuid(employeeId) || !/^\d{4}$/.test(pin)) {
    return json(400, { error: "กรุณาเลือกพนักงานและกรอก PIN 4 หลัก" });
  }

  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count: failedCount } = await admin
    .from("security_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("target_employee_id", employeeId)
    .eq("action", "pin_attendance_auth_failed")
    .gte("created_at", since);
  if ((failedCount ?? 0) >= 5) {
    return json(429, { error: "ใส่ PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่" });
  }

  const { data: employee } = await admin
    .from("employees")
    .select("id, name, role, department, photo_url, shift_id, start_date, pin, status, access_disabled_at, attendance_required, device_id, device_name")
    .eq("id", employeeId)
    .maybeSingle();

  const isAttendanceUser = employee && ["employee", "hr"].includes(employee.role);
  if (!employee || employee.pin !== pin || !isAttendanceUser ||
    employee.attendance_required !== true || employee.status !== "active" || employee.access_disabled_at) {
    await admin.from("security_audit_log").insert({
      target_employee_id: employeeId,
      action: "pin_attendance_auth_failed",
      details: { reason: "invalid_employee_or_pin" },
      user_agent: req.headers.get("user-agent"),
    });
    return json(401, { error: "PIN ไม่ถูกต้อง กรุณาตรวจสอบ PIN ล่าสุด หรือติดต่อ Owner ให้ตั้ง PIN ใหม่" });
  }

  if (isAttendanceUser && employee.device_id && employee.device_id !== deviceId) {
    await admin.from("security_audit_log").insert({
      target_employee_id: employee.id,
      action: "pin_attendance_device_mismatch",
      details: { attempted_device_name: deviceName },
      user_agent: req.headers.get("user-agent"),
    });
    const { data: existingAlert } = await admin
      .from("device_alerts")
      .select("id")
      .eq("employee_id", employee.id)
      .eq("resolved", false)
      .limit(1)
      .maybeSingle();
    if (!existingAlert) {
      await admin.from("device_alerts").insert({
        employee_id: employee.id,
        device_id: deviceId || "unknown",
        device_name: deviceName || "Unknown device",
        alert_type: "device_mismatch",
      });
    }
    return json(403, { error: "ไม่สามารถใช้บัญชีนี้จากอุปกรณ์เครื่องนี้ได้ กรุณาติดต่อ HR" });
  }

  if (isAttendanceUser && !employee.device_id && deviceId) {
    await admin.from("employees").update({ device_id: deviceId, device_name: deviceName }).eq("id", employee.id);
  }

  const workDate = bangkokDate();
  const getToday = async () => {
    const { data } = await admin
      .from("attendance")
      .select("*")
      .eq("employee_id", employee.id)
      .eq("work_date", workDate)
      .maybeSingle();
    return data;
  };

  if (action === "login" || action === "today") {
    const [attendance, shiftsResult, branchesResult] = await Promise.all([
      getToday(),
      admin.from("shifts").select("*").order("shift_name"),
      admin.from("branches").select("*").eq("active", true).order("name"),
    ]);
    return json(200, {
      employee: safeEmployee(employee),
      attendance,
      shifts: shiftsResult.data ?? [],
      branches: branchesResult.data ?? [],
    });
  }

  if (action === "leave_summary") {
    const { data, error } = await admin
      .from("leave_requests")
      .select("id, leave_type, start_date, end_date, days, status, reason, note, created_at")
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false });
    if (error) return json(500, { error: "โหลดข้อมูลวันลาไม่สำเร็จ" });
    return json(200, { leaves: data ?? [] });
  }

  if (action === "update_profile_photo") {
    const decoded = decodeProfilePhoto(body.photo_data_url);
    if ("error" in decoded) return json(400, { error: decoded.error });

    const fileName = `${employee.id}.${decoded.extension}`;
    const bucket = admin.storage.from("employee-photos");
    const { error: uploadError } = await bucket.upload(fileName, decoded.bytes, {
      contentType: decoded.mimeType,
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) return json(500, { error: "อัปโหลดรูปโปรไฟล์ไม่สำเร็จ" });

    const publicUrl = bucket.getPublicUrl(fileName).data.publicUrl;
    const photoUrl = `${publicUrl}?v=${Date.now()}`;
    const { error: updateError } = await admin.from("employees")
      .update({ photo_url: photoUrl })
      .eq("id", employee.id);
    if (updateError) return json(500, { error: "บันทึกรูปโปรไฟล์ไม่สำเร็จ" });

    const obsoleteFiles = ["jpg", "png", "webp"]
      .filter((extension) => extension !== decoded.extension)
      .map((extension) => `${employee.id}.${extension}`);
    if (obsoleteFiles.length) await bucket.remove(obsoleteFiles);
    await admin.from("security_audit_log").insert({
      target_employee_id: employee.id,
      action: "pin_profile_photo_updated",
      details: { file_name: fileName },
      user_agent: req.headers.get("user-agent"),
    });
    return json(200, { photo_url: photoUrl });
  }

  if (action === "change_pin") {
    const newPin = normalizePin(body.new_pin);
    if (!/^\d{4}$/.test(newPin)) return json(400, { error: "PIN ใหม่ต้องเป็นตัวเลข 4 หลัก" });
    if (newPin === pin) return json(400, { error: "PIN ใหม่ต้องไม่ซ้ำกับ PIN เดิม" });
    const { error } = await admin.from("employees").update({ pin: newPin }).eq("id", employee.id);
    if (error) return json(500, { error: "เปลี่ยน PIN ไม่สำเร็จ" });
    await admin.from("security_audit_log").insert({
      target_employee_id: employee.id,
      action: "pin_changed_by_employee",
      user_agent: req.headers.get("user-agent"),
    });
    return json(200, { success: true });
  }

  const latitude = typeof body.latitude === "number" && Number.isFinite(body.latitude) ? body.latitude : null;
  const longitude = typeof body.longitude === "number" && Number.isFinite(body.longitude) ? body.longitude : null;
  let nearestBranch: Record<string, unknown> | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  if (latitude !== null && longitude !== null) {
    const { data: branches } = await admin.from("branches").select("id, name, latitude, longitude, radius_meters").eq("active", true);
    for (const branch of branches ?? []) {
      const branchLat = Number(branch.latitude);
      const branchLng = Number(branch.longitude);
      if (!Number.isFinite(branchLat) || !Number.isFinite(branchLng)) continue;
      const distance = distanceMeters(latitude, longitude, branchLat, branchLng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestBranch = branch;
      }
    }
    const allowedRadius = Number(nearestBranch?.radius_meters ?? (action === "check_in" ? 50 : 200));
    if (!nearestBranch || nearestDistance > allowedRadius) {
      return json(403, { error: `อยู่นอกพื้นที่สาขา (${Math.round(nearestDistance)} เมตร)` });
    }
  }

  if (action === "check_in") {
    const existing = await getToday();
    if (existing) return json(409, { error: "วันนี้ลงเวลาเข้าแล้ว" });

    const shiftId = isUuid(body.shift_id) ? body.shift_id : employee.shift_id;
    let validShiftId: string | null = null;
    if (isUuid(shiftId)) {
      const { data: shift } = await admin.from("shifts").select("id").eq("id", shiftId).maybeSingle();
      validShiftId = shift?.id ?? null;
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const { data, error } = await admin.from("attendance").insert({
      employee_id: employee.id,
      check_in: new Date().toISOString(),
      work_date: workDate,
      shift_id: validShiftId,
      branch_id: nearestBranch?.id ?? null,
      latitude,
      longitude,
      gps_verified: latitude !== null && longitude !== null,
      note: note || null,
    }).select().single();
    if (error) return json(400, { error: "บันทึกเวลาเข้าไม่สำเร็จ" });
    return json(200, { attendance: data, branch: nearestBranch?.name ?? null });
  }

  const attendance = await getToday();
  if (!attendance?.check_in) return json(409, { error: "ยังไม่ได้ลงเวลาเข้า" });

  if (action === "break_start") {
    if (attendance.check_out) return json(409, { error: "ลงเวลาออกแล้ว" });
    if (attendance.break_start) {
      return json(409, { error: attendance.break_end ? "วันนี้บันทึกเวลาพักเรียบร้อยแล้ว" : "อยู่ในช่วงพักแล้ว" });
    }
    const { data, error } = await admin.from("attendance")
      .update({ break_start: new Date().toISOString(), break_end: null })
      .eq("id", attendance.id).is("check_out", null).select().single();
    if (error) return json(400, { error: "บันทึกเวลาออกพักไม่สำเร็จ" });
    return json(200, { attendance: data });
  }

  if (action === "break_end") {
    if (!attendance.break_start || attendance.break_end) return json(409, { error: "ไม่ได้อยู่ในช่วงพัก" });
    const { data, error } = await admin.from("attendance")
      .update({ break_end: new Date().toISOString() })
      .eq("id", attendance.id).is("check_out", null).select().single();
    if (error) return json(400, { error: "บันทึกเวลากลับเข้าทำงานไม่สำเร็จ" });
    return json(200, { attendance: data });
  }

  if (action === "check_out") {
    if (attendance.check_out) return json(409, { error: "วันนี้ลงเวลาออกแล้ว" });
    if (attendance.break_start && !attendance.break_end) {
      return json(409, { error: "กรุณากดกลับเข้าทำงานก่อนเช็กเอาต์" });
    }
    let otMinutes = 0;
    let earlyCheckout = false;
    if (attendance.shift_id) {
      const { data: shift } = await admin.from("shifts").select("check_in_time, check_out_time").eq("id", attendance.shift_id).maybeSingle();
      if (shift?.check_out_time) {
        const [hour, minute] = String(shift.check_out_time).split(":").map(Number);
        const difference = minutesInBangkok() - (hour * 60 + minute);
        earlyCheckout = difference < 0;
        if (earlyCheckout && body.early_checkout_confirmed !== true) {
          return json(409, { error: `ยังไม่ถึงเวลาเลิกงาน ${String(shift.check_out_time).slice(0, 5)} น. กรุณายืนยันอีกครั้ง` });
        }
        if (difference >= 40) {
          // OT สุทธิ = OT ดิบ - นาทีสาย (มาสายหักออกจาก OT, ไม่ต่ำกว่า 0)
          let lateMinutes = 0;
          if (shift.check_in_time && attendance.check_in) {
            const [ih, im] = String(shift.check_in_time).split(":").map(Number);
            lateMinutes = Math.max(0, minutesInBangkok(new Date(String(attendance.check_in))) - (ih * 60 + im));
          }
          otMinutes = Math.max(0, difference - lateMinutes);
        }
      }
    }
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { check_out: now, ot_minutes: otMinutes };
    if (latitude !== null && longitude !== null) {
      update.latitude = latitude;
      update.longitude = longitude;
      update.gps_verified = true;
      update.branch_id = nearestBranch?.id ?? attendance.branch_id;
    }
    const { data, error } = await admin.from("attendance").update(update)
      .eq("id", attendance.id).is("check_out", null).select().single();
    if (error) return json(400, { error: "บันทึกเวลาออกไม่สำเร็จ" });
    if (earlyCheckout) {
      await admin.from("security_audit_log").insert({
        actor_employee_id: employee.id,
        target_employee_id: employee.id,
        action: "pin_attendance_early_checkout",
        details: { work_date: workDate, attendance_id: attendance.id },
        user_agent: req.headers.get("user-agent"),
      });
    }
    return json(200, { attendance: data, branch: nearestBranch?.name ?? null });
  }

  return json(400, { error: "Unknown action" });
});
