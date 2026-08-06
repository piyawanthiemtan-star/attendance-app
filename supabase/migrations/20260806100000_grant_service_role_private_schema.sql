-- PIN employees now submit their own leave through the pin-attendance Edge
-- Function, which inserts into public.leave_requests as the service_role. That
-- insert fires the BEFORE trigger private.enforce_annual_leave_policy(), which
-- calls private.current_employee_role(). The private schema had been locked down
-- to the authenticated role only, so the service_role insert failed with
-- "42501 permission denied for schema private" (seen on vacation/ลาพักร้อน,
-- the one leave type whose client-side checks pass and reach the DB insert).
--
-- service_role is the trusted backend role used by Edge Functions (it already
-- bypasses RLS and can read/write every table), so granting it access to the
-- private schema lets Edge-Function writes fire private triggers without
-- widening any client-facing (anon/authenticated) surface.

grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;

-- Cover private functions added by future migrations too.
alter default privileges in schema private grant execute on functions to service_role;
