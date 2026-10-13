/* ═══════════════════════════════════════════════════════════════
   Instagram Webhook — Sistema de cupones vía comentarios
   ───────────────────────────────────────────────────────────────
   Reglas de negocio:
   1. Solo comentarios con sabor/adjetivo válido
   2. Solo en la última publicación
   3. 1 cupón por usuario por publicación
   4. Máx 2 comentarios por usuario por post (tracking)
   5. Descuento real: 9-15% (no revelado al usuario)
   6. Redimible solo por WhatsApp
   7. Invitación a seguir en el DM
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

/* ── Credenciales ── */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || '';
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID || '';
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '+573208209369';

/* ═══════════════════════════════════════════════════════════════
   DICCIONARIO DE SABORES Y ADJETIVOS
   ═══════════════════════════════════════════════════════════════ */
const FLAVOR_KEYWORDS = [
  /* Sabores principales */
  'maracuya', 'uva', 'uvas', 'almendra', 'almendras',
  'frutos rojos', 'frambuesa', 'frambuesas', 'fresa', 'fresas',
  'mora', 'moras', 'arandano', 'arandanos', 'cereza', 'cerezas',
  'mani', 'cacahuate', 'sal marina', 'salado', 'salada',

  /* Chocolate base */
  'chocolate', 'cacao', 'chocolate negro', 'chocolate amargo',
  'chocolate oscuro', 'chocolate blanco', 'chocolate con leche',

  /* Frutas tropicales */
  'mango', 'pina', 'papaya', 'guanabana', 'lulo', 'feijoa',
  'guayaba', 'curuba', 'granadilla', 'coco', 'banano', 'platano',
  'limon', 'naranja', 'mandarina', 'toronja', 'kiwi',
  'durazno', 'melocoton', 'manzana', 'pera', 'sandia', 'melon',

  /* Frutos secos */
  'avellana', 'avellanas', 'nuez', 'nueces', 'pistacho', 'pistachos',
  'castana', 'castanas', 'macadamia', 'pecana', 'pecanas',

  /* Dulces y postres */
  'caramelo', 'dulce de leche', 'arequipe', 'nutella', 'vainilla',
  'cafe', 'moka', 'mocha', 'tiramisu', 'cheesecake', 'brownie',
  'galleta', 'galletas', 'oreo', 'chicle', 'marshmallow',

  /* Bebidas */
  'baileys', 'whisky', 'whiskey', 'ron', 'vino', 'champagne',
  'champana', 'tequila', 'vodka', 'licor',

  /* Especias y aromas */
  'canela', 'menta', 'lavanda', 'jengibre', 'cardamomo',
  'pimienta', 'nuez moscada', 'cayena', 'chile', 'picante',

  /* Adjetivos descriptores */
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
 * El usuario cree que puede ser 1-15 pero el sistema garantiza 9-15.
 */
function generateRandomDiscount() {
  return Math.floor(Math.random() * 7) + 9; // 9, 10, 11, 12, 13, 14 o 15
}

function generateCouponCode(discount) {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PROMO${discount}X${randomPart}`;
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

/**
 * Obtiene el ID de la última publicación.
 */
async function getLatestMediaId() {
  if (!META_PAGE_ACCESS_TOKEN || !IG_BUSINESS_ACCOUNT_ID) return null;

  try {
    const url = `https://graph.facebook.com/v21.0/${IG_BUSINESS_ACCOUNT_ID}/media?fields=id,timestamp&limit=1&access_token=${META_PAGE_ACCESS_TOKEN}`;
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

/**
 * Soft check: intenta verificar si el usuario es follower.
 * Retorna true | false | null (null = desconocido)
 *
 * ⚠️ NOTA: Meta tiene restricciones de privacidad que impiden
 * verificar followers individualmente con las APIs públicas.
 * Implementamos best-effort y el asesor valida manualmente en WhatsApp.
 */
async function checkUserIsFollower(userId) {
  /* TODO: Implementar cuando Meta apruebe el permiso instagram_manage_insights.
     Por ahora retornamos null (desconocido) y procedemos con el cupón.
     El asesor verifica visualmente al redimir en WhatsApp. */
  return null;
}

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY');
  }
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
}

/**
 * Genera el mensaje del cupón según las reglas.
 */
function buildCouponMessage(couponCode, discount) {
  return (
    `🎉 ¡Ganaste el Cupón *${couponCode}* con *${discount}% de descuento*! Felicitaciones.\n\n` +
    `📋 *Políticas de redención:*\n` +
    `• Participaste en el sorteo de descuentos del 1% al 15%.\n` +
    `• Válido únicamente presentándolo por WhatsApp al momento de la compra.\n` +
    `• Aplica sobre el total de la compra.\n` +
    `• Exclusivo para seguidores de la página de Instagram.\n` +
    `• Un cupón por persona por publicación.\n` +
    `• Válido por 30 días desde su emisión.\n\n` +
    `📱 Redímelo aquí: ${WHATSAPP_NUMBER}\n\n` +
    `✨ Sigue atento a más participaciones.`
  );
}

/**
 * ⚠️ TODO: Enviar DM vía Meta Graph API.
 * Requiere META_PAGE_ACCESS_TOKEN con permiso instagram_manage_messages.
 */
async function sendInstagramDM(instagramUserId, couponCode, discount, commentText) {
  const messageText = buildCouponMessage(couponCode, discount);

  /* Descomentar cuando Meta apruebe el permiso:
  try {
    const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${META_PAGE_ACCESS_TOKEN}`;
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
    if (!res.ok) console.error('Meta API error:', data);
    return data;
  } catch (err) {
    console.error('Error enviando DM:', err);
    return null;
  }
  */

  console.log(`[TODO DM] → ${instagramUserId}\n${messageText}`);
  return { wouldSend: messageText };
}

/* ═══════════════════════════════════════════════════════════════
   Handler principal
   ═══════════════════════════════════════════════════════════════ */

exports.handler = async (event) => {
  /* Handshake GET de Meta */
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

    /* ──────── VALIDACIÓN 1: SABOR ──────── */
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

    /* ──────── VALIDACIÓN 2: ÚLTIMA PUBLICACIÓN ──────── */
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

    /* ──────── VALIDACIÓN 3: FOLLOWER (soft) ──────── */
    const isFollower = await checkUserIsFollower(instagramUserId);
    // null = desconocido → procedemos igual y el asesor valida en WhatsApp
    // false = definitivamente no es follower → podríamos bloquear (no implementado aún)

    /* ──────── ANTI-SPAM: 1 CUPÓN POR USUARIO POR POST ──────── */
    const db = getSupabase();
    const { data: existing, error: selectError } = await db
      .from('participaciones')
      .select('id, coupon_code, discount_percent, comment_count')
      .eq('instagram_user_id', instagramUserId)
      .eq('media_id', mediaId)
      .maybeSingle();

    if (selectError) {
      console.error('Supabase select error:', selectError);
      return jsonResponse(500, { error: 'Database read error' });
    }

    /* Si ya existe: incrementar contador de comentarios */
    if (existing) {
      const newCount = (existing.comment_count || 1) + 1;

      await db
        .from('participaciones')
        .update({ comment_count: newCount })
        .eq('id', existing.id);

      /* Si supera los 2 comentarios, log de spam */
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

    /* ──────── NUEVO CUPÓN ──────── */
    const discount = generateRandomDiscount(); // 9-15
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

    /* ──────── ENVÍO DE DM ──────── */
    const dmResult = await sendInstagramDM(instagramUserId, couponCode, discount, commentText);

    /* ──────── RESPUESTA ──────── */
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
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}