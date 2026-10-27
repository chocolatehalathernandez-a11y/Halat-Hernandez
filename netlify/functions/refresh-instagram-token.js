/* ═══════════════════════════════════════════════════════════════
   Refresh Instagram Access Token
   Ejecutado automáticamente por cron cada 50 días.
   Renueva el token antes de que expire (60 días).
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const CURRENT_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

exports.handler = async (event) => {
  console.log('🔄 Iniciando renovación de token de Instagram...');

  if (!CURRENT_TOKEN) {
    return jsonResponse(500, { error: 'INSTAGRAM_ACCESS_TOKEN no configurado' });
  }

  try {
    const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${CURRENT_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || !data.access_token) {
      console.error('❌ Error renovando token:', data);
      return jsonResponse(500, {
        error: 'No se pudo renovar el token',
        details: data
      });
    }

    const newToken = data.access_token;
    const expiresIn = data.expires_in; // ~5183944 segundos (60 días)

    console.log(`✅ Token renovado. Expira en ${Math.floor(expiresIn / 86400)} días`);

    /* Opcional: guardar en Supabase para auditoría */
    try {
      const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

      await db.from('token_refresh_log').insert({
        refreshed_at: new Date().toISOString(),
        expires_in_days: Math.floor(expiresIn / 86400),
        success: true
      });
    } catch (dbErr) {
      console.warn('No se pudo guardar log en Supabase:', dbErr.message);
    }

    /* ⚠️ ACCIÓN REQUERIDA: Actualizar la variable en Netlify manualmente
       (Netlify no permite actualizar env vars desde código por seguridad) */
    console.log('⚠️ ACCIÓN: Actualizar INSTAGRAM_ACCESS_TOKEN en Netlify con:');
    console.log(newToken.substring(0, 20) + '...');

    return jsonResponse(200, {
      success: true,
      expires_in_days: Math.floor(expiresIn / 86400),
      new_token_preview: newToken.substring(0, 20) + '...',
      message: 'Token renovado. Actualiza INSTAGRAM_ACCESS_TOKEN en Netlify.'
    });

  } catch (err) {
    console.error('❌ Error:', err);
    return jsonResponse(500, { error: 'Error interno', message: err.message });
  }
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}