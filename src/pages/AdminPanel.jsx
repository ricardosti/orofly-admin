import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { gerarPDFRelatorio } from '../lib/pdf'

const STATUS_LABEL = { rascunho:'Rascunho', em_operacao:'Em operação', pausado:'Pausado', finalizado:'Finalizado' }
const STATUS_COLOR = { rascunho:'#6b8070', em_operacao:'#1a7a4a', pausado:'#e8a020', finalizado:'#185fa5' }
const STATUS_BG    = { rascunho:'#f4f8f5', em_operacao:'#e8f5ee', pausado:'#fdf3e0', finalizado:'#e6f1fb' }
const COND_KEYS    = ['faixa','vazao','vento','umidade','temperatura','delta_t']
const COND_LABELS  = ['Faixa','Vazão','Vento','Umidade','Temperatura','Delta T']
const PRODUTOS_LIST = ['Triclon','Triomax','Moddus','Suiker','Roundup','Essenza','Spotlight','Agile','Volt','Mag8','Outros']

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

// Produto com select + dosagem
function ProdutoRow({ value, onChange, onRemove, showRemove }) {
  // value format: "NomeProduto - dosagem" ou apenas "NomeProduto"
  const parts = value ? value.split(' - ') : ['']
  const nome = parts[0] || ''
  const dosagem = parts.slice(1).join(' - ') || ''
  const isOutros = nome === 'Outros' || (!PRODUTOS_LIST.includes(nome) && nome !== '')
  const selectVal = PRODUTOS_LIST.includes(nome) ? nome : (nome ? 'Outros' : '')

  function update(newNome, newDosagem) {
    onChange(newDosagem ? `${newNome} - ${newDosagem}` : newNome)
  }

  return (
    <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:6,flexWrap:'wrap'}}>
      <select style={{...sG.input,flex:'0 0 140px',fontSize:13}} value={selectVal}
        onChange={e => update(e.target.value === 'Outros' ? '' : e.target.value, dosagem)}>
        <option value="">Selecione...</option>
        {PRODUTOS_LIST.map(p => <option key={p}>{p}</option>)}
      </select>
      {(isOutros || selectVal === 'Outros') && (
        <input style={{...sG.input,flex:'0 0 110px',fontSize:13}} placeholder="Nome do produto" value={nome === 'Outros' ? '' : nome}
          onChange={e => update(e.target.value || 'Outros', dosagem)} />
      )}
      <input style={{...sG.input,flex:1,minWidth:80,fontSize:13}} placeholder="Dosagem (ex: 0.9 L/ha)"
        value={dosagem} onChange={e => update(nome === 'Outros' ? (document.activeElement?.previousSibling?.value || '') : nome, e.target.value)} />
      {showRemove && <button style={{background:'none',border:'none',color:'#c0392b',cursor:'pointer',fontSize:18,flexShrink:0}} onClick={onRemove}>×</button>}
    </div>
  )
}

export default function AdminPanel() {
  const { profile, signOut } = useAuth()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('relatorios')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [relatorios, setRelatorios] = useState([])
  const [pilotos, setPilotos] = useState([])
  const [voosPorPiloto, setVoosPorPiloto] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [editModal, setEditModal] = useState(null)
  const [editFotoMapa, setEditFotoMapa] = useState(null)
  const [editFotoMapaFile, setEditFotoMapaFile] = useState(null)
  const [editObsFotos, setEditObsFotos] = useState([null,null,null])
  const [editObsFotoFiles, setEditObsFotoFiles] = useState([null,null,null])
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [filters, setFilters] = useState({ cliente:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })
  const [newUser, setNewUser] = useState({ nome:'', email:'', senha:'', role:'piloto' })
  const [criandoUser, setCriandoUser] = useState(false)

  const showToast = useCallback((msg, type='success') => {
    setToast({msg, type}); setTimeout(() => setToast(null), 3000)
  }, [])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: rels }, usersRes] = await Promise.all([
      supabase.from('relatorios').select('*').order('created_at', { ascending: false }),
      fetch('/api/list-users')
    ])
    const rs = rels || []
    setRelatorios(rs)
    if (usersRes.ok) { const d = await usersRes.json(); setPilotos(d.users || []) }
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

  function calcTempo(ini, fim, pi, pf) {
    if (!ini || !fim) return null
    const t = Math.round((new Date(fim)-new Date(ini))/60000)
    if (t <= 0) return null
    let p = 0; if (pi && pf) p = Math.max(0, Math.round((new Date(pf)-new Date(pi))/60000))
    const f = m => { const h=Math.floor(m/60),min=m%60; return h>0?`${h}h${String(min).padStart(2,'0')}m`:`${min}m` }
    return { total:f(t), efetivo:f(t-p), temPausa:p>0 }
  }

  async function salvarEdicao() {
    if (!editModal) return
    setSaving(true)
    let fotoMapaUrl = editModal.foto_mapa_url
    if (editFotoMapaFile) {
      const path = `${editModal.piloto_id}/${editModal.id}/mapa.jpg`
      await supabase.storage.from('relatorios').upload(path, editFotoMapaFile, { upsert:true })
      fotoMapaUrl = path
    }
    let obsUrls = [...(editModal.obs_fotos_urls || [null,null,null])]
    for (let i=0; i<3; i++) {
      if (editObsFotoFiles[i]) {
        const path = `${editModal.piloto_id}/${editModal.id}/obs_${i}.jpg`
        await supabase.storage.from('relatorios').upload(path, editObsFotoFiles[i], { upsert:true })
        obsUrls[i] = path
      }
    }
    const { id, created_at, updated_at, ...campos } = editModal
    const { error } = await supabase.from('relatorios').update({...campos, foto_mapa_url:fotoMapaUrl, obs_fotos_urls:obsUrls}).eq('id', id)
    if (error) { showToast('Erro: '+error.message, 'error'); setSaving(false); return }
    showToast('✅ Salvo!'); resetEdit(); fetchAll(); setSaving(false)
  }

  function resetEdit() {
    setEditModal(null); setEditFotoMapa(null); setEditFotoMapaFile(null)
    setEditObsFotos([null,null,null]); setEditObsFotoFiles([null,null,null])
  }

  async function deletarRelatorio(id) {
    await supabase.from('relatorios').delete().eq('id', id)
    showToast('🗑️ Deletado'); setConfirmDelete(null); setSelected(null); fetchAll()
  }

  async function toggleAtivo(piloto) {
    try {
      const res = await fetch('/api/toggle-user', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:piloto.id,ativo:!piloto.ativo})})
      const d = await res.json(); if (d.error) throw new Error(d.error)
      showToast(piloto.ativo?'⛔ Desativado':'✅ Ativado'); fetchAll()
    } catch(e) { showToast('Erro: '+e.message,'error') }
  }

  async function gerarPDF(rel, localFotoMapa, localObsFotos) {
    showToast('⏳ Gerando PDF...')
    try {
      const { data: relAtual } = await supabase.from('relatorios').select('*').eq('id', rel.id).single()
      const relFinal = relAtual || rel
      const doc = await gerarPDFRelatorio(relFinal, {
        supabase,
        localFotoMapa: localFotoMapa || null,
        localObsFotos: localObsFotos?.some(Boolean) ? localObsFotos : null
      })
      doc.save(`relatorio-orofly-${relFinal.cliente?.replace(/\s+/g,'-').toLowerCase()}-${new Date(relFinal.created_at).toLocaleDateString('pt-BR').replace(/\//g,'-')}.pdf`)
      showToast('✅ PDF baixado!')
    } catch(e) { console.error(e); showToast('Erro ao gerar PDF','error') }
  }

  async function criarUsuario(e) {
    e.preventDefault()
    if (!newUser.nome||!newUser.email||!newUser.senha) { showToast('⚠️ Preencha tudo','error'); return }
    if (newUser.senha.length < 6) { showToast('⚠️ Senha mín. 6 chars','error'); return }
    setCriandoUser(true)
    try {
      const res = await fetch('/api/create-user', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newUser)})
      const text = await res.text(); let data
      try { data = JSON.parse(text) } catch { throw new Error('Função não encontrada.') }
      if (data.error) throw new Error(data.error)
      showToast('✅ Usuário criado!'); setNewUser({nome:'',email:'',senha:'',role:'piloto'}); fetchAll()
    } catch(e) { showToast('Erro: '+e.message,'error') }
    setCriandoUser(false)
  }

  const fmt = v => v ? new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'

  const NavContent = () => (
    <>
      <div style={{padding:'24px 20px 16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <span style={{fontFamily:"'Syne',sans-serif",fontSize:19,fontWeight:700,color:'#fff',letterSpacing:-0.5}}>Orofly<span style={{color:'#f0c040'}}>.</span></span>
          <span style={{background:'#f0c040',color:'#111a14',fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:6}}>ADMIN</span>
        </div>
        <div style={{fontSize:10,color:'#4a6e56',letterSpacing:1}}>Painel de Administração</div>
      </div>
      <nav style={{padding:'4px 12px',flex:1}}>
        {[['relatorios','📋','Relatórios',filtered.length],['pilotos','👥','Usuários',pilotos.length]].map(([id,icon,lbl,cnt])=>(
          <button key={id} style={{display:'flex',alignItems:'center',gap:8,width:'100%',background:tab===id?'#1a3a22':'transparent',border:'none',borderRadius:10,padding:'9px 12px',cursor:'pointer',color:tab===id?'#fff':'#8aad94',fontSize:13,fontFamily:"'DM Sans',sans-serif",fontWeight:500,marginBottom:3}}
            onClick={()=>{setTab(id);setSidebarOpen(false)}}>
            <span>{icon}</span><span style={{flex:1,textAlign:'left'}}>{lbl}</span>
            <span style={{background:tab===id?'#f0c040':'#1e3828',color:tab===id?'#111a14':'#6b8070',fontSize:11,fontWeight:600,padding:'1px 7px',borderRadius:20}}>{cnt}</span>
          </button>
        ))}
      </nav>
      <div style={{padding:'10px 20px',borderTop:'1px solid #1e3828',borderBottom:'1px solid #1e3828',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:4}}>
        {[['Em voo',relatorios.filter(r=>r.status==='em_operacao').length,'#2da05e'],['Pausados',relatorios.filter(r=>r.status==='pausado').length,'#e8a020'],['Finalizados',relatorios.filter(r=>r.status==='finalizado').length,'#185fa5']].map(([lbl,val,cor])=>(
          <div key={lbl} style={{textAlign:'center'}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:700,color:cor}}>{val}</div>
            <div style={{fontSize:9,color:'#4a6e56'}}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{padding:'14px 20px'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <div style={{width:30,height:30,borderRadius:'50%',background:'#1a7a4a',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13}}>{profile?.nome?.[0]?.toUpperCase()}</div>
          <div><div style={{fontSize:12,fontWeight:500,color:'#fff'}}>{profile?.nome}</div><div style={{fontSize:10,color:'#8aad94'}}>Admin</div></div>
        </div>
        <button style={{width:'100%',background:'transparent',border:'1px solid #1e3828',color:'#4a6e56',borderRadius:8,padding:'7px',fontSize:12,cursor:'pointer'}} onClick={signOut}>Sair</button>
        <div style={{textAlign:'center',fontSize:10,color:'#2d4a38',marginTop:8,letterSpacing:1}}>v1.17</div>
      </div>
    </>
  )

  const fi = sG.input

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#f4f8f5',fontFamily:"'DM Sans',sans-serif"}}>

      {/* DESKTOP SIDEBAR */}
      {!isMobile && (
        <aside style={{width:240,background:'#111a14',display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100vh',flexShrink:0,overflowY:'auto'}}>
          <NavContent />
        </aside>
      )}

      {/* MOBILE SIDEBAR OVERLAY */}
      {isMobile && sidebarOpen && (
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex'}}>
          <div style={{width:260,background:'#111a14',display:'flex',flexDirection:'column',overflowY:'auto'}}>
            <NavContent />
          </div>
          <div style={{flex:1,background:'rgba(0,0,0,.5)'}} onClick={()=>setSidebarOpen(false)} />
        </div>
      )}

      {/* CONTENT */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>

        {/* MOBILE TOPBAR */}
        {isMobile && (
          <div style={{background:'#111a14',padding:'11px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:100}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <button style={{background:'transparent',border:'none',color:'#8aad94',fontSize:22,cursor:'pointer'}} onClick={()=>setSidebarOpen(true)}>☰</button>
              <span style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,color:'#fff'}}>Orofly<span style={{color:'#f0c040'}}>.</span></span>
            </div>
            <div style={{display:'flex',gap:6}}>
              {[['relatorios','📋'],['pilotos','👥']].map(([id,ic])=>(
                <button key={id} style={{background:tab===id?'#1a3a22':'transparent',border:'none',borderRadius:8,padding:'6px 10px',cursor:'pointer',fontSize:16,color:tab===id?'#fff':'#8aad94'}} onClick={()=>setTab(id)}>{ic}</button>
              ))}
              <button style={{background:'transparent',border:'1px solid #2d4a38',color:'#8aad94',borderRadius:8,padding:'5px 10px',fontSize:11,cursor:'pointer'}} onClick={signOut}>Sair</button>
            </div>
          </div>
        )}

        <main style={{flex:1,overflow:'auto',padding: isMobile?'12px':'28px 32px'}}>

          {/* ===== RELATÓRIOS ===== */}
          {tab==='relatorios' && (
            <div>
              <div style={{marginBottom:18}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:'#111a14'}}>Relatórios de Voo</div>
                <div style={{fontSize:12,color:'#6b8070',marginTop:2}}>{filtered.length} de {relatorios.length}</div>
              </div>

              {/* FILTROS */}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14,background:'#fff',padding:12,borderRadius:12,border:'1px solid #d0e4d8',alignItems:'center'}}>
                {[['Cliente','cliente'],['Piloto','piloto'],['Drone','drone']].map(([ph,k])=>(
                  <input key={k} style={{...fi,minWidth:110,flex:1}} placeholder={`🔍 ${ph}...`} value={filters[k]} onChange={e=>setFilters(f=>({...f,[k]:e.target.value}))} />
                ))}
                <select style={{...fi,minWidth:130,flex:1}} value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))}>
                  <option value="">Todos status</option>
                  <option value="em_operacao">🟢 Em operação</option>
                  <option value="pausado">🟡 Pausado</option>
                  <option value="finalizado">✅ Finalizado</option>
                  <option value="rascunho">Rascunho</option>
                </select>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{fontSize:11,color:'#6b8070',whiteSpace:'nowrap'}}>De:</span>
                  <input type="date" style={{...fi,minWidth:120}} value={filters.dataIni} onChange={e=>setFilters(f=>({...f,dataIni:e.target.value}))} />
                </div>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{fontSize:11,color:'#6b8070',whiteSpace:'nowrap'}}>Até:</span>
                  <input type="date" style={{...fi,minWidth:120}} value={filters.dataFim} onChange={e=>setFilters(f=>({...f,dataFim:e.target.value}))} />
                </div>
                {Object.values(filters).some(Boolean) && (
                  <button style={{background:'none',border:'1px solid #e0b0a8',color:'#c0392b',borderRadius:8,padding:'7px 12px',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}} onClick={()=>setFilters({cliente:'',piloto:'',drone:'',status:'',dataIni:'',dataFim:''})}>✕ Limpar</button>
                )}
              </div>

              {loading ? <div style={{textAlign:'center',color:'#6b8070',padding:40}}>Carregando...</div>
              : filtered.length===0 ? <div style={{textAlign:'center',color:'#6b8070',padding:40}}>Nenhum relatório</div>
              : isMobile ? (
                /* MOBILE CARDS */
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {filtered.map(rel => {
                    const tempo = calcTempo(rel.dt_inicio,rel.dt_fim,rel.pausa_inicio,rel.pausa_fim)
                    const isSel = selected?.id===rel.id
                    return (
                      <div key={rel.id} style={{background:'#fff',borderRadius:12,border:`1px solid ${isSel?'#1a7a4a':'#d0e4d8'}`,overflow:'hidden'}}>
                        <div style={{padding:'13px 15px',cursor:'pointer'}} onClick={()=>setSelected(isSel?null:rel)}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                            <div style={{fontWeight:600,fontSize:14,color:'#111a14'}}>{rel.cliente||'—'}</div>
                            <span style={{background:STATUS_BG[rel.status],color:STATUS_COLOR[rel.status],fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20}}>{STATUS_LABEL[rel.status]}</span>
                          </div>
                          <div style={{fontSize:12,color:'#6b8070'}}>{rel.fazenda}{rel.area_ha?` · ${rel.area_ha}ha`:''} · {rel.piloto_nome}</div>
                          <div style={{fontSize:11,color:'#aaa',marginTop:3}}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}{tempo?` · ${tempo.total}`:''}</div>
                        </div>
                        {isSel && (
                          <div style={{padding:'10px 15px',borderTop:'1px solid #f0f4f1',background:'#f9fbfa'}}>
                            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                              <button style={{background:'#185fa5',color:'#fff',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,cursor:'pointer'}} onClick={e=>{e.stopPropagation();setEditModal({...rel})}}>✏️ Editar</button>
                              <button style={{background:'#111a14',color:'#fff',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,cursor:'pointer'}} onClick={e=>{e.stopPropagation();gerarPDF(rel)}}>📄 PDF</button>
                              {rel.gps_lat&&<a style={{background:'#1a7a4a',color:'#fff',textDecoration:'none',borderRadius:8,padding:'6px 12px',fontSize:12}} href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer">🗺️</a>}
                              <button style={{background:'#c0392b',color:'#fff',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,cursor:'pointer'}} onClick={e=>{e.stopPropagation();setConfirmDelete(rel)}}>🗑️</button>
                            </div>
                            {[['Piloto',rel.piloto_nome],['Drone',rel.drone],['Área',rel.area_ha?rel.area_ha+' ha':null],['Início',fmt(rel.dt_inicio)],['Fim',fmt(rel.dt_fim)],...(tempo?[['Tempo',tempo.total]]:[] ),['Obs 1',rel.obs1]].filter(([,v])=>v).map(([l,v])=>(
                              <div key={l} style={{display:'flex',gap:6,fontSize:12,marginBottom:3}}>
                                <span style={{color:'#6b8070',minWidth:60}}>{l}:</span>
                                <span style={{color:'#111a14'}}>{v}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* DESKTOP TABLE */
                <div style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',overflow:'hidden'}}>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',minWidth:700}}>
                      <thead>
                        <tr style={{background:'#f4f8f5'}}>
                          {['Cliente','Fazenda / Área','Piloto','Drone','Status','Data','Tempo','Ações'].map(h=>(
                            <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'#6b8070',letterSpacing:0.5,borderBottom:'1px solid #d0e4d8',whiteSpace:'nowrap',fontFamily:"'Syne',sans-serif"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((rel,i)=>{
                          const tempo = calcTempo(rel.dt_inicio,rel.dt_fim,rel.pausa_inicio,rel.pausa_fim)
                          const isSel = selected?.id===rel.id
                          return (
                            <React.Fragment key={rel.id}>
                              <tr style={{background:isSel?'#e8f5ee':i%2===0?'#fff':'#f9fbfa',cursor:'pointer'}} onClick={()=>setSelected(isSel?null:rel)}>
                                <td style={sG.td}><strong>{rel.cliente||'—'}</strong></td>
                                <td style={sG.td}>{rel.fazenda||'—'}{rel.area_ha?<span style={{fontSize:11,color:'#6b8070'}}> ({rel.area_ha}ha)</span>:''}</td>
                                <td style={sG.td}>{rel.piloto_nome||'—'}</td>
                                <td style={sG.td}>{rel.drone||'—'}</td>
                                <td style={sG.td}><span style={{background:STATUS_BG[rel.status],color:STATUS_COLOR[rel.status],fontSize:11,fontWeight:600,padding:'3px 9px',borderRadius:20}}>{STATUS_LABEL[rel.status]}</span></td>
                                <td style={sG.td}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}</td>
                                <td style={sG.td}>{tempo?<span style={{fontSize:12}}>{tempo.total}{tempo.temPausa?<span style={{color:'#6b8070'}}> /{tempo.efetivo}</span>:''}:</span>:'—'}</td>
                                <td style={{...sG.td,whiteSpace:'nowrap'}}>
                                  <button title="Editar" style={sG.iconBtn} onClick={e=>{e.stopPropagation();setEditModal({...rel})}}>✏️</button>
                                  <button title="PDF" style={sG.iconBtn} onClick={e=>{e.stopPropagation();gerarPDF(rel)}}>📄</button>
                                  {rel.gps_lat&&<a title="Maps" style={{...sG.iconBtn,textDecoration:'none'}} href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>🗺️</a>}
                                  <button title="Deletar" style={{...sG.iconBtn,color:'#c0392b'}} onClick={e=>{e.stopPropagation();setConfirmDelete(rel)}}>🗑️</button>
                                </td>
                              </tr>
                              {isSel && (
                                <tr>
                                  <td colSpan={8} style={{background:'#f0f8f4',borderBottom:'2px solid #d0e4d8',padding:0}}>
                                    <div style={{display:'flex',gap:20,padding:'16px 20px',flexWrap:'wrap'}}>
                                      <DetailCol title="Localização" items={[['Local',rel.localizacao],['GPS',rel.gps_lat?`${rel.gps_lat}, ${rel.gps_lng}`:'—']]} />
                                      <DetailCol title="Cond. Início" items={COND_KEYS.map((k,ii)=>[COND_LABELS[ii],rel[k+'_i']])} />
                                      <DetailCol title="Cond. Fim" items={COND_KEYS.map((k,ii)=>[COND_LABELS[ii],rel[k+'_f']])} />
                                      <DetailCol title="Horários" items={[['Início',fmt(rel.dt_inicio)],['Fim',fmt(rel.dt_fim)],...(tempo?[['Total',tempo.total],...(tempo.temPausa?[['Efetivo',tempo.efetivo]]:[])]:[] ),...(rel.pausa?[['Pausa',rel.pausa_motivo]]:[] )]} />
                                      <DetailCol title="Outros" items={[...((rel.produtos||[]).map((p,ii)=>['Prod.'+(ii+1),p])),['Área',rel.area_ha?rel.area_ha+' ha':null],['Gota',rel.tamanho_gota],['Vel. Drone',rel.velocidade_drone],['Obs 1',rel.obs1],['Obs 2',rel.obs2]]} />
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== USUÁRIOS ===== */}
          {tab==='pilotos' && (
            <div>
              <div style={{marginBottom:18}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:'#111a14'}}>Gestão de Usuários</div>
                <div style={{fontSize:12,color:'#6b8070',marginTop:2}}>{pilotos.length} usuários</div>
              </div>
              <div style={{display:'flex',gap:20,flexDirection:isMobile?'column':'row',alignItems:'flex-start'}}>
                {/* FORM CRIAR */}
                <div style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:20,width:isMobile?'100%':280,flexShrink:0}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:16}}>+ Novo usuário</div>
                  <form onSubmit={criarUsuario} style={{display:'flex',flexDirection:'column',gap:12}}>
                    {[['Nome completo','nome','text','João Silva'],['E-mail','email','email','piloto@orofly.com'],['Senha','senha','password','Mínimo 6 caracteres']].map(([lbl,key,type,ph])=>(
                      <div key={key}>
                        <div style={sG.label}>{lbl.toUpperCase()}</div>
                        <input style={sG.input} type={type} placeholder={ph} value={newUser[key]} autoComplete="new-password" onChange={e=>setNewUser(u=>({...u,[key]:e.target.value}))} />
                      </div>
                    ))}
                    <div>
                      <div style={sG.label}>PERFIL</div>
                      <select style={sG.input} value={newUser.role} onChange={e=>setNewUser(u=>({...u,role:e.target.value}))}>
                        <option value="piloto">🚁 Piloto</option>
                        <option value="admin">⚙️ Administrador</option>
                      </select>
                    </div>
                    <button type="submit" style={sG.btn} disabled={criandoUser}>{criandoUser?'Criando...':'Criar usuário'}</button>
                  </form>
                </div>
                {/* LISTA */}
                <div style={{flex:1,overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',overflow:'hidden'}}>
                    <thead><tr style={{background:'#f4f8f5'}}>{['Usuário','E-mail','Perfil','Voos','Status','Ação'].map(h=><th key={h} style={{padding:'10px 13px',textAlign:'left',fontSize:11,fontWeight:700,color:'#6b8070',borderBottom:'1px solid #d0e4d8',fontFamily:"'Syne',sans-serif"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {pilotos.map((p,i)=>(
                        <tr key={p.id} style={{background:i%2===0?'#fff':'#f9fbfa',opacity:p.ativo?1:.5}}>
                          <td style={sG.td}><div style={{display:'flex',alignItems:'center',gap:8}}><div style={{width:30,height:30,borderRadius:'50%',background:p.role==='admin'?'#faeeda':'#e8f5ee',color:p.role==='admin'?'#854f0b':'#1a7a4a',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:12,flexShrink:0}}>{p.nome?.[0]?.toUpperCase()||'?'}</div><span style={{fontWeight:500}}>{p.nome}</span></div></td>
                          <td style={{...sG.td,color:'#6b8070',fontSize:12}}>{p.email}</td>
                          <td style={sG.td}><span style={{background:p.role==='admin'?'#faeeda':'#e8f5ee',color:p.role==='admin'?'#854f0b':'#0f6e56',fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:20}}>{p.role==='admin'?'⚙️ Admin':'🚁 Piloto'}</span></td>
                          <td style={{...sG.td,textAlign:'center',fontFamily:"'Syne',sans-serif",fontWeight:700,color:'#1a7a4a'}}>{voosPorPiloto[p.id]||0}</td>
                          <td style={sG.td}><span style={{background:p.ativo?'#e8f5ee':'#fee',color:p.ativo?'#1a7a4a':'#c0392b',fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:20}}>{p.ativo?'Ativo':'Inativo'}</span></td>
                          <td style={sG.td}><button style={{background:p.ativo?'#fee':'#e8f5ee',color:p.ativo?'#c0392b':'#1a7a4a',border:'none',borderRadius:8,padding:'5px 12px',fontSize:12,cursor:'pointer'}} onClick={()=>toggleAtivo(p)}>{p.ativo?'Desativar':'Ativar'}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ===== MODAL EDITAR ===== */}
      {editModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:300,display:'flex',alignItems:isMobile?'flex-end':'center',justifyContent:'center',padding:isMobile?0:24}}>
          <div style={{background:'#fff',borderRadius:isMobile?'20px 20px 0 0':'16px',width:'100%',maxWidth:isMobile?'100%':920,maxHeight:isMobile?'95vh':'90vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,.15)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'15px 20px',borderBottom:'1px solid #f0f4f1',flexShrink:0}}>
              <span style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>✏️ Editar Relatório</span>
              <button style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#6b8070'}} onClick={resetEdit}>✕</button>
            </div>
            <div style={{padding:'16px 20px',overflowY:'auto',flex:1}}>

              {/* IDENTIFICAÇÃO */}
              <SectionTitle>IDENTIFICAÇÃO</SectionTitle>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)',gap:10,marginBottom:14}}>
                {[['Cliente','cliente'],['Fazenda','fazenda']].map(([l,k])=>(
                  <div key={k}><div style={sG.label}>{l.toUpperCase()}</div><input style={sG.input} value={editModal[k]||''} onChange={e=>setEditModal(m=>({...m,[k]:e.target.value}))} /></div>
                ))}
                <div>
                  <div style={sG.label}>ÁREA (HA)</div>
                  <input style={sG.input} placeholder="Ex: 50.5" value={editModal.area_ha||''} onChange={e=>setEditModal(m=>({...m,area_ha:e.target.value}))} />
                </div>
                {[['Piloto','piloto_nome'],['Drone','drone']].map(([l,k])=>(
                  <div key={k}><div style={sG.label}>{l.toUpperCase()}</div><input style={sG.input} value={editModal[k]||''} onChange={e=>setEditModal(m=>({...m,[k]:e.target.value}))} /></div>
                ))}
                <div>
                  <div style={sG.label}>STATUS</div>
                  <select style={sG.input} value={editModal.status||''} onChange={e=>setEditModal(m=>({...m,status:e.target.value}))}>
                    <option value="rascunho">Rascunho</option><option value="em_operacao">Em operação</option>
                    <option value="pausado">Pausado</option><option value="finalizado">Finalizado</option>
                  </select>
                </div>
              </div>

              {/* PRODUTOS */}
              <SectionTitle>PRODUTOS</SectionTitle>
              <div style={{marginBottom:14}}>
                {(editModal.produtos||['']).map((p,i)=>(
                  <ProdutoRow key={i} value={p}
                    onChange={v=>{const arr=[...(editModal.produtos||[])];arr[i]=v;setEditModal(m=>({...m,produtos:arr}))}}
                    onRemove={()=>setEditModal(m=>({...m,produtos:m.produtos.filter((_,j)=>j!==i)}))}
                    showRemove={(editModal.produtos||[]).length>1} />
                ))}
                <button style={{...sG.btn,background:'#e8f5ee',color:'#1a7a4a',padding:'7px',fontSize:13,marginTop:2}} onClick={()=>setEditModal(m=>({...m,produtos:[...(m.produtos||[]),'']}))}>+ Adicionar produto</button>
              </div>

              {/* TAMANHO GOTA + VELOCIDADE */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
                <div>
                  <div style={sG.label}>TAMANHO DA GOTA</div>
                  <input style={sG.input} placeholder="Ex: Média, Grossa..." value={editModal.tamanho_gota||''} onChange={e=>setEditModal(m=>({...m,tamanho_gota:e.target.value}))} />
                </div>
                <div>
                  <div style={sG.label}>VELOCIDADE DO DRONE</div>
                  <input style={sG.input} placeholder="Ex: 7 m/s" value={editModal.velocidade_drone||''} onChange={e=>setEditModal(m=>({...m,velocidade_drone:e.target.value}))} />
                </div>
              </div>

              {/* CONDIÇÕES */}
              <SectionTitle>CONDIÇÕES INÍCIO / FIM</SectionTitle>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(3,1fr)':'repeat(6,1fr)',gap:8,marginBottom:8}}>
                {COND_KEYS.map((k,i)=>(
                  <div key={k}><div style={{...sG.label,fontSize:9}}>{COND_LABELS[i]} INI</div><input style={{...sG.input,padding:'6px 8px',fontSize:12}} value={editModal[k+'_i']||''} onChange={e=>setEditModal(m=>({...m,[k+'_i']:e.target.value}))} /></div>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(3,1fr)':'repeat(6,1fr)',gap:8,marginBottom:14}}>
                {COND_KEYS.map((k,i)=>(
                  <div key={k+'f'}><div style={{...sG.label,fontSize:9}}>{COND_LABELS[i]} FIM</div><input style={{...sG.input,padding:'6px 8px',fontSize:12}} value={editModal[k+'_f']||''} onChange={e=>setEditModal(m=>({...m,[k+'_f']:e.target.value}))} /></div>
                ))}
              </div>

              {/* OBS */}
              <SectionTitle>OBSERVAÇÕES</SectionTitle>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10,marginBottom:14}}>
                {[['Obs 1','obs1'],['Obs 2','obs2']].map(([l,k])=>(
                  <div key={k}><div style={sG.label}>{l}</div><textarea style={{...sG.input,resize:'none',minHeight:56}} value={editModal[k]||''} onChange={e=>setEditModal(m=>({...m,[k]:e.target.value}))} /></div>
                ))}
              </div>

              {/* FOTOS */}
              <SectionTitle>FOTOS</SectionTitle>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:14,marginBottom:8}}>
                <div>
                  <div style={sG.label}>MAPA DE PÓS APLICAÇÃO</div>
                  <label style={{display:'block',border:'1.5px dashed #d0e4d8',borderRadius:10,padding:10,textAlign:'center',cursor:'pointer',marginTop:4,position:'relative',minHeight:60}}>
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setEditFotoMapa(ev.target.result);r.readAsDataURL(f);setEditFotoMapaFile(f)}} />
                    {editFotoMapa
                      ? <img src={editFotoMapa} alt="mapa" style={{width:'100%',maxHeight:120,objectFit:'cover',borderRadius:8}} />
                      : editModal.foto_mapa_url
                        ? <StoragePhoto supabase={supabase} path={editModal.foto_mapa_url} bucket="relatorios" />
                        : <div style={{padding:'16px 0',fontSize:12,color:'#6b8070'}}>🗺️ Clique para adicionar</div>
                    }
                  </label>
                </div>
                <div>
                  <div style={sG.label}>FOTOS DE OBSERVAÇÃO</div>
                  <div style={{display:'flex',gap:8,marginTop:4}}>
                    {[0,1,2].map(i=>(
                      <label key={i} style={{flex:1,border:'1.5px dashed #d0e4d8',borderRadius:10,padding:8,textAlign:'center',cursor:'pointer',minHeight:70,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
                        <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const a=[...editObsFotos];a[i]=ev.target.result;setEditObsFotos(a)};r.readAsDataURL(f);const a=[...editObsFotoFiles];a[i]=f;setEditObsFotoFiles(a)}} />
                        {editObsFotos[i]
                          ? <img src={editObsFotos[i]} alt="" style={{width:'100%',height:60,objectFit:'cover',borderRadius:6}} />
                          : editModal.obs_fotos_urls?.[i]
                            ? <StoragePhoto supabase={supabase} path={editModal.obs_fotos_urls[i]} bucket="relatorios" small />
                            : <span style={{fontSize:18}}>📷</span>
                        }
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div style={{display:'flex',gap:8,padding:'12px 20px',borderTop:'1px solid #f0f4f1',flexShrink:0}}>
              <button style={{...sG.btn,background:'#f4f8f5',color:'#6b8070',flex:1}} onClick={resetEdit}>Cancelar</button>
              <button style={{...sG.btn,background:'#111a14',flex:1}} onClick={()=>gerarPDF(editModal, editFotoMapa, editObsFotos)}>📄 PDF</button>
              <button style={{...sG.btn,flex:2,opacity:saving?.6:1}} disabled={saving} onClick={salvarEdicao}>{saving?'Salvando...':'💾 Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE */}
      {confirmDelete && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:380,padding:24,boxShadow:'0 20px 60px rgba(0,0,0,.15)'}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,marginBottom:10}}>🗑️ Confirmar exclusão</div>
            <p style={{fontSize:14,marginBottom:6}}>Deletar relatório de <strong>{confirmDelete.cliente}</strong>?</p>
            <p style={{fontSize:12,color:'#c0392b',marginBottom:18}}>Esta ação não pode ser desfeita.</p>
            <div style={{display:'flex',gap:10}}>
              <button style={{...sG.btn,background:'#f4f8f5',color:'#6b8070',flex:1}} onClick={()=>setConfirmDelete(null)}>Cancelar</button>
              <button style={{...sG.btn,background:'#c0392b',flex:1}} onClick={()=>deletarRelatorio(confirmDelete.id)}>Deletar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:toast.type==='error'?'#c0392b':'#111a14',color:'#fff',padding:'12px 24px',borderRadius:100,fontSize:13,fontWeight:500,zIndex:400,whiteSpace:'nowrap',borderBottom:'3px solid #f0c040',boxShadow:'0 4px 20px rgba(0,0,0,.2)'}}>{toast.msg}</div>}
    </div>
  )
}

function SectionTitle({ children }) {
  return <div style={{fontSize:10,fontWeight:700,color:'#1a7a4a',letterSpacing:1,marginBottom:8,paddingBottom:4,borderBottom:'1px solid #e8f5ee',fontFamily:"'Syne',sans-serif"}}>{children}</div>
}

function StoragePhoto({ supabase, path, bucket, small }) {
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!path) return
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!error && data?.signedUrl) setUrl(data.signedUrl)
      setLoading(false)
    })
  }, [path, bucket, supabase])
  if (loading) return <div style={{fontSize:10,color:'#6b8070',padding:'8px 0'}}>⏳ carregando...</div>
  if (!url) return <div style={{fontSize:10,color:'#c0392b'}}>⚠️ não encontrada</div>
  return (
    <div>
      <img src={url} alt="foto" style={{width:'100%',maxHeight:small?60:120,objectFit:'cover',borderRadius:8,display:'block'}} />
      {!small && (
        <div style={{display:'flex',gap:6,marginTop:6}}>
          <a href={url} target="_blank" rel="noreferrer" style={{flex:1,background:'#e8f5ee',color:'#1a7a4a',borderRadius:6,padding:'5px',fontSize:11,textDecoration:'none',textAlign:'center'}} onClick={e=>e.stopPropagation()}>🔍 Ver</a>
          <button style={{flex:1,background:'#185fa5',color:'#fff',border:'none',borderRadius:6,padding:'5px',fontSize:11,cursor:'pointer'}} onClick={async e=>{
            e.stopPropagation()
            try{const r=await fetch(url);const b=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='foto.jpg';a.click();URL.revokeObjectURL(a.href)}
            catch{window.open(url,'_blank')}
          }}>⬇ Baixar</button>
        </div>
      )}
      {!small && <div style={{fontSize:10,color:'#6b8070',marginTop:4}}>Clique na área para trocar</div>}
    </div>
  )
}

function DetailCol({ title, items }) {
  const valid = items.filter(([,v])=>v&&v!=='—')
  if (!valid.length) return null
  return (
    <div style={{minWidth:120,flex:1}}>
      <div style={{fontSize:10,fontWeight:700,color:'#1a7a4a',letterSpacing:1,marginBottom:5,fontFamily:"'Syne',sans-serif"}}>{title.toUpperCase()}</div>
      {valid.map(([l,v])=>(
        <div key={l} style={{display:'flex',gap:4,marginBottom:3,fontSize:11}}>
          <span style={{color:'#6b8070',minWidth:65,flexShrink:0}}>{l}:</span>
          <span style={{color:'#111a14',wordBreak:'break-word'}}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// Estilos globais compartilhados
const sG = {
  td: {padding:'11px 14px',fontSize:13,color:'#111a14',borderBottom:'1px solid #f0f4f1',verticalAlign:'middle'},
  iconBtn: {background:'none',border:'none',cursor:'pointer',fontSize:15,padding:'3px 4px',borderRadius:6},
  label: {fontSize:11,fontWeight:600,color:'#6b8070',letterSpacing:.5,marginBottom:4,fontFamily:"'Syne',sans-serif"},
  input: {width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'9px 11px',fontSize:14,fontFamily:"'DM Sans',sans-serif",outline:'none',color:'#111a14',background:'#f4f8f5',appearance:'none',WebkitAppearance:'none'},
  btn: {background:'#1a7a4a',color:'#fff',border:'none',borderRadius:10,padding:'11px',fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:600,cursor:'pointer',width:'100%'},
}
