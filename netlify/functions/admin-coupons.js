/* ═══════════════════════════════════════════════════════════════
   Admin — Listar y marcar cupones como redimidos
   Protegido por ADMIN_PASSWORD
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
}

function auth(event) {
  const pass = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
  return ADMIN_PASSWORD && pass === ADMIN_PASSWORD;
}

exports.handler = async (event) => {
  if (!auth(event)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const db = getSupabase();

  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    const filter = qs.filter || 'all';
    const search = (qs.search || '').trim().toUpperCase();

    let query = db
      .from('participaciones')
      .select('id, coupon_code, discount_percent, instagram_user_id, media_id, created_at, expires_at, redeemed, redeemed_at, comment_text')
      .order('created_at', { ascending: false })
      .limit(200);

    if (filter === 'pending') query = query.eq('redeemed', false);
    else if (filter === 'redeemed') query = query.eq('redeemed', true);

    if (search) query = query.ilike('coupon_code', `%${search}%`);

    const { data, error } = await query;
    if (error) {
      console.error('Supabase error:', error);
      return jsonResponse(500, { error: 'Database error' });
    }

    const all = data || [];
    const total = all.length;
    const redeemed = all.filter(c => c.redeemed).length;
    const pending = total - redeemed;
    const avgDiscount = total > 0
      ? Math.round(all.reduce((s, c) => s + c.discount_percent, 0) / total)
      : 0;

    return jsonResponse(200, {
      coupons: all,
      kpis: { total, redeemed, pending, avgDiscount }
    });
  }

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { coupon_code, action, notes } = body;

      if (!coupon_code || !action) {
        return jsonResponse(400, { error: 'Missing coupon_code or action' });
      }

      const code = String(coupon_code).trim().toUpperCase();

      if (action === 'redeem') {
        const { data, error } = await db
          .from('participaciones')
          .update({
            redeemed: true,
            redeemed_at: new Date().toISOString(),
            redeemed_by: notes || 'admin'
          })
          .eq('coupon_code', code)
          .eq('redeemed', false)
          .select()
          .maybeSingle();

        if (error) {
          console.error('Supabase error:', error);
          return jsonResponse(500, { error: 'Database error' });
        }
        if (!data) {
          return jsonResponse(404, { error: 'Coupon not found or already redeemed' });
        }
        return jsonResponse(200, { success: true, coupon: data });
      }

      if (action === 'unredeem') {
        const { data, error } = await db
          .from('participaciones')
          .update({ redeemed: false, redeemed_at: null, redeemed_by: null })
          .eq('coupon_code', code)
          .select()
          .maybeSingle();

        if (error) {
          console.error('Supabase error:', error);
          return jsonResponse(500, { error: 'Database error' });
        }
        return jsonResponse(200, { success: true, coupon: data });
      }

      return jsonResponse(400, { error: 'Invalid action' });

    } catch (err) {
      console.error('Error:', err);
      return jsonResponse(500, { error: 'Server error' });
    }
  }

  return jsonResponse(405, { error: 'Method Not Allowed' });
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
