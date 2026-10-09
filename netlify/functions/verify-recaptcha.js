exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' })
    };
  }

  try {
    const { token } = JSON.parse(event.body || '{}');

    if (!token || typeof token !== 'string') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Token faltante o inválido' })
      };
    }

    const SECRET_KEY = process.env.RECAPTCHA_V2_SECRET;
    if (!SECRET_KEY) {
      console.error('RECAPTCHA_V2_SECRET no configurada');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Config incompleta' })
      };
    }

    const params = new URLSearchParams();
    params.append('secret', SECRET_KEY);
    params.append('response', token);

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await response.json();

    const isHuman = data.success === true;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        success: isHuman,
        'error-codes': data['error-codes'] || []
      })
    };
  } catch (error) {
    console.error('Error verify-recaptcha:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Error interno' })
    };
  }
};