const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  // Usa a service_role key — só disponível no servidor, nunca exposta ao cliente
  const supabaseAdmin = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  try {
    const { nome, email, senha, role } = JSON.parse(event.body)

    // Cria o usuário no Auth
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senha,
      user_metadata: { nome, role },
      email_confirm: true,
    })

    if (error) throw error

    // Garante que o perfil foi criado corretamente
    await supabaseAdmin.from('profiles').upsert({
      id: data.user.id,
      nome,
      email,
      role: role || 'piloto',
      ativo: true,
    })

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, userId: data.user.id })
    }
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: err.message })
    }
  }
}
