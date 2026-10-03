exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { token } = JSON.parse(event.body);
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Token faltante' }) };
    }

    const SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
    if (!SECRET_KEY) {
      console.error('SECRET_KEY no configurada');
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Config incompleta' }) };
    }

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${SECRET_KEY}&response=${token}`
    });

    const data = await response.json();
    const isHuman = data.success && data.score >= 0.5;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: isHuman, score: data.score, action: data.action })
    };
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Error interno' }) };
  }
};