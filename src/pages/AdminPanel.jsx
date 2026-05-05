import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { gerarPDFRelatorio } from '../lib/pdf'

const STATUS_LABEL = { rascunho:'Rascunho', em_operacao:'Em operação', pausado:'Pausado', finalizado:'Finalizado' }
const STATUS_COLOR = { rascunho:'#6b8070', em_operacao:'#1a7a4a', pausado:'#e8a020', finalizado:'#185fa5' }
const STATUS_BG    = { rascunho:'#f4f8f5', em_operacao:'#e8f5ee', pausado:'#fdf3e0', finalizado:'#e6f1fb' }
const COND_KEYS    = ['faixa','vazao','vento','umidade','temperatura','delta_t']
const COND_LABELS  = ['Faixa','Vazão','Vento','Umidade','Temperatura','Delta T']

export default function AdminPanel() {
  const { profile, signOut } = useAuth()
  const [tab, setTab] = useState('relatorios')
  const [relatorios, setRelatorios] = useState([])
  const [pilotos, setPilotos] = useState([])
  const [voosPorPiloto, setVoosPorPiloto] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [editModal, setEditModal] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [filters, setFilters] = useState({ cliente:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [criandoUser, setCriandoUser] = useState(false)

  const showToast = useCallback((msg, type='success') => {
    setToast({msg, type})
    setTimeout(()=>setToast(''), 3000)
  }, [])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: rels }, usersRes] = await Promise.all([
      supabase.from('relatorios').select('*, profiles(nome,email)').order('created_at', { ascending: false }),
      fetch('/api/list-users')
    ])
    const rs = rels || []
    setRelatorios(rs)
    if (usersRes.ok) {
      const data = await usersRes.json()
      setPilotos(data.users || [])
    }
    const counts = {}
    rs.forEach(r => { counts[r.piloto_id] = (counts[r.piloto_id]||0) + 1 })
    setVoosPorPiloto(counts)
    setLoading(false)
  }

  const filtered = relatorios.filter(r => {
    if (filters.cliente && !r.cliente?.toLowerCase().includes(filters.cliente.toLowerCase())) return false
    if (filters.piloto && !r.piloto_nome?.toLowerCase().includes(filters.piloto.toLowerCase())) return false
    if (filters.drone && !r.drone?.toLowerCase().includes(filters.drone.toLowerCase())) return false
    if (filters.status && r.status !== filters.status) return false
    if (filters.dataIni && new Date(r.created_at) < new Date(filters.dataIni)) return false
    if (filters.dataFim && new Date(r.created_at) > new Date(filters.dataFim+'T23:59:59')) return false
    return true
  })

  function calcTempo(ini, fim, pausaIni, pausaFim) {
    if (!ini || !fim) return null
    const totalMin = Math.round((new Date(fim) - new Date(ini)) / 60000)
    if (totalMin <= 0) return null
    let pausaMin = 0
    if (pausaIni && pausaFim) pausaMin = Math.max(0, Math.round((new Date(pausaFim) - new Date(pausaIni)) / 60000))
    const fmt = m => { const h=Math.floor(m/60),min=m%60; return h>0?`${h}h${String(min).padStart(2,'0')}m`:`${min}m` }
    return { total: fmt(totalMin), efetivo: fmt(totalMin-pausaMin), temPausa: pausaMin>0 }
  }

  const [editFotoMapa, setEditFotoMapa] = useState(null)
  const [editFotoMapaFile, setEditFotoMapaFile] = useState(null)
  const [editObsFotos, setEditObsFotos] = useState([null,null,null])
  const [editObsFotoFiles, setEditObsFotoFiles] = useState([null,null,null])

  async function salvarEdicao() {
    if (!editModal) return
    setSaving(true)

    // Upload foto mapa se tiver nova
    let fotoMapaUrl = editModal.foto_mapa_url
    if (editFotoMapaFile) {
      const path = `${editModal.piloto_id}/${editModal.id}/mapa.jpg`
      await supabase.storage.from('relatorios').upload(path, editFotoMapaFile, { upsert: true })
      fotoMapaUrl = path
    }

    // Upload fotos obs se tiver novas
    let obsUrls = editModal.obs_fotos_urls || [null,null,null]
    for (let i = 0; i < 3; i++) {
      if (editObsFotoFiles[i]) {
        const path = `${editModal.piloto_id}/${editModal.id}/obs_${i}.jpg`
        await supabase.storage.from('relatorios').upload(path, editObsFotoFiles[i], { upsert: true })
        obsUrls[i] = path
      }
    }

    const { id, profiles, created_at, updated_at, ...campos } = editModal
    const { error } = await supabase.from('relatorios').update({
      ...campos,
      foto_mapa_url: fotoMapaUrl,
      obs_fotos_urls: obsUrls
    }).eq('id', id)

    if (error) { showToast('Erro ao salvar: '+error.message, 'error'); setSaving(false); return }
    showToast('✅ Relatório salvo!')
    setEditModal(null); setSelected(null)
    setEditFotoMapa(null); setEditFotoMapaFile(null)
    setEditObsFotos([null,null,null]); setEditObsFotoFiles([null,null,null])
    fetchAll(); setSaving(false)
  }

  async function deletarRelatorio(id) {
    const { error } = await supabase.from('relatorios').delete().eq('id', id)
    if (error) { showToast('Erro ao deletar', 'error'); return }
    showToast('🗑️ Relatório deletado')
    setConfirmDelete(null); setSelected(null); fetchAll()
  }

  async function toggleAtivo(piloto) {
    try {
      const res = await fetch('/api/toggle-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: piloto.id, ativo: !piloto.ativo })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      showToast(piloto.ativo ? '⛔ Usuário desativado' : '✅ Usuário ativado')
      fetchAll()
    } catch (err) {
      showToast('Erro: ' + err.message, 'error')
    }
  }

  async function baixarPDF(rel) {
    showToast('⏳ Gerando PDF...')
    // Recarrega do banco para garantir foto_mapa_url e obs_fotos_urls atualizados
    const { data: relAtual } = await supabase
      .from('relatorios').select('*').eq('id', rel.id).single()
    const relFinal = relAtual || rel
    const doc = await gerarPDFRelatorio(relFinal, { supabase })
    doc.save(`relatorio-orofly-${relFinal.cliente?.replace(/\s+/g,'-').toLowerCase()}-${new Date(relFinal.created_at).toLocaleDateString('pt-BR').replace(/\//g,'-')}.pdf`)
    showToast('✅ PDF baixado!')
  }

  async function criarUsuario(e) {
    e.preventDefault()
    if (!newUser.nome || !newUser.email || !newUser.senha) { showToast('⚠️ Preencha todos os campos','error'); return }
    if (newUser.senha.length < 6) { showToast('⚠️ Senha mínima 6 caracteres','error'); return }
    setCriandoUser(true)
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { throw new Error('Função não encontrada no servidor.') }
      if (data.error) throw new Error(data.error)
      showToast('✅ Usuário criado com sucesso!')
      setNewUser({ nome:'', email:'', senha:'', role:'piloto' })
      fetchAll()
    } catch (err) { showToast('Erro: '+err.message, 'error') }
    setCriandoUser(false)
  }

  const fmt = v => v ? new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'

  return (
    <div style={s.shell}>
      <style>{`
        @media (max-width: 768px) {
          .orofly-sidebar { display: none !important; }
          .orofly-mobile-header { display: flex !important; }
          .orofly-page { padding: 12px !important; }
          .orofly-filter-bar { flex-direction: column !important; }
          .orofly-filter-bar input, .orofly-filter-bar select { min-width: 0 !important; width: 100% !important; }
          .orofly-table-wrap { overflow-x: auto !important; font-size: 11px !important; }
          .orofly-table th, .orofly-table td { padding: 8px !important; font-size: 11px !important; }
          .orofly-detail-row { flex-direction: column !important; }
          .orofly-users-layout { flex-direction: column !important; }
          .orofly-create-card { width: 100% !important; }
          .orofly-modal { border-radius: 0 !important; width: 100vw !important; max-width: 100vw !important; max-height: 100vh !important; height: 100vh !important; }
          .orofly-modal-grid { grid-template-columns: 1fr 1fr !important; }
          .orofly-cond-grid { grid-template-columns: 1fr 1fr !important; }
          .orofly-main { flex-direction: column !important; }
        }
        @media (min-width: 769px) {
          .orofly-mobile-header { display: none !important; }
          .orofly-main { flex-direction: row !important; }
        }
      `}</style>
      <div className="orofly-mobile-header" style={s.mobileHeader}>
        <div style={s.logo}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <span style={s.logoTxt}>Orofly<span style={{color:'#f0c040'}}>.</span></span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{display:'flex',gap:8}}>
            <button style={{...s.navBtn,...(tab==='relatorios'?{color:'#fff',background:'#1a3a22'}:{})}} onClick={()=>{setTab('relatorios');setMobileMenuOpen(false)}}>📋</button>
            <button style={{...s.navBtn,...(tab==='pilotos'?{color:'#fff',background:'#1a3a22'}:{})}} onClick={()=>{setTab('pilotos');setMobileMenuOpen(false)}}>👥</button>
          </div>
          <button style={{background:'transparent',border:'1px solid #2d4a38',color:'#8aad94',borderRadius:8,padding:'6px 10px',cursor:'pointer',fontSize:12}} onClick={signOut}>Sair</button>
        </div>
      </div>

      {/* SIDEBAR DESKTOP */}
      <aside className="orofly-sidebar" style={s.sidebar}>
        <div style={s.sidebarTop}>
          <div style={s.logo}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            <span style={s.logoTxt}>Orofly<span style={{color:'#f0c040'}}>.</span></span>
          </div>
          <div style={s.logoSub}>Painel Admin</div>
        </div>

        <nav style={s.nav}>
          {[
            ['relatorios','📋','Relatórios', filtered.length],
            ['pilotos','👥','Usuários', pilotos.length],
          ].map(([id,icon,label,count])=>(
            <button key={id} style={{...s.navBtn,...(tab===id?s.navBtnActive:{})}} onClick={()=>setTab(id)}>
              <span style={{fontSize:16}}>{icon}</span>
              <span style={{flex:1,textAlign:'left'}}>{label}</span>
              <span style={{...s.navCount,...(tab===id?{background:'#f0c040',color:'#111a14'}:{})}}>{count}</span>
            </button>
          ))}
        </nav>

        {/* STATS */}
        <div style={s.sideStats}>
          <div style={s.statItem}><span style={s.statVal}>{relatorios.filter(r=>r.status==='em_operacao').length}</span><span style={s.statLbl}>Em voo</span></div>
          <div style={s.statItem}><span style={{...s.statVal,color:'#e8a020'}}>{relatorios.filter(r=>r.status==='pausado').length}</span><span style={s.statLbl}>Pausados</span></div>
          <div style={s.statItem}><span style={{...s.statVal,color:'#185fa5'}}>{relatorios.filter(r=>r.status==='finalizado').length}</span><span style={s.statLbl}>Finalizados</span></div>
        </div>

        <div style={s.sidebarBottom}>
          <div style={s.userChip}>
            <div style={s.userAvatar}>{profile?.nome?.[0]?.toUpperCase()}</div>
            <div>
              <div style={{fontSize:13,fontWeight:500,color:'#fff'}}>{profile?.nome}</div>
              <div style={{fontSize:11,color:'#8aad94'}}>Admin</div>
            </div>
          </div>
          <button style={s.logoutBtn} onClick={signOut}>Sair</button>
          <div style={{textAlign:'center',fontSize:10,color:'#2d4a38',marginTop:10,letterSpacing:1}}>v1.16</div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="orofly-main" style={{...s.main}} >

        {/* RELATÓRIOS */}
        {tab==='relatorios' && (
          <div className="orofly-page" style={s.page}>
            <div style={s.pageHeader}>
              <div>
                <div style={s.pageTitle}>Relatórios de Voo</div>
                <div style={s.pageSub}>{filtered.length} de {relatorios.length} relatórios</div>
              </div>
            </div>

            {/* FILTROS */}
            <div className="orofly-filter-bar" style={s.filterBar}>
              <input style={s.filterInput} placeholder="🔍 Cliente..." value={filters.cliente} onChange={e=>setFilters(f=>({...f,cliente:e.target.value}))} />
              <input style={s.filterInput} placeholder="🔍 Piloto..." value={filters.piloto} onChange={e=>setFilters(f=>({...f,piloto:e.target.value}))} />
              <input style={s.filterInput} placeholder="🔍 Drone..." value={filters.drone} onChange={e=>setFilters(f=>({...f,drone:e.target.value}))} />
              <select style={s.filterInput} value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))}>
                <option value="">Todos os status</option>
                <option value="em_operacao">🟢 Em operação</option>
                <option value="pausado">🟡 Pausado</option>
                <option value="finalizado">✅ Finalizado</option>
                <option value="rascunho">Rascunho</option>
              </select>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,color:'#6b8070',whiteSpace:'nowrap'}}>De:</span>
                <input type="date" style={s.filterInput} value={filters.dataIni} onChange={e=>setFilters(f=>({...f,dataIni:e.target.value}))} />
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,color:'#6b8070',whiteSpace:'nowrap'}}>Até:</span>
                <input type="date" style={s.filterInput} value={filters.dataFim} onChange={e=>setFilters(f=>({...f,dataFim:e.target.value}))} />
              </div>
              {(filters.cliente||filters.piloto||filters.drone||filters.status||filters.dataIni||filters.dataFim) && (
                <button style={s.clearBtn} onClick={()=>setFilters({cliente:'',piloto:'',drone:'',status:'',dataIni:'',dataFim:''})}>✕ Limpar</button>
              )}
            </div>

            {/* TABELA */}
            {loading ? <div style={s.empty}>Carregando...</div> : filtered.length===0 ? (
              <div style={s.empty}>Nenhum relatório encontrado</div>
            ) : (
              <div className="orofly-table-wrap" style={s.tableWrap}>
                <table className="orofly-table" style={s.table}>
                  <thead>
                    <tr style={s.thead}>
                      {['Cliente','Fazenda','Piloto','Drone','Status','Data','Tempo','Ações'].map(h=>(
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((rel,i)=>{
                      const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausa_inicio, rel.pausa_fim)
                      const isSelected = selected?.id===rel.id
                      return <>
                        <tr key={rel.id} style={{...s.tr,...(i%2===0?{background:'#fff'}:{background:'#f9fbfa'}),...(isSelected?{background:'#e8f5ee'}:{})}}
                          onClick={()=>setSelected(isSelected?null:rel)}>
                          <td style={{...s.td,fontWeight:600}}>{rel.cliente||'—'}</td>
                          <td style={s.td}>{rel.fazenda||'—'}</td>
                          <td style={s.td}>{rel.piloto_nome||'—'}</td>
                          <td style={s.td}>{rel.drone||'—'}</td>
                          <td style={s.td}>
                            <span style={{...s.statusPill,background:STATUS_BG[rel.status],color:STATUS_COLOR[rel.status]}}>
                              {STATUS_LABEL[rel.status]}
                            </span>
                          </td>
                          <td style={s.td}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}</td>
                          <td style={s.td}>
                            {tempo ? <span style={{fontSize:12}}>{tempo.total}{tempo.temPausa?<span style={{color:'#6b8070'}}> / {tempo.efetivo}</span>:''}</span> : '—'}
                          </td>
                          <td style={{...s.td,whiteSpace:'nowrap'}}>
                            <button style={s.iconBtn} title="Editar" onClick={e=>{e.stopPropagation();setEditModal({...rel})}}>✏️</button>
                            <button style={s.iconBtn} title="PDF" onClick={e=>{e.stopPropagation();baixarPDF(rel)}}>📄</button>
                            {rel.gps_lat&&<a style={{...s.iconBtn,textDecoration:'none'}} title="Maps" href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>🗺️</a>}
                            <button style={{...s.iconBtn,color:'#c0392b'}} title="Deletar" onClick={e=>{e.stopPropagation();setConfirmDelete(rel)}}>🗑️</button>
                          </td>
                        </tr>
                        {/* DETALHE EXPANDIDO */}
                        {isSelected && (
                          <tr key={rel.id+'-detail'}>
                            <td colSpan={8} style={{padding:'0 0 0 0',background:'#f0f8f4',borderBottom:'2px solid #d0e4d8'}}>
                              <div className="orofly-detail-row" style={s.detailRow}>
                                <DetailCol title="Localização" items={[
                                  ['Local', rel.localizacao],
                                  ['GPS', rel.gps_lat?`${rel.gps_lat}, ${rel.gps_lng}`:'—'],
                                ]} />
                                <DetailCol title="Condições Início" items={COND_KEYS.map((k,i)=>[COND_LABELS[i], rel[k+'_i']])} />
                                <DetailCol title="Condições Fim" items={COND_KEYS.map((k,i)=>[COND_LABELS[i], rel[k+'_f']])} />
                                <DetailCol title="Horários" items={[
                                  ['Início', fmt(rel.dt_inicio)],
                                  ['Fim', fmt(rel.dt_fim)],
                                  ...(tempo?[['Total', tempo.total],...(tempo.temPausa?[['Efetivo',tempo.efetivo]]:[])]:[] ),
                                  ...(rel.pausa?[['Pausa motivo',rel.pausa_motivo],['Pausa início',fmt(rel.pausa_inicio)],['Pausa fim',fmt(rel.pausa_fim)]]:[] ),
                                ]} />
                                <DetailCol title="Observações" items={[
                                  ['Obs 1', rel.obs1],
                                  ['Obs 2', rel.obs2],
                                  ...(rel.produtos||[]).map((p,i)=>['Produto '+(i+1),p]),
                                  ...(rel.kml_arquivos||[]).map((f,i)=>['KML '+(i+1),f]),
                                ]} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* USUÁRIOS */}
        {tab==='pilotos' && (
          <div className="orofly-page" style={s.page}>
            <div style={s.pageHeader}>
              <div>
                <div style={s.pageTitle}>Gestão de Usuários</div>
                <div style={s.pageSub}>{pilotos.length} usuários cadastrados</div>
              </div>
            </div>

            <div className="orofly-users-layout" style={s.usersLayout}>
              {/* FORM CRIAR */}
              <div className="orofly-create-card" style={s.createCard}>
                <div style={s.createCardTitle}>+ Novo usuário</div>
                <form onSubmit={criarUsuario} style={{display:'flex',flexDirection:'column',gap:14}}>
                  {[['Nome completo','nome','text','João da Silva'],['E-mail','email','email','piloto@orofly.com'],['Senha inicial','senha','password','Mínimo 6 caracteres']].map(([lbl,key,type,ph])=>(
                    <div key={key}>
                      <div style={s.formLabel}>{lbl.toUpperCase()}</div>
                      <input
                        style={s.formInput}
                        type={type}
                        placeholder={ph}
                        value={newUser[key]}
                        autoComplete="new-password"
                        onChange={e=>setNewUser(u=>({...u,[key]:e.target.value}))}
                      />
                    </div>
                  ))}
                  <div>
                    <div style={s.formLabel}>PERFIL</div>
                    <select style={s.formInput} value={newUser.role} onChange={e=>setNewUser(u=>({...u,role:e.target.value}))}>
                      <option value="piloto">🚁 Piloto</option>
                      <option value="admin">⚙️ Administrador</option>
                    </select>
                  </div>
                  <button type="submit" style={{...s.createBtn,opacity:criandoUser?.6:1}} disabled={criandoUser}>
                    {criandoUser?'Criando...':'Criar usuário'}
                  </button>
                </form>
              </div>

              {/* LISTA USUÁRIOS */}
              <div style={{flex:1}}>
                <table style={s.table}>
                  <thead>
                    <tr style={s.thead}>
                      {['Usuário','E-mail','Perfil','Voos','Status','Ação'].map(h=>(
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pilotos.map((p,i)=>(
                      <tr key={p.id} style={{...s.tr,...(i%2===0?{background:'#fff'}:{background:'#f9fbfa'}),opacity:p.ativo?1:.5}}>
                        <td style={s.td}>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <div style={{...s.avatar,background:p.role==='admin'?'#faeeda':'#e8f5ee',color:p.role==='admin'?'#854f0b':'#1a7a4a'}}>
                              {p.nome?.[0]?.toUpperCase()||'?'}
                            </div>
                            <span style={{fontWeight:500}}>{p.nome}</span>
                          </div>
                        </td>
                        <td style={{...s.td,color:'#6b8070'}}>{p.email}</td>
                        <td style={s.td}>
                          <span style={{...s.rolePill,background:p.role==='admin'?'#faeeda':'#e8f5ee',color:p.role==='admin'?'#854f0b':'#0f6e56'}}>
                            {p.role==='admin'?'⚙️ Admin':'🚁 Piloto'}
                          </span>
                        </td>
                        <td style={{...s.td,textAlign:'center'}}>
                          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:16,color:'#1a7a4a'}}>
                            {voosPorPiloto[p.id]||0}
                          </span>
                        </td>
                        <td style={s.td}>
                          <span style={{...s.statusPill,background:p.ativo?'#e8f5ee':'#fee',color:p.ativo?'#1a7a4a':'#c0392b'}}>
                            {p.ativo?'Ativo':'Inativo'}
                          </span>
                        </td>
                        <td style={s.td}>
                          <button style={{...s.toggleUserBtn,background:p.ativo?'#fee':'#e8f5ee',color:p.ativo?'#c0392b':'#1a7a4a'}} onClick={()=>toggleAtivo(p)}>
                            {p.ativo?'Desativar':'Ativar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL EDITAR */}
      {editModal && (
        <div style={s.modalOverlay} onClick={()=>setEditModal(null)}>
          <div className="orofly-modal" style={s.editModal} onClick={e=>e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>✏️ Editar Relatório</span>
              <button style={s.modalClose} onClick={()=>setEditModal(null)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div className="orofly-modal-grid" style={s.modalGrid}>
                {[['Cliente','cliente'],['Fazenda','fazenda'],['Piloto','piloto_nome'],['Drone','drone'],['Localização','localizacao']].map(([lbl,key])=>(
                  <div key={key}>
                    <div style={s.formLabel}>{lbl.toUpperCase()}</div>
                    <input style={s.formInput} value={editModal[key]||''} onChange={e=>setEditModal(m=>({...m,[key]:e.target.value}))} />
                  </div>
                ))}
                <div>
                  <div style={s.formLabel}>STATUS</div>
                  <select style={s.formInput} value={editModal.status||''} onChange={e=>setEditModal(m=>({...m,status:e.target.value}))}>
                    <option value="rascunho">Rascunho</option>
                    <option value="em_operacao">Em operação</option>
                    <option value="pausado">Pausado</option>
                    <option value="finalizado">Finalizado</option>
                  </select>
                </div>
              </div>

              <div style={{marginTop:20}}>
                <div style={s.editSection}>CONDIÇÕES DE APLICAÇÃO</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10,marginTop:10}}>
                  {COND_KEYS.map((k,i)=>(
                    <div key={k}>
                      <div style={s.formLabel}>{COND_LABELS[i]} INÍCIO</div>
                      <input style={s.formInput} value={editModal[k+'_i']||''} onChange={e=>setEditModal(m=>({...m,[k+'_i']:e.target.value}))} />
                    </div>
                  ))}
                  {COND_KEYS.map((k,i)=>(
                    <div key={k+'f'}>
                      <div style={s.formLabel}>{COND_LABELS[i]} FIM</div>
                      <input style={s.formInput} value={editModal[k+'_f']||''} onChange={e=>setEditModal(m=>({...m,[k+'_f']:e.target.value}))} />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{marginTop:20}}>
                <div style={s.editSection}>PRODUTOS</div>
                <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:10}}>
                  {(editModal.produtos||['']).map((p,i)=>(
                    <div key={i} style={{display:'flex',gap:8}}>
                      <input style={{...s.formInput,flex:1}} placeholder="Produto - dosagem" value={p}
                        onChange={e=>{const arr=[...(editModal.produtos||[])];arr[i]=e.target.value;setEditModal(m=>({...m,produtos:arr}))}} />
                      {(editModal.produtos||[]).length>1 && <button style={{background:'none',border:'none',color:'#c0392b',cursor:'pointer',fontSize:18}} onClick={()=>setEditModal(m=>({...m,produtos:m.produtos.filter((_,j)=>j!==i)}))}>×</button>}
                    </div>
                  ))}
                  <button style={{...s.createBtn,background:'#e8f5ee',color:'#1a7a4a',padding:'8px 14px',fontSize:13}} onClick={()=>setEditModal(m=>({...m,produtos:[...(m.produtos||[]),'']}))}>+ Produto</button>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:20}}>
                <div>
                  <div style={s.formLabel}>OBS 1</div>
                  <textarea style={{...s.formInput,resize:'none',minHeight:70}} value={editModal.obs1||''} onChange={e=>setEditModal(m=>({...m,obs1:e.target.value}))} />
                </div>
                <div>
                  <div style={s.formLabel}>OBS 2</div>
                  <textarea style={{...s.formInput,resize:'none',minHeight:70}} value={editModal.obs2||''} onChange={e=>setEditModal(m=>({...m,obs2:e.target.value}))} />
                </div>
              </div>

              {/* FOTOS */}
              <div style={{marginTop:20}}>
                <div style={s.editSection}>FOTOS</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:12}}>
                  <div>
                    <div style={s.formLabel}>MAPA DE PÓS APLICAÇÃO</div>
                    <label style={{display:'block',border:'1.5px dashed #d0e4d8',borderRadius:10,padding:12,textAlign:'center',cursor:'pointer',marginTop:6,position:'relative',overflow:'hidden'}}>
                      <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{
                        const f=e.target.files[0]; if(!f) return
                        const r=new FileReader(); r.onload=ev=>setEditFotoMapa(ev.target.result); r.readAsDataURL(f)
                        setEditFotoMapaFile(f)
                      }} />
                      {editFotoMapa
                        ? <img src={editFotoMapa} alt="mapa" style={{width:'100%',maxHeight:120,objectFit:'cover',borderRadius:8}} />
                        : editModal.foto_mapa_url
                          ? <ExistingPhoto supabase={supabase} path={editModal.foto_mapa_url} bucket="relatorios" label="Foto do mapa — clique para trocar" />
                          : <div style={{fontSize:12,color:'#6b8070'}}>🗺️ Clique para adicionar</div>
                      }
                    </label>
                  </div>
                  <div>
                    <div style={s.formLabel}>FOTOS DE OBSERVAÇÃO</div>
                    <div style={{display:'flex',gap:8,marginTop:6}}>
                      {[0,1,2].map(i=>(
                        <label key={i} style={{flex:1,border:'1.5px dashed #d0e4d8',borderRadius:10,padding:8,textAlign:'center',cursor:'pointer',position:'relative',overflow:'hidden',minHeight:70,display:'flex',alignItems:'center',justifyContent:'center'}}>
                          <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{
                            const f=e.target.files[0]; if(!f) return
                            const r=new FileReader(); r.onload=ev=>{const arr=[...editObsFotos];arr[i]=ev.target.result;setEditObsFotos(arr)}; r.readAsDataURL(f)
                            const arr=[...editObsFotoFiles];arr[i]=f;setEditObsFotoFiles(arr)
                          }} />
                          {editObsFotos[i]
                            ? <img src={editObsFotos[i]} alt="" style={{width:'100%',height:60,objectFit:'cover',borderRadius:6}} />
                            : (editModal.obs_fotos_urls?.[i]
                              ? <ExistingPhoto supabase={supabase} path={editModal.obs_fotos_urls[i]} bucket="relatorios" label={`F${i+1} ↺`} small />
                              : <span style={{fontSize:16}}>📷</span>)
                          }
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={{...s.createBtn,background:'#f4f8f5',color:'#6b8070',flex:1}} onClick={()=>{setEditModal(null);setEditFotoMapa(null);setEditFotoMapaFile(null);setEditObsFotos([null,null,null]);setEditObsFotoFiles([null,null,null])}}>Cancelar</button>
              <button style={{...s.createBtn,background:'#111a14',flex:1,opacity:saving?.6:1}} disabled={saving} onClick={async()=>{
                showToast('⏳ Gerando PDF...')
                const doc = await gerarPDFRelatorio(editModal, {
                  supabase,
                  localObsFotos: editObsFotos.some(Boolean) ? editObsFotos : null,
                  localFotoMapa: editFotoMapa || null
                })
                doc.save(`relatorio-orofly-${editModal.cliente?.replace(/\s+/g,'-').toLowerCase()}.pdf`)
                showToast('✅ PDF baixado!')
              }}>📄 PDF</button>
              <button style={{...s.createBtn,flex:2,opacity:saving?.6:1}} disabled={saving} onClick={salvarEdicao}>
                {saving?'Salvando...':'💾 Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAR DELETE */}
      {confirmDelete && (
        <div style={s.modalOverlay} onClick={()=>setConfirmDelete(null)}>
          <div style={{...s.editModal,maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>🗑️ Confirmar exclusão</span>
              <button style={s.modalClose} onClick={()=>setConfirmDelete(null)}>✕</button>
            </div>
            <div style={{padding:'24px 28px'}}>
              <p style={{fontSize:15,color:'#111a14',lineHeight:1.6,marginBottom:8}}>
                Deletar o relatório de <strong>{confirmDelete.cliente}</strong>?
              </p>
              <p style={{fontSize:13,color:'#c0392b'}}>Esta ação não pode ser desfeita.</p>
            </div>
            <div style={{...s.modalFooter,gap:10}}>
              <button style={{...s.createBtn,background:'#f4f8f5',color:'#6b8070',flex:1}} onClick={()=>setConfirmDelete(null)}>Cancelar</button>
              <button style={{...s.createBtn,background:'#c0392b',flex:1}} onClick={()=>deletarRelatorio(confirmDelete.id)}>Deletar</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{...s.toast,background:toast.type==='error'?'#c0392b':'#111a14'}}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function ExistingPhoto({ supabase, path, bucket, label, small }) {
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!path) return
    setLoading(true)
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!error && data?.signedUrl) setUrl(data.signedUrl)
      setLoading(false)
    })
  }, [path, bucket, supabase])

  async function handleDownload(e) {
    e.stopPropagation()
    if (!url) return
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = path.split('/').pop() || 'foto.jpg'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { window.open(url, '_blank') }
  }

  if (loading) return <div style={{fontSize:11,color:'#6b8070',padding:'8px 0'}}>⏳ carregando foto...</div>
  if (!url) return <div style={{fontSize:11,color:'#c0392b',padding:'8px 0'}}>⚠️ Foto não encontrada</div>

  return (
    <div style={{position:'relative'}}>
      <img src={url} alt="foto" style={{width:'100%', maxHeight: small?60:130, objectFit:'cover', borderRadius:8, display:'block'}} />
      {!small && (
        <div style={{display:'flex',gap:6,marginTop:6}}>
          <a href={url} target="_blank" rel="noreferrer"
            style={{flex:1,background:'#e8f5ee',color:'#1a7a4a',borderRadius:6,padding:'5px 8px',fontSize:11,textDecoration:'none',textAlign:'center',cursor:'pointer'}}
            onClick={e=>e.stopPropagation()}>
            🔍 Ver
          </a>
          <button
            style={{flex:1,background:'#185fa5',color:'#fff',border:'none',borderRadius:6,padding:'5px 8px',fontSize:11,cursor:'pointer'}}
            onClick={handleDownload}>
            ⬇ Baixar
          </button>
        </div>
      )}
      <div style={{fontSize:10,color:'#6b8070',marginTop:4}}>Clique na área acima para trocar a foto</div>
    </div>
  )
}

function DetailCol({ title, items }) {
  return (
    <div style={{flex:1,minWidth:160}}>
      <div style={{fontSize:10,fontWeight:700,color:'#1a7a4a',letterSpacing:1,marginBottom:8,fontFamily:"'Syne',sans-serif"}}>{title.toUpperCase()}</div>
      {items.map(([l,v])=> v ? (
        <div key={l} style={{display:'flex',gap:6,marginBottom:4,fontSize:12}}>
          <span style={{color:'#6b8070',minWidth:80,flexShrink:0}}>{l}:</span>
          <span style={{color:'#111a14',wordBreak:'break-word'}}>{v}</span>
        </div>
      ) : null)}
    </div>
  )
}

const s = {
  shell:{display:'flex',flexDirection:'column',minHeight:'100vh',background:'#f4f8f5',fontFamily:"'DM Sans',sans-serif"},
  mobileHeader:{background:'#111a14',padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:50},
  sidebar:{width:240,background:'#111a14',display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100vh',flexShrink:0},
  sidebarTop:{padding:'28px 20px 20px'},
  logo:{display:'flex',alignItems:'center',gap:10,marginBottom:4},
  logoTxt:{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:700,color:'#fff',letterSpacing:-0.5},
  logoSub:{fontSize:11,color:'#4a6e56',letterSpacing:1,fontFamily:"'Syne',sans-serif"},
  nav:{padding:'8px 12px',flex:1},
  navBtn:{display:'flex',alignItems:'center',gap:10,width:'100%',background:'transparent',border:'none',borderRadius:10,padding:'10px 12px',cursor:'pointer',color:'#8aad94',fontSize:13,fontFamily:"'DM Sans',sans-serif",fontWeight:500,marginBottom:4},
  navBtnActive:{background:'#1a3a22',color:'#fff'},
  navCount:{background:'#1e3828',color:'#6b8070',fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:20,fontFamily:"'Syne',sans-serif"},
  sideStats:{padding:'12px 20px',borderTop:'1px solid #1e3828',borderBottom:'1px solid #1e3828',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8},
  statItem:{textAlign:'center'},
  statVal:{display:'block',fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:700,color:'#2da05e'},
  statLbl:{display:'block',fontSize:10,color:'#4a6e56',marginTop:2},
  sidebarBottom:{padding:'16px 20px'},
  userChip:{display:'flex',alignItems:'center',gap:10,marginBottom:12},
  userAvatar:{width:32,height:32,borderRadius:'50%',background:'#1a7a4a',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:14,fontFamily:"'Syne',sans-serif",flexShrink:0},
  logoutBtn:{width:'100%',background:'transparent',border:'1px solid #1e3828',color:'#4a6e56',borderRadius:8,padding:'8px',fontSize:12,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"},
  main:{flex:1,overflow:'auto',display:'flex',flexDirection:'column'},
  page:{padding:'24px 28px',maxWidth:1400,width:'100%'},
  pageHeader:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24},
  pageTitle:{fontFamily:"'Syne',sans-serif",fontSize:24,fontWeight:700,color:'#111a14'},
  pageSub:{fontSize:13,color:'#6b8070',marginTop:4},
  filterBar:{display:'flex',gap:10,flexWrap:'wrap',marginBottom:20,background:'#fff',padding:'16px',borderRadius:12,border:'1px solid #d0e4d8',alignItems:'center'},
  filterInput:{border:'1px solid #d0e4d8',borderRadius:8,padding:'8px 12px',fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:'none',color:'#111a14',background:'#f4f8f5',minWidth:140},
  clearBtn:{background:'none',border:'1px solid #e0b0a8',color:'#c0392b',borderRadius:8,padding:'8px 14px',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'},
  tableWrap:{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',overflow:'hidden'},
  table:{width:'100%',borderCollapse:'collapse'},
  thead:{background:'#f4f8f5'},
  th:{padding:'12px 16px',textAlign:'left',fontSize:11,fontWeight:700,color:'#6b8070',letterSpacing:0.5,fontFamily:"'Syne',sans-serif",borderBottom:'1px solid #d0e4d8',whiteSpace:'nowrap'},
  tr:{cursor:'pointer',transition:'background .1s','&:hover':{background:'#f9fbfa'}},
  td:{padding:'12px 16px',fontSize:13,color:'#111a14',borderBottom:'1px solid #f0f4f1',verticalAlign:'middle'},
  statusPill:{display:'inline-block',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:20},
  iconBtn:{background:'none',border:'none',cursor:'pointer',fontSize:16,padding:'4px',borderRadius:6},
  detailRow:{display:'flex',gap:24,padding:'20px 24px'},
  usersLayout:{display:'flex',gap:24,alignItems:'flex-start'},
  createCard:{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:'24px',width:300,flexShrink:0},
  createCardTitle:{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,color:'#111a14',marginBottom:20},
  formLabel:{fontSize:11,fontWeight:600,color:'#6b8070',letterSpacing:0.5,marginBottom:5,fontFamily:"'Syne',sans-serif"},
  formInput:{width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'10px 12px',fontSize:14,fontFamily:"'DM Sans',sans-serif",outline:'none',color:'#111a14',background:'#f4f8f5',appearance:'none'},
  createBtn:{background:'#1a7a4a',color:'#fff',border:'none',borderRadius:10,padding:'12px',fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:600,cursor:'pointer',width:'100%'},
  avatar:{width:34,height:34,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:15,fontFamily:"'Syne',sans-serif",flexShrink:0},
  rolePill:{display:'inline-block',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:20},
  toggleUserBtn:{border:'none',borderRadius:8,padding:'6px 14px',fontSize:12,fontWeight:500,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"},
  modalOverlay:{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:24},
  editModal:{background:'#fff',borderRadius:16,width:'100%',maxWidth:860,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,.15)'},
  modalHeader:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 28px',borderBottom:'1px solid #f0f4f1'},
  modalTitle:{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:700,color:'#111a14'},
  modalClose:{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#6b8070'},
  modalBody:{padding:'24px 28px',overflowY:'auto',flex:1},
  modalGrid:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16},
  modalFooter:{display:'flex',gap:12,padding:'16px 28px',borderTop:'1px solid #f0f4f1'},
  editSection:{fontSize:11,fontWeight:700,color:'#1a7a4a',letterSpacing:1,fontFamily:"'Syne',sans-serif",paddingBottom:6,borderBottom:'1px solid #e8f5ee'},
  toast:{position:'fixed',bottom:32,left:'50%',transform:'translateX(-50%)',color:'#fff',padding:'12px 28px',borderRadius:100,fontSize:13,fontWeight:500,zIndex:200,whiteSpace:'nowrap',borderBottom:'3px solid #f0c040',boxShadow:'0 4px 20px rgba(0,0,0,.2)'},
}
