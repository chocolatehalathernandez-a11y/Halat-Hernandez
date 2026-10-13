/* ═══════════════════════════════════════════════════════════════
   Validar cupón — Llamado desde Roncaccio
   Vigencia: 7 días desde emisión
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const COUPON_VALIDITY_DAYS = 7;

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Faltan credenciales de Supabase');
  }
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { valid: false, reason: 'method_not_allowed' });
  }

  try {
    const { coupon_code } = JSON.parse(event.body || '{}');
    if (!coupon_code || typeof coupon_code !== 'string') {
      return jsonResponse(400, { valid: false, reason: 'missing_code' });
    }

    const code = coupon_code.trim().toUpperCase();
    if (code.length < 6 || code.length > 40) {
      return jsonResponse(200, { valid: false, reason: 'not_found' });
    }

    const db = getSupabase();
    const { data, error } = await db
      .from('participaciones')
      .select('id, coupon_code, discount_percent, redeemed, redeemed_at, created_at, expires_at, validation_count, last_validated_at')
      .eq('coupon_code', code)
      .maybeSingle();

    if (error) {
      console.error('Supabase error:', error);
      return jsonResponse(500, { valid: false, reason: 'server_error' });
    }

    if (!data) {
      return jsonResponse(200, { valid: false, reason: 'not_found' });
    }

    /* ─── Verificar si ya fue redimido ─── */
    if (data.redeemed) {
      return jsonResponse(200, {
        valid: false,
        reason: 'already_redeemed',
        redeemed_at: data.redeemed_at,
        message: 'Este cupón ya fue redimido'
      });
    }

    /* ─── Verificar expiración ─── */
    const expiresAtMs = data.expires_at
      ? new Date(data.expires_at).getTime()
      : new Date(data.created_at).getTime() + (COUPON_VALIDITY_DAYS * 86400000);

    const now = Date.now();

    if (now > expiresAtMs) {
      const daysSinceExpired = Math.floor((now - expiresAtMs) / 86400000);
      return jsonResponse(200, {
        valid: false,
        reason: 'expired',
        expired_at: new Date(expiresAtMs).toISOString(),
        days_since_expired: daysSinceExpired,
        message: daysSinceExpired === 0
          ? 'Este cupón expiró hoy'
          : `Este cupón expiró hace ${daysSinceExpired} día${daysSinceExpired !== 1 ? 's' : ''}`
      });
    }

    /* ─── Auditoría: cada validación exitosa suma 1 al contador ─── */
    try {
      await db
        .from('participaciones')
        .update({
          last_validated_at: new Date().toISOString(),
          validation_count: (data.validation_count || 0) + 1
        })
        .eq('id', data.id);
    } catch (auditErr) {
      console.warn('No se pudo registrar auditoría:', auditErr);
      /* No bloqueamos la respuesta al usuario */
    }

    /* ─── Respuesta exitosa ─── */
    const daysRemaining = Math.ceil((expiresAtMs - now) / 86400000);

    return jsonResponse(200, {
      valid: true,
      coupon_code: data.coupon_code,
      discount_percent: data.discount_percent,
      created_at: data.created_at,
      expires_at: new Date(expiresAtMs).toISOString(),
      days_remaining: daysRemaining,
      message: `Cupón válido por ${data.discount_percent}% de descuento · expira en ${daysRemaining} día${daysRemaining !== 1 ? 's' : ''}`
    });

  } catch (err) {
    console.error('Error validando cupón:', err);
    return jsonResponse(500, { valid: false, reason: 'server_error' });
  }
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(payload)
  };
}