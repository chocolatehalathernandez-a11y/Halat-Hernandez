/* ═══════════════════════════════════════════════════════════════
   Instagram Webhook — Sistema de cupones vía comentarios
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY en variables de entorno');
  }

  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
}

function generateRandomDiscount() {
  return Math.floor(Math.random() * 15) + 1;
}

function generateCouponCode(discount) {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PROMO${discount}X${randomPart}`;
}

function extractCommentData(body) {
  let mediaId = null;
  let instagramUserId = null;
  let commentText = '';

  if (body && Array.isArray(body.entry)) {
    for (const entry of body.entry) {
      if (!entry.changes) continue;
      for (const change of entry.changes) {
        if (change.field === 'comments' && change.value) {
          mediaId = (change.value.media && change.value.media.id) || entry.id || null;
          instagramUserId = (change.value.from && change.value.from.id) || null;
          commentText = change.value.text || '';
        }
      }
    }
  }

  if (!mediaId && body && body.media_id) mediaId = String(body.media_id);
  if (!instagramUserId && body && body.instagram_user_id) {
    instagramUserId = String(body.instagram_user_id);
  }

  return { mediaId, instagramUserId, commentText };
}

async function sendInstagramDM(instagramUserId, couponCode, discount) {
  console.log(`[TODO] Enviar DM a ${instagramUserId}: ${couponCode} (${discount}%)`);
  return null;
}

exports.handler = async (event) => {
  /* Handshake de verificación de Meta (GET) */
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    if (mode === 'subscribe' && token === IG_VERIFY_TOKEN) {
      return { statusCode: 200, body: challenge || '' };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (err) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON body' })
      };
    }

    const { mediaId, instagramUserId, commentText } = extractCommentData(body);

    if (!mediaId || !instagramUserId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Missing media_id or instagram_user_id',
          received: { mediaId, instagramUserId }
        })
      };
    }

    const db = getSupabase();

    const { data: existing, error: selectError } = await db
      .from('participaciones')
      .select('id, coupon_code, discount_percent')
      .eq('instagram_user_id', instagramUserId)
      .eq('media_id', mediaId)
      .maybeSingle();

    if (selectError) {
      console.error('Supabase select error:', selectError);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Database read error' })
      };
    }

    if (existing) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'already_participated',
          media_id: mediaId,
          instagram_user_id: instagramUserId
        })
      };
    }

    const discount = generateRandomDiscount();
    const couponCode = generateCouponCode(discount);

    const { error: insertError } = await db
      .from('participaciones')
      .insert({
        instagram_user_id: instagramUserId,
        media_id: mediaId,
        discount_percent: discount,
        coupon_code: couponCode
      });

    if (insertError) {
      if (insertError.code === '23505') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'already_participated' })
        };
      }
      console.error('Supabase insert error:', insertError);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Database write error' })
      };
    }

    await sendInstagramDM(instagramUserId, couponCode, discount);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'coupon_generated',
        media_id: mediaId,
        instagram_user_id: instagramUserId,
        discount_percent: discount,
        coupon_code: couponCode,
        comment_text: commentText
      })
    };

  } catch (error) {
    console.error('Webhook unexpected error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};