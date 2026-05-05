import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await signIn(email, password)
    if (error) setError('E-mail ou senha incorretos.')
    setLoading(false)
  }

  return (
    <div style={s.bg}>
      <div style={s.left}>
        <div style={s.brand}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <span style={s.brandName}>Orofly<span style={{color:'#f0c040'}}>.</span></span>
        </div>
        <div style={s.tagline}>Painel de Gestão de Operações de Drone</div>
        <div style={s.features}>
          {['📋 Relatórios em tempo real','👥 Gestão de pilotos','📊 Filtros avançados','📄 Exportação em PDF'].map(f=>(
            <div key={f} style={s.featureItem}>{f}</div>
          ))}
        </div>
      </div>
      <div style={s.right}>
        <div style={s.card}>
          <div style={s.cardTitle}>Acesso ao Painel</div>
          <div style={s.cardSub}>Somente administradores</div>
          <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:16}}>
            <div>
              <div style={s.label}>E-MAIL</div>
              <input style={s.input} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@orofly.com.br" required autoFocus />
            </div>
            <div>
              <div style={s.label}>SENHA</div>
              <input style={s.input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            {error && <div style={s.error}>{error}</div>}
            <button style={{...s.btn, opacity:loading?.7:1}} type="submit" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
              <div style={s.btnLine}/>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

const s = {
  bg:{minHeight:'100vh',display:'flex',background:'#111a14'},
  left:{flex:1,padding:'60px 48px',display:'flex',flexDirection:'column',justifyContent:'center',background:'#111a14'},
  brand:{display:'flex',alignItems:'center',gap:12,marginBottom:16},
  brandName:{fontFamily:"'Syne',sans-serif",fontSize:32,fontWeight:700,color:'#fff',letterSpacing:-1},
  tagline:{fontSize:16,color:'#8aad94',marginBottom:48,lineHeight:1.6,maxWidth:380},
  features:{display:'flex',flexDirection:'column',gap:14},
  featureItem:{fontSize:14,color:'#c8eed8',display:'flex',alignItems:'center',gap:8},
  right:{width:480,background:'#f4f8f5',display:'flex',alignItems:'center',justifyContent:'center',padding:40},
  card:{background:'#fff',borderRadius:20,border:'1px solid #d0e4d8',padding:'40px 36px',width:'100%',boxShadow:'0 4px 32px rgba(26,122,74,0.08)'},
  cardTitle:{fontFamily:"'Syne',sans-serif",fontSize:24,fontWeight:700,color:'#111a14',marginBottom:4},
  cardSub:{fontSize:13,color:'#6b8070',marginBottom:32},
  label:{fontSize:11,fontWeight:600,color:'#6b8070',letterSpacing:1,marginBottom:6,fontFamily:"'Syne',sans-serif"},
  input:{width:'100%',border:'1px solid #d0e4d8',borderRadius:10,padding:'12px 14px',fontSize:15,fontFamily:"'DM Sans',sans-serif",outline:'none',color:'#111a14',background:'#f4f8f5'},
  error:{background:'#fef2f2',color:'#c0392b',borderRadius:8,padding:'10px 14px',fontSize:13},
  btn:{background:'#111a14',color:'#fff',border:'none',borderRadius:12,padding:'14px',fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:600,cursor:'pointer',position:'relative',overflow:'hidden',width:'100%'},
  btnLine:{position:'absolute',bottom:0,left:0,right:0,height:3,background:'#f0c040'},
}
