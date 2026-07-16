(function () {
  const AUTH_ERRORS = {
    invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    email_not_confirmed: 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ',
    user_banned: 'บัญชีนี้ถูกระงับการใช้งาน',
  };

  const authErrorMessage = (error) => {
    if (!error) return 'ไม่สามารถเข้าสู่ระบบได้';
    return AUTH_ERRORS[error.code] || 'ไม่สามารถเข้าสู่ระบบได้ กรุณาตรวจสอบข้อมูลแล้วลองใหม่';
  };

  const loadEmployee = async (db, authUser, allowedRoles) => {
    const { data, error } = await db
      .from('employees')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    if (error) throw new Error('ไม่สามารถอ่านข้อมูลพนักงานได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ');
    if (!data) throw new Error('บัญชีนี้ยังไม่ได้เชื่อมกับข้อมูลพนักงาน');
    if (data.status !== 'active' || data.access_disabled_at) {
      throw new Error('บัญชีนี้ถูกปิดสิทธิ์หรือพ้นสภาพพนักงานแล้ว');
    }
    if (allowedRoles && !allowedRoles.includes(data.role)) {
      throw new Error('บัญชีนี้ไม่มีสิทธิ์เข้าหน้านี้');
    }
    return data;
  };

  const signIn = async (db, email, password, allowedRoles) => {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new Error(authErrorMessage(error));
    try {
      return await loadEmployee(db, data.user, allowedRoles);
    } catch (profileError) {
      await db.auth.signOut({ scope: 'local' });
      throw profileError;
    }
  };

  const restore = async (db, allowedRoles) => {
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) return null;
    try {
      return await loadEmployee(db, data.user, allowedRoles);
    } catch {
      await db.auth.signOut({ scope: 'local' });
      return null;
    }
  };

  const signOut = async (db) => {
    await db.auth.signOut({ scope: 'local' });
  };

  const requestPasswordReset = async (db, email, redirectTo) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('กรุณากรอกอีเมลก่อน');

    const { error } = await db.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo,
    });
    if (error) {
      if (error.code === 'over_email_send_rate_limit') {
        throw new Error('ส่งอีเมลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
      }
      throw new Error('ไม่สามารถส่งลิงก์ตั้งรหัสผ่านได้ กรุณาลองใหม่');
    }
  };

  window.LSMGAuth = { signIn, restore, signOut, requestPasswordReset };
})();
