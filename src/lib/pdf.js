import jsPDF from 'jspdf'

// Converte blob/file para base64
async function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Baixa imagem do Supabase Storage como base64 via signed URL
async function fetchImageBase64(supabase, bucket, path) {
  if (!path || !supabase) return null
  try {
    const { data: signed, error: signErr } = await supabase.storage
      .from(bucket).createSignedUrl(path, 120)
    if (signErr || !signed?.signedUrl) return null
    const res = await fetch(signed.signedUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    return await toBase64(blob)
  } catch { return null }
}

export async function gerarPDFRelatorio(rel, { supabase, localObsFotos, localFotoMapa } = {}) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const pw = 210, margin = 14, colL = margin
  let y = 0

  // Cabeçalho
  doc.setFillColor(17, 26, 20); doc.rect(0, 0, pw, 28, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont('helvetica', 'bold')
  doc.text('OROFLY', margin, 13)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.setTextColor(138, 173, 148); doc.text('Relatório de Operação de Drone', margin, 19)
  doc.setTextColor(200, 238, 216)
  doc.text(new Date(rel.created_at || Date.now()).toLocaleString('pt-BR'), pw - margin, 19, { align: 'right' })
  doc.setFillColor(240, 192, 64); doc.rect(0, 27, pw, 1.5, 'F')
  y = 35

  function pdfSec(t) {
    if (y > 260) { doc.addPage(); y = 20 }
    doc.setFillColor(232, 245, 238); doc.rect(margin, y, pw - margin * 2, 7, 'F')
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 122, 74)
    doc.text(t.toUpperCase(), margin + 3, y + 5); y += 9
  }
  function pdfRow(l, v, s) {
    if (y > 265) { doc.addPage(); y = 20 }
    if (s) { doc.setFillColor(250, 252, 250); doc.rect(margin, y - 1, pw - margin * 2, 7, 'F') }
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 128, 112)
    doc.text(l + ':', colL + 2, y + 4)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(17, 26, 20)
    const lines = doc.splitTextToSize(String(v || '—'), 108)
    doc.text(lines, colL + 44, y + 4)
    y += lines.length > 1 ? lines.length * 5 + 2 : 8
  }
  async function addImage(imgData, label, maxH = 70) {
    if (!imgData) return
    try {
      if (y > 220) { doc.addPage(); y = 20 }
      if (label) { pdfSec(label) }
      const props = doc.getImageProperties(imgData)
      const maxW = pw - margin * 2
      const ratio = Math.min(maxW / props.width, maxH / props.height)
      const iw = props.width * ratio, ih = props.height * ratio
      doc.addImage(imgData, 'JPEG', margin + (maxW - iw) / 2, y, iw, ih)
      y += ih + 6
    } catch (e) { console.warn('addImage error', e) }
  }

  // Identificação
  pdfSec('Identificação')
  pdfRow('Cliente', rel.cliente, true); pdfRow('Fazenda', rel.fazenda, false)
  pdfRow('Piloto', rel.piloto_nome, true); pdfRow('Drone', rel.drone, false)
  const produtos = rel.produtos || []
  produtos.forEach((p, i) => pdfRow('Produto ' + (i + 1), p, i % 2 === 0))
  y += 4

  // Localização
  pdfSec('Localização')
  pdfRow('Localização', rel.localizacao, true)
  pdfRow('GPS', rel.gps_lat ? `${rel.gps_lat}, ${rel.gps_lng}` : '—', false)
  if (rel.gps_lat) pdfRow('Google Maps', `https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`, true)
  y += 4

  // Condições lado a lado
  pdfSec('Condições de Aplicação')
  const midX = margin + (pw - margin * 2) / 2
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 122, 74)
  doc.text('INÍCIO', margin + 3, y + 4); doc.text('FIM', midX + 3, y + 4); y += 7

  // Adiciona unidade se o valor for só número
  function addUnit(key, val) {
    if (!val || val === '—') return val || '—'
    const units = { faixa:'m', vazao:'L/ha', vento:'km/h', umidade:'%', temperatura:'°C', delta_t:'' }
    const unit = units[key] || ''
    // Se já tem letras/símbolos de unidade, não adiciona
    if (!unit || /[a-zA-Z°%\/]/.test(val)) return val
    return val + ' ' + unit
  }

  const condKeys = [['Faixa','faixa'],['Vazão','vazao'],['Vento','vento'],['Umidade','umidade'],['Temperatura','temperatura'],['Delta T','delta_t']]
  condKeys.forEach(([lbl, key], i) => {
    if (y > 265) { doc.addPage(); y = 20 }
    if (i % 2 === 0) { doc.setFillColor(250, 252, 250); doc.rect(margin, y - 1, pw - margin * 2, 7, 'F') }
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 128, 112)
    doc.text(lbl + ':', margin + 2, y + 4); doc.text(lbl + ':', midX + 2, y + 4)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(17, 26, 20)
    doc.text(addUnit(key, rel[key + '_i']), margin + 28, y + 4)
    doc.text(addUnit(key, rel[key + '_f']), midX + 28, y + 4)
    y += 8
  }); y += 4

  // Tempo de voo
  function calcTempo(ini, fim, pausaIni, pausaFim) {
    if (!ini || !fim) return null
    const totalMin = Math.round((new Date(fim) - new Date(ini)) / 60000)
    if (totalMin <= 0) return null
    let pausaMin = 0
    if (pausaIni && pausaFim) {
      pausaMin = Math.max(0, Math.round((new Date(pausaFim) - new Date(pausaIni)) / 60000))
    }
    const fmtMin = m => { const h=Math.floor(m/60),min=m%60; return h>0?`${h}h${String(min).padStart(2,'0')}min`:`${min}min` }
    return { total: fmtMin(totalMin), efetivo: fmtMin(totalMin-pausaMin), temPausa: pausaMin>0 }
  }
  const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausa_inicio, rel.pausa_fim)

  // Horários
  const fmt = (v) => v ? new Date(v).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'
  pdfSec('Horários')
  pdfRow('Início', fmt(rel.dt_inicio), true); pdfRow('Fim', fmt(rel.dt_fim), false)
  if (tempo) {
    pdfRow('Tempo total', tempo.total, true)
    if (tempo.temPausa) pdfRow('Tempo efetivo', tempo.efetivo, false)
  }
  if (rel.pausa) {
    pdfRow('Motivo pausa', rel.pausa_motivo, true)
    pdfRow('Pausa início', fmt(rel.pausa_inicio), false)
    pdfRow('Pausa fim', fmt(rel.pausa_fim), true)
  } else { pdfRow('Pausa', 'Não houve', true) }
  y += 4

  // Observações
  pdfSec('Observações')
  pdfRow('Obs 1', rel.obs1, true); pdfRow('Obs 2', rel.obs2, false); y += 4

  // KML
  if (rel.kml_arquivos?.length) {
    pdfSec('Arquivos KML')
    rel.kml_arquivos.forEach((f, i) => pdfRow('Arquivo', f, i % 2 === 0)); y += 4
  }

  // ---- FOTOS ----
  // Fotos de observação — usa locais (base64) se disponíveis, senão baixa do Storage
  const obsImgs = []
  if (localObsFotos?.some(Boolean)) {
    localObsFotos.forEach(f => obsImgs.push(f))
  } else if (supabase && rel.obs_fotos_urls?.some(Boolean)) {
    for (const path of rel.obs_fotos_urls) {
      if (path) obsImgs.push(await fetchImageBase64(supabase, 'relatorios', path))
      else obsImgs.push(null)
    }
  }
  const obsValidas = obsImgs.filter(Boolean)
  if (obsValidas.length) {
    if (y > 200) { doc.addPage(); y = 20 }
    pdfSec('Fotos de Observação')
    const slotW = (pw - margin * 2) / 3 - 3
    for (let i = 0; i < obsValidas.length; i++) {
      try {
        const props = doc.getImageProperties(obsValidas[i])
        const r = Math.min(slotW / props.width, 55 / props.height)
        doc.addImage(obsValidas[i], 'JPEG', margin + i * (slotW + 3), y, props.width * r, props.height * r)
      } catch (e) { console.warn('obs foto error', e) }
    }
    y += 60
  }

  // Foto mapa — usa local se disponível, senão baixa do Storage
  let mapaImg = localFotoMapa || null
  if (!mapaImg && supabase && rel.foto_mapa_url) {
    mapaImg = await fetchImageBase64(supabase, 'relatorios', rel.foto_mapa_url)
  }
  if (mapaImg) await addImage(mapaImg, 'Mapa de Pós Aplicação', 80)

  // Rodapé
  doc.setFillColor(17, 26, 20); doc.rect(0, 287, pw, 10, 'F')
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(138, 173, 148)
  doc.text('Orofly — Sistema de Gestão de Operações de Drone', pw / 2, 293, { align: 'center' })

  return doc
}
