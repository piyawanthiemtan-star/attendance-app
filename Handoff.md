# Handoff — LSMG Time Attendance & Payroll System

**วันที่อัปเดต:** 1 กรกฎาคม 2569  
**โปรเจกต์:** LOEI SMART GROUP — ระบบลงเวลาและเงินเดือนพนักงาน  
**GitHub:** https://github.com/piyawanthiemtan-star/attendance-app  
**Live URL:** https://piyawanthiemtan-star.github.io/attendance-app/ (หรือ URL ที่ deploy)  
**Supabase Project:** ihtpdwgdbcxojpmisaaz  

---

## ภาพรวมระบบ

ระบบ PWA (Progressive Web App) สำหรับบริหารจัดการพนักงาน LSMG ประกอบด้วย 2 ส่วนหลัก:

| ไฟล์ | หน้าที่ |
|------|--------|
| `attendance-app.html` | แอปหลัก — ลงเวลา, ขอลา, เบี้ยขยัน, รายงาน, Admin |
| `payroll.html` | ระบบเงินเดือน — ตั้งค่าเงินเดือน, สลิป, รอบจ่าย, เบิกล่วงหน้า |
| `time-report.html` | รายงานเวลาทำงาน Export Excel |
| `manifest.json` | PWA config (ชื่อแอป, icon) |
| `sql_pending.sql` | SQL scripts สำหรับ Supabase |

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (ไม่มี framework)
- **Backend/DB:** Supabase (PostgreSQL + RLS)
- **Auth:** PIN 4 หลัก เทียบกับตาราง `employees` โดยตรง (ไม่ใช้ Supabase Auth)
- **Hosting:** GitHub Pages
- **Libraries:** XLSX.js (import/export Excel), Supabase JS v2

---

## โครงสร้างฐานข้อมูล (Supabase)

### ตารางที่มีอยู่เดิม
| ตาราง | ข้อมูล |
|-------|--------|
| `employees` | พนักงาน (id, name, pin, role, shift_id, branch_id, photo_url, ...) |
| `attendance` | การลงเวลา (employee_id, work_date, check_in, check_out, is_late, late_minutes, ot_minutes, source, edited_by, edit_note) |
| `leave_requests` | คำขอลา (employee_id, leave_type, start_date, end_date, status) |
| `shifts` | กะงาน (shift_name, check_in_time, check_out_time, has_ot) |
| `branches` | สาขา |
| `announcements` | ประกาศ (RLS: อ่านได้ทุกคน, เขียนได้เฉพาะ owner/hr) |
| `attendance_bonus` | เบี้ยขยัน |

### ตารางใหม่ (Payroll Phase — ต้องรัน sql_pending.sql)
| ตาราง | ข้อมูล |
|-------|--------|
| `employee_salary` | เงินเดือนรายคน (base_salary, position_pay, license_pay, commission, other_pay, other_deduct, ...) |
| `payroll_runs` | รอบการจ่ายเงิน (year_month, run_type: advance/final, status: draft/confirmed/paid) |
| `payroll_items` | สลิปรายคนต่อรอบ (gross_pay, total_deduct, net_pay, ...) |
| `salary_advances` | เงินเบิกกลางเดือน |

---

## Role และสิทธิ์

| Role | สิทธิ์ |
|------|--------|
| `owner` | ทุกอย่าง รวมถึงดูเงินเดือนทุกคน ตั้งค่าเงินเดือน สร้างรอบจ่าย |
| `hr` | จัดการพนักงาน อนุมัติลา เบิกล่วงหน้า ดูสลิปตัวเอง |
| `employee` | ลงเวลา ขอลา ดูสลิปตัวเอง |

> **สำคัญ:** ระบบควบคุมสิทธิ์ที่ UI เป็นหลัก เพราะใช้ PIN auth ไม่ใช่ Supabase Auth RLS policy ตั้งเป็น `allow_all` สำหรับตาราง payroll ทั้งหมด

---

## ตรรกะสำคัญ

### การคำนวณเงินเดือน
```
Pro-rate    = เงินเดือนพื้นฐาน × (วันที่มา / 30) — หาร 30 เสมอ
ประกันสังคม = MIN(เงินเดือน, 7,000) × 5% สูงสุด ฿350
OT/ชม.     = (เงินเดือน / 30 / 8) × 1.5
รอบ OT     = วันที่ 21 เดือนก่อน ถึง วันที่ 20 เดือนนี้
รอบ 1      = วันที่ 15 จ่ายคงที่ ฿4,000 ทุกคน
รอบ 2      = วันที่ 30/31 จ่ายเต็ม (gross - SS - other_deduct - เบิกล่วงหน้า - ฿4,000)
```

### การตรวจสาย
- เช็คอิน > เวลาเข้างานของกะ + 5 นาที = สาย
- `is_late` และ `late_minutes` บันทึกใน attendance record ตอนเช็คอิน
- **รายงานใช้ `a.is_late` จาก DB — ไม่คำนวณใหม่** (แก้บั๊กเรื่องเปลี่ยนกะแล้วขึ้นสาย)

### Import Excel
- Sheet "ลงเวลา": col 0=วันที่, 2=ชื่อ, 3=เข้า, 4=ออก, 5=กะ, 6=สาขา, 7=หมายเหตุ
- Sheet "วันลา": col 0=ชื่อ, 1=ประเภทลา, 2=วันเริ่ม, 3=วันสิ้นสุด, 5=เหตุผล, 6=สถานะ
- Data เริ่ม row index 2 (row 0=คำอธิบาย, 1=header)
- Upsert conflict: `employee_id, work_date`

---

## งานที่เสร็จแล้ว (Session นี้)

| # | งาน | สถานะ |
|---|-----|--------|
| 1 | SQL audit trail columns (attendance) | ✅ รัน SQL แล้ว |
| 2 | RLS + Policy announcements | ✅ รัน SQL แล้ว |
| 3 | แก้ manifest.json icon (ไม่มีโคม Chrome) | ✅ เสร็จ |
| 4 | สร้าง payroll.html ระบบเงินเดือนเต็มรูปแบบ | ✅ เสร็จ |
| 5 | ตั้งค่าเงินเดือนรายคน (base, ค่าตำแหน่ง, ค่าใบขับขี่, commission, อื่นๆ) | ✅ เสร็จ |
| 6 | รายการหักอื่นๆ (other_deduct + other_deduct_desc) | ✅ เสร็จ |
| 7 | สลิปเงินเดือนในแอปหลัก (ปุ่มหน้าแรก) | ✅ เสร็จ |
| 8 | จำกัดสิทธิ์ payroll.html เฉพาะ owner | ✅ เสร็จ |
| 9 | แก้บั๊กรายงานสายเมื่อเปลี่ยนกะ | ✅ เสร็จ |
| 10 | จัดการกะงาน (CRUD) | ✅ เสร็จ |
| 11 | Import Excel ลงเวลา + วันลา | ✅ เสร็จ |
| 12 | deploy ขึ้น GitHub Pages | ✅ เสร็จ |

---

## งานที่ยังค้างอยู่

| # | งาน | หมายเหตุ |
|---|-----|----------|
| 1 | ใส่ชื่อพนักงานจริงใน Template Excel (ม.ค.–มิ.ย.) | รอรายชื่อจากผู้ใช้ |
| 2 | Import ข้อมูลลงเวลา/วันลาย้อนหลัง | รอกรอกข้อมูลใน Excel |
| 3 | แก้ไขวันเริ่มงานพนักงาน | ยังไม่เริ่ม |
| 4 | Payroll — รอบจ่ายเงิน (ยืนยัน/จ่าย) | UI พร้อมแล้ว รอใช้งานจริง |
| 5 | Payroll — export สลิปเป็น PDF | ยังไม่ได้ทำ |
| 6 | ภาษีหัก ณ ที่จ่าย | ยังไม่ได้ implement |

---

## SQL ที่ต้องรันเพิ่ม

ถ้า `employee_salary` ถูกสร้างก่อน session นี้ ให้รัน:

```sql
ALTER TABLE employee_salary
  ADD COLUMN IF NOT EXISTS other_pay         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_desc        TEXT,
  ADD COLUMN IF NOT EXISTS other_deduct      NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deduct_desc TEXT;
```

---

## วิธี Deploy

1. แก้ไขไฟล์ใน `C:\HR_attendance-system\`
2. ไปที่ https://github.com/piyawanthiemtan-star/attendance-app
3. **Add file → Upload files** → ลากไฟล์ที่แก้ → Commit changes
4. รอ GitHub Actions deploy (~2 นาที)
5. ล้าง Service Worker: เปิด `chrome://serviceworker-internals` → Unregister → refresh

---

## ข้อควรระวัง

- **PIN auth ≠ Supabase Auth** — `auth.uid()` จะ return NULL เสมอ อย่าใช้ใน RLS policy
- **RLS payroll tables** ตั้งเป็น `allow_all` เพราะ PIN auth — การ protect ทำที่ UI
- **Service Worker** cache แรงมาก — ต้อง Unregister ทุกครั้งที่ test หลัง deploy
- **`employee_salary` มี UNIQUE(employee_id)** — upsert ด้วย `onConflict:'employee_id'`
- **รายงานสาย** ใช้ `a.is_late` จาก DB ไม่คำนวณใหม่ — อย่าเปลี่ยนกลับ
- **payroll.html login** แสดงเฉพาะ role='owner' ในรายชื่อ

---

## ติดต่อ / ข้อมูลเพิ่มเติม

- **Email:** piyawanthiemtan@gmail.com
- **Supabase Dashboard:** https://supabase.com/dashboard/project/ihtpdwgdbcxojpmisaaz
