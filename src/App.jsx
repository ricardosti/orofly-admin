import { AuthProvider, useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import AdminPanel from './pages/AdminPanel'

function AppRouter() {
  const { user, profile, loading, signOut } = useAuth()

  if (loading) return (
    <div style={{minHeight:'100vh',background:'#111a14',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12}}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      <div style={{fontFamily:"'Syne',sans-serif",color:'#8aad94',fontSize:14,letterSpacing:1}}>OROFLY</div>
    </div>
  )

  if (!user || !profile) return <LoginPage />

  if (profile.role !== 'admin') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f4f8f5'}}>
      <div style={{textAlign:'center',padding:32}}>
        <div style={{fontSize:40,marginBottom:12}}>🔒</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:600,color:'#111a14'}}>Acesso restrito</div>
        <div style={{color:'#6b8070',marginTop:8,fontSize:14}}>Este painel é exclusivo para administradores.</div>
        <button style={{marginTop:20,background:'#1a7a4a',color:'#fff',border:'none',borderRadius:10,padding:'10px 24px',cursor:'pointer',fontFamily:"'Syne',sans-serif",fontWeight:600}} onClick={signOut}>Sair</button>
      </div>
    </div>
  )

  return <AdminPanel />
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  )
}
