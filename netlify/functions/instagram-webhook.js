/* ═══════════════════════════════════════════════════════════════
   Instagram Webhook — Sistema de cupones vía comentarios
   ───────────────────────────────────────────────────────────────
   Reglas de negocio:
   1. Solo comentarios con sabor/adjetivo válido
   2. Solo en la última publicación
   3. 1 cupón por usuario por publicación (anti-spam)
   4. Máx 2 comentarios por usuario por post (tracking)
   5. Descuento real: 9-15% (no revelado al usuario)
   6. Código único con random + timestamp
   7. Redimible solo por WhatsApp, NO acumulable
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY; const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;
const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || '';
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID || '';
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '+573208209369';

/* ═══════════════════════════════════════════════════════════════
   DICCIONARIO DE SABORES Y ADJETIVOS
   ═══════════════════════════════════════════════════════════════ */
const FLAVOR_KEYWORDS = [
  'maracuya', 'uva', 'uvas', 'almendra', 'almendras',
  'frutos rojos', 'frambuesa', 'frambuesas', 'fresa', 'fresas',
  'mora', 'moras', 'arandano', 'arandanos', 'cereza', 'cerezas',
  'mani', 'cacahuate', 'sal marina', 'salado', 'salada',

  'chocolate', 'cacao', 'chocolate negro', 'chocolate amargo',
  'chocolate oscuro', 'chocolate blanco', 'chocolate con leche',

  'mango', 'pina', 'papaya', 'guanabana', 'lulo', 'feijoa',
  'guayaba', 'curuba', 'granadilla', 'coco', 'banano', 'platano',
  'limon', 'naranja', 'mandarina', 'toronja', 'kiwi',
  'durazno', 'melocoton', 'manzana', 'pera', 'sandia', 'melon',

  'avellana', 'avellanas', 'nuez', 'nueces', 'pistacho', 'pistachos',
  'castana', 'castanas', 'macadamia', 'pecana', 'pecanas',

  'caramelo', 'dulce de leche', 'arequipe', 'nutella', 'vainilla',
  'cafe', 'moka', 'mocha', 'tiramisu', 'cheesecake', 'brownie',
  'galleta', 'galletas', 'oreo', 'chicle', 'marshmallow',

  'baileys', 'whisky', 'whiskey', 'ron', 'vino', 'champagne',
  'champana', 'tequila', 'vodka', 'licor',

  'canela', 'menta', 'lavanda', 'jengibre', 'cardamomo',
  'pimienta', 'nuez moscada', 'cayena', 'chile', 'picante',

  'dulce', 'dulces', 'amargo', 'amarga', 'amargos',
  'acido', 'acida', 'acidos', 'acidas',
  'cremoso', 'cremosa', 'cremosos', 'cremosas',
  'tostado', 'tostada', 'tostados', 'tostadas',
  'tropical', 'tropicales', 'frutal', 'frutales',
  'floral', 'florales', 'intenso', 'intensa', 'suave', 'suaves',
  'citrico', 'citrica', 'citricos', 'citricas',
  'seco', 'seca', 'jugoso', 'jugosa', 'sedoso', 'sedosa',
  'refrescante', 'refrescantes', 'delicado', 'delicada'
];

const FLAVOR_KEYWORDS_NORMALIZED = FLAVOR_KEYWORDS.map(normalizeText).filter(Boolean);

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findFlavorKeyword(commentText) {
  const normalized = normalizeText(commentText);
  if (!normalized || normalized.length < 3) {
    return { match: false, keyword: null };
  }

  const sortedKeywords = [...FLAVOR_KEYWORDS_NORMALIZED].sort((a, b) => b.length - a.length);

  for (const keyword of sortedKeywords) {
    if (!keyword) continue;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
    if (regex.test(normalized)) {
      return { match: true, keyword };
    }
  }
  return { match: false, keyword: null };
}

/**
 * Descuento REAL entre 9 y 15 (no revelado al usuario).
 */
function generateRandomDiscount() {
  return Math.floor(Math.random() * 7) + 9;
}

/**
 * Genera código único: PROMO{XX}X{RANDOM6}{TIME4}
 * random: 36^6 = 2.1 mil millones combinaciones
 * time: últimos 4 caracteres base36 de Date.now()
 * Total: ~10 billones de combinaciones
 */
function generateCouponCode(discount) {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  return `PROMO${discount}X${randomPart}${timePart}`;
}

function extractCommentData(body) {
  let mediaId = null;
  let instagramUserId = null;
  let commentText = '';
  let commentId = null;

  if (body && Array.isArray(body.entry)) {
    for (const entry of body.entry) {
      if (!entry.changes) continue;
      for (const change of entry.changes) {
        if (change.field === 'comments' && change.value) {
          mediaId = (change.value.media && change.value.media.id) || entry.id || null;
          instagramUserId = (change.value.from && change.value.from.id) || null;
          commentText = change.value.text || '';
          commentId = change.value.id || null;
        }
      }
    }
  }

  if (!mediaId && body && body.media_id) mediaId = String(body.media_id);
  if (!instagramUserId && body && body.instagram_user_id) {
    instagramUserId = String(body.instagram_user_id);
  }
  if (!commentText && body && body.comment_text) commentText = String(body.comment_text);
  if (!commentId && body && body.comment_id) commentId = String(body.comment_id);

  return { mediaId, instagramUserId, commentText, commentId };
}

async function getLatestMediaId() {
  if (!INSTAGRAM_ACCESS_TOKEN || !IG_BUSINESS_ACCOUNT_ID) return null;

  try {
    const url = `https://graph.facebook.com/v21.0/${IG_BUSINESS_ACCOUNT_ID}/media?fields=id,timestamp&limit=1&access_token=${INSTAGRAM_ACCESS_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && Array.isArray(data.data) && data.data.length > 0) {
      return data.data[0].id;
    }
    console.warn('No se pudo obtener última publicación:', data);
    return null;
  } catch (err) {
    console.error('Error obteniendo última publicación:', err);
    return null;
  }
}

async function checkUserIsFollower(userId) {
  /* TODO: Implementar con permiso instagram_manage_insights */
  return null;
}

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_KEY');
  }
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
}

function buildCouponMessage(couponCode, discount) {
  return (
    `🎉 ¡Ganaste el Cupón *${couponCode}* con *${discount}% de descuento*! Felicitaciones.\n` +
    `📋 *Políticas de redención:*\n` +
    `• Participaste en el sorteo de descuentos del 1% al 15%.\n` +
    `• Válido únicamente pasando la validación por WhatsApp al momento de la compra.\n` +
    `• Aplica sobre el total de la compra.\n` +
    `• No acumulable con otros cupones de instagram.\n` +
    `• Un cupón = una sola transacción.\n` +
    `• Exclusivo para seguidores de la página de Instagram.\n` +
    `• Válido por 1 semana desde su emisión.\n` +
    `📱 Redímelo con el asesor de la casa: halathernandez.com enlace en la biografía\n` +
    `✨ Sigue atento a más participaciones.`
  );
}

async function sendInstagramDM(instagramUserId, couponCode, discount, commentText) {
  const messageText = buildCouponMessage(couponCode, discount);

  if (!INSTAGRAM_ACCESS_TOKEN) {
    console.warn('[DM] INSTAGRAM_ACCESS_TOKEN no configurado — saltando envío');
    return null;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${INSTAGRAM_ACCESS_TOKEN}`;
    const payload = {
      recipient: { id: instagramUserId },
      message: { text: messageText }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Meta API error:', data);
      return null;
    }

    console.log(`✓ DM enviado a ${instagramUserId}`);
    return data;

  } catch (err) {
    console.error('Error enviando DM:', err);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   Handler principal
   ═══════════════════════════════════════════════════════════════ */

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    if (params['hub.mode'] === 'subscribe' && params['hub.verify_token'] === IG_VERIFY_TOKEN) {
      return { statusCode: 200, body: params['hub.challenge'] || '' };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (err) {
      return jsonResponse(400, { error: 'Invalid JSON body' });
    }

    const { mediaId, instagramUserId, commentText, commentId } = extractCommentData(body);

    if (!mediaId || !instagramUserId) {
      return jsonResponse(400, {
        error: 'Missing media_id or instagram_user_id',
        received: { mediaId, instagramUserId }
      });
    }

    /* ─── VALIDACIÓN 1: SABOR ─── */
    const flavorCheck = findFlavorKeyword(commentText);
    if (!flavorCheck.match) {
      console.log(`Comentario sin sabor válido: "${commentText}"`);
      return jsonResponse(200, {
        status: 'not_flavor_guess',
        media_id: mediaId,
        instagram_user_id: instagramUserId,
        comment_text: commentText,
        message: 'El comentario no menciona un sabor o adjetivo relacionado'
      });
    }

    /* ─── VALIDACIÓN 2: ÚLTIMA PUBLICACIÓN ─── */
    const latestMediaId = await getLatestMediaId();
    if (latestMediaId && mediaId !== latestMediaId) {
      console.log(`Comentario en post antiguo (${mediaId} ≠ ${latestMediaId})`);
      return jsonResponse(200, {
        status: 'not_latest_post',
        media_id: mediaId,
        latest_media_id: latestMediaId,
        message: 'El comentario no es de la publicación más reciente'
      });
    }

    /* ─── VALIDACIÓN 3: FOLLOWER (soft check) ─── */
    const isFollower = await checkUserIsFollower(instagramUserId);

    /* ─── ANTI-SPAM: 1 cupón por usuario por publicación ─── */
    console.log('[DEBUG] Valores antes del select:', {
      instagramUserId,
      mediaId,
      type_user: typeof instagramUserId,
      type_media: typeof mediaId,
      len_user: instagramUserId ? instagramUserId.length : 0,
      len_media: mediaId ? mediaId.length : 0
    });
    const db = getSupabase();
    const { data: existing, error: selectError } = await db
      .from('participaciones')
      .select('id, coupon_code, discount_percent, comment_count, expires_at, redeemed')
      .eq('instagram_user_id', instagramUserId)
      .eq('media_id', mediaId)
      .maybeSingle();

    if (selectError) {
      console.error('Supabase select error:', selectError);
      return jsonResponse(500, {
        error: 'Database read error',
        debug: {
          message: selectError?.message || null,
          code: selectError?.code || null,
          details: selectError?.details || null,
          hint: selectError?.hint || null
        }
      });
    }

    if (existing) {
      const newCount = (existing.comment_count || 1) + 1;

      await db
        .from('participaciones')
        .update({ comment_count: newCount })
        .eq('id', existing.id);

      if (newCount > 2) {
        console.warn(`⚠️ Usuario ${instagramUserId} comentó ${newCount} veces en ${mediaId}`);
      }

      return jsonResponse(200, {
        status: 'already_participated',
        media_id: mediaId,
        instagram_user_id: instagramUserId,
        coupon_code: existing.coupon_code,
        comment_count: newCount,
        message: 'Ya participaste en esta publicación'
      });
    }

    /* ─── NUEVO CUPÓN ─── */
    const discount = generateRandomDiscount();
    const couponCode = generateCouponCode(discount);

    const { error: insertError } = await db
      .from('participaciones')
      .insert({
        instagram_user_id: instagramUserId,
        media_id: mediaId,
        discount_percent: discount,
        coupon_code: couponCode,
        comment_text: commentText,
        matched_keyword: flavorCheck.keyword,
        comment_count: 1,
        user_is_follower: isFollower,
        redeemed: false,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });

    if (insertError) {
      if (insertError.code === '23505') {
        return jsonResponse(200, { status: 'already_participated' });
      }
      console.error('Supabase insert error:', insertError);
      return jsonResponse(500, { error: 'Database write error' });
    }

    /* ─── ENVÍO DE DM ─── */
    const dmResult = await sendInstagramDM(instagramUserId, couponCode, discount, commentText);

    return jsonResponse(200, {
      status: 'coupon_generated',
      media_id: mediaId,
      instagram_user_id: instagramUserId,
      discount_percent: discount,
      coupon_code: couponCode,
      matched_keyword: flavorCheck.keyword,
      user_is_follower: isFollower,
      dm_sent: !!dmResult,
      message: buildCouponMessage(couponCode, discount)
    });

  } catch (error) {
    console.error('Webhook unexpected error:', error);
    return jsonResponse(500, {
      error: 'Internal server error',
      debug: {
        name: error?.name || 'Error',
        message: error?.message || 'Sin mensaje',
        code: error?.code || null,
        details: error?.details || null,
        hint: error?.hint || null,
        stack_preview: (error?.stack || '').split('\n').slice(0, 4).join(' | ')
      }
    });
  }

  function jsonResponse(statusCode, payload) {
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
  }
};