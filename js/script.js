// SIRGAS 2000 / UTM Fuso 24S — EPSG:31984
proj4.defs('EPSG:31984', '+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');

const WGS84 = 'EPSG:4326';
const UTM24S = 'EPSG:31984';

let map, markerLayer, circleLayer, streetsLayer;
let geojsonData = null;
let centerLL = null;

// --- Inicializa mapa ---
map = L.map('map').setView([-7.12, -34.86], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// Clique no mapa define centro
map.on('click', function(e){ definirCentro(e.latlng); });

document.getElementById('search-input').addEventListener('keydown', e => { if(e.key==='Enter') buscar(); });
document.getElementById('raio').addEventListener('change', () => {
  if(circleLayer && centerLL) {
    circleLayer.setRadius(parseInt(document.getElementById('raio').value));
  }
});

// --- Funções auxiliares ---
function log(msg, tipo='info'){
  const d = document.getElementById('log');
  const p = document.createElement('div');
  p.className = 'log-' + tipo;
  const t = new Date().toLocaleTimeString('pt-BR');
  p.textContent = `[${t}] ${msg}`;
  d.appendChild(p);
  d.scrollTop = d.scrollHeight;
}

function setStatus(l, r){
  document.getElementById('sl').textContent = l;
  if(r !== undefined) document.getElementById('sr').textContent = r;
}

function loading(show, msg){
  document.getElementById('overlay').style.display = show ? 'flex' : 'none';
  if(msg) document.getElementById('overlay-msg').textContent = msg;
}

function toUTM(lon, lat){
  return proj4(WGS84, UTM24S, [lon, lat]);
}

function definirCentro(latlng){
  centerLL = latlng;
  const raio = parseInt(document.getElementById('raio').value);

  if(markerLayer) map.removeLayer(markerLayer);
  if(circleLayer) map.removeLayer(circleLayer);

  markerLayer = L.marker(latlng, {
    icon: L.divIcon({
      className:'',
      html:`<div style="width:12px;height:12px;background:#c0392b;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
      iconAnchor:[6,6]
    })
  }).addTo(map).bindPopup(`Centro: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`);

  circleLayer = L.circle(latlng, {
    radius: raio, color:'#1a6bbd', fillColor:'#1a6bbd',
    fillOpacity:.06, weight:1.5, dashArray:'6 4'
  }).addTo(map);

  const utm = toUTM(latlng.lng, latlng.lat);
  setStatus(`Centro: Lat ${latlng.lat.toFixed(6)}, Lon ${latlng.lng.toFixed(6)}   |   UTM: E ${utm[0].toFixed(1)} N ${utm[1].toFixed(1)}`, `Raio: ${raio} m`);
  document.getElementById('btn-extrair').disabled = false;
  log(`Centro definido — Lat: ${latlng.lat.toFixed(5)}, Lon: ${latlng.lng.toFixed(5)}`, 'info');
  log(`UTM 24S: E=${utm[0].toFixed(1)} m, N=${utm[1].toFixed(1)} m`, 'info');
}

// --- Geocodificação ---
async function buscar(){
  const q = document.getElementById('search-input').value.trim();
  if(!q){ alert('Digite um endereço para buscar.'); return; }
  loading(true, 'Geocodificando endereço...');
  log(`Buscando: "${q}"`, 'info');
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`;
    const resp = await fetch(url, { headers:{'Accept-Language':'pt-BR,pt', 'User-Agent':'ArruamentoExtractor/1.0'} });
    const data = await resp.json();
    if(!data.length){
      log('Endereço não encontrado. Tente adicionar cidade/UF.', 'warn');
      alert('Endereço não encontrado.\nDica: inclua a cidade e o estado (ex.: "Av. Epitácio Pessoa, João Pessoa, PB")');
      loading(false); return;
    }
    const r = data[0];
    log(`Encontrado: ${r.display_name}`, 'ok');
    const ll = L.latLng(parseFloat(r.lat), parseFloat(r.lon));
    map.setView(ll, 15);
    definirCentro(ll);
  } catch(e){
    log('Erro na geocodificação: ' + e.message, 'err');
    alert('Erro ao buscar o endereço. Verifique sua conexão e tente novamente.');
  }
  loading(false);
}

// --- Extração via Overpass ---
async function extrair(){
  if(!centerLL){ alert('Defina o centro clicando no mapa ou buscando um endereço.'); return; }

  const raio = parseInt(document.getElementById('raio').value);
  const tipo = document.getElementById('tipo').value;
  const {lat, lng} = centerLL;

  // Filtros de tipo de via
  const filtros = {
    all:    'motorway|trunk|primary|secondary|tertiary|residential|living_street|service|unclassified|footway|cycleway|path|track',
    paved:  'motorway|trunk|primary|secondary|tertiary|residential|living_street|service|unclassified',
    primary:'motorway|trunk|primary|secondary|tertiary',
    local:  'residential|living_street|service|unclassified'
  };
  const regex = filtros[tipo] || filtros.all;

  const query = `[out:json][timeout:60];
(
  way["highway"~"^(${regex})$"](around:${raio},${lat},${lng});
);
(._;>;);
out body;`;

  log(`Consultando Overpass API — raio ${raio}m, tipo: ${tipo}`, 'info');
  loading(true, 'Consultando OpenStreetMap (Overpass API)...');

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });

    if(!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    const data = await resp.json();
    log(`Resposta recebida: ${data.elements.length} elementos OSM`, 'ok');
    processar(data, raio);
  } catch(e){
    log('Erro na consulta: ' + e.message, 'err');
    alert('Erro ao consultar o OpenStreetMap.\n\nPossíveis causas:\n• Sem conexão com a internet\n• Servidor Overpass sobrecarregado (tente novamente)\n• Área muito grande\n\nErro: ' + e.message);
  }
  loading(false);
}

// --- Processamento e reprojeção ---
function processar(osmData, raio){
  const nodes = {};
  osmData.elements.filter(e => e.type==='node').forEach(n => { nodes[n.id] = [n.lon, n.lat]; });

  const ways = osmData.elements.filter(e => e.type==='way');
  const features = [];
  let totalPts = 0;
  let totalExt = 0;
  const tiposSet = new Set();

  ways.forEach(way => {
    const coordsWGS = way.nodes.map(id => nodes[id]).filter(Boolean);
    if(coordsWGS.length < 2) return;

    // Reprojeção para UTM SIRGAS 2000 24S
    const coordsUTM = coordsWGS.map(c => toUTM(c[0], c[1]));

    // Calcula extensão do trecho (UTM → metros)
    let ext = 0;
    for(let i = 1; i < coordsUTM.length; i++){
      const dx = coordsUTM[i][0] - coordsUTM[i-1][0];
      const dy = coordsUTM[i][1] - coordsUTM[i-1][1];
      ext += Math.sqrt(dx*dx + dy*dy);
    }
    totalExt += ext;
    totalPts += coordsWGS.length;
    const hw = way.tags?.highway || 'unknown';
    tiposSet.add(hw);

    // Ponto UTM do primeiro nó (referência)
    const utmInicio = coordsUTM[0];
    const utmFim    = coordsUTM[coordsUTM.length-1];

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordsWGS   // GeoJSON padrão = WGS84
      },
      properties: {
        // Identificação
        osm_id:         way.id,
        nome:           way.tags?.name || '',
        tipo_via:       hw,
        referencia:     way.tags?.ref || '',
        // Características
        sentido:        way.tags?.oneway || 'não',
        faixas:         parseInt(way.tags?.lanes) || '',
        vel_max_kmh:    parseInt(way.tags?.maxspeed) || '',
        revestimento:   way.tags?.surface || '',
        iluminacao:     way.tags?.lit || '',
        // Métricas (UTM 24S)
        extensao_m:     parseFloat(ext.toFixed(2)),
        n_vertices:     coordsWGS.length,
        // Coordenadas UTM início/fim (SIRGAS 2000 UTM 24S)
        utm_inicio_e:   parseFloat(utmInicio[0].toFixed(3)),
        utm_inicio_n:   parseFloat(utmInicio[1].toFixed(3)),
        utm_fim_e:      parseFloat(utmFim[0].toFixed(3)),
        utm_fim_n:      parseFloat(utmFim[1].toFixed(3)),
        // CRS info
        crs_epsg:       31984,
        crs_nome:       'SIRGAS 2000 / UTM zone 24S',
      }
    });
  });

  // Ponto central em UTM
  const utmCentro = toUTM(centerLL.lng, centerLL.lat);

  geojsonData = {
    type: 'FeatureCollection',
    name: 'arruamento_sirgas2000_utm24s',
    crs: {
      type: 'name',
      properties: {
        name: 'urn:ogc:def:crs:EPSG::4326'   // geometria em WGS84
      }
    },
    metadata: {
      titulo:           'Arruamento extraído via OpenStreetMap',
      datum:            'SIRGAS 2000',
      projecao:         'UTM Fuso 24S',
      epsg:             31984,
      geom_crs:         'WGS84 EPSG:4326 (coordenadas da geometria)',
      atrib_crs:        'SIRGAS 2000 UTM 24S EPSG:31984 (atributos utm_*)',
      extraido_em:      new Date().toISOString(),
      fonte:            'OpenStreetMap via Overpass API',
      centro_lat:       centerLL.lat,
      centro_lon:       centerLL.lng,
      centro_utm_e:     parseFloat(utmCentro[0].toFixed(3)),
      centro_utm_n:     parseFloat(utmCentro[1].toFixed(3)),
      raio_m:           raio,
      total_vias:       features.length,
      extensao_total_m: parseFloat(totalExt.toFixed(2)),
      extensao_total_km:parseFloat((totalExt/1000).toFixed(3)),
      tipos_via:        [...tiposSet].sort(),
    },
    features
  };

  // Atualiza estatísticas
  document.getElementById('s-vias').textContent  = features.length;
  document.getElementById('s-ext').textContent   = (totalExt/1000).toFixed(2);
  document.getElementById('s-pts').textContent   = totalPts;
  document.getElementById('s-tipos').textContent = tiposSet.size;

  // Renderiza no mapa
  if(streetsLayer) map.removeLayer(streetsLayer);
  streetsLayer = L.geoJSON(geojsonData, {
    style: f => estiloVia(f.properties.tipo_via),
    onEachFeature: (f, l) => {
      const p = f.properties;
      l.bindPopup(`
        <b>${p.nome || '(sem nome)'}</b><br>
        <span style="font-size:11px;color:#666">${p.tipo_via}</span><br>
        <hr style="margin:4px 0;border-color:#eee"/>
        Extensão: <b>${p.extensao_m.toFixed(0)} m</b><br>
        ${p.faixas ? 'Faixas: <b>'+p.faixas+'</b><br>' : ''}
        ${p.vel_max_kmh ? 'Vel. máx: <b>'+p.vel_max_kmh+' km/h</b><br>' : ''}
        ${p.revestimento ? 'Revestimento: <b>'+p.revestimento+'</b><br>' : ''}
        <hr style="margin:4px 0;border-color:#eee"/>
        <span style="font-size:10px;color:#888">
          UTM Início: E ${p.utm_inicio_e.toFixed(0)} N ${p.utm_inicio_n.toFixed(0)}<br>
          UTM Fim: E ${p.utm_fim_e.toFixed(0)} N ${p.utm_fim_n.toFixed(0)}<br>
          OSM ID: ${p.osm_id}
        </span>
      `);
    }
  }).addTo(map);
  map.fitBounds(streetsLayer.getBounds(), {padding:[30,30]});

  log(`Processadas ${features.length} vias — ${(totalExt/1000).toFixed(2)} km total — ${tiposSet.size} tipos`, 'ok');
  log(`Reprojetado para SIRGAS 2000 UTM 24S (EPSG:31984)`, 'ok');
  setStatus(`${features.length} vias extraídas — ${(totalExt/1000).toFixed(2)} km`, `${tiposSet.size} tipos de via`);

  document.getElementById('btn-geojson').disabled = false;
  document.getElementById('btn-csv').disabled     = false;
  document.getElementById('btn-limpar').disabled  = false;
}

function estiloVia(hw){
  const estilos = {
    motorway:     {color:'#c0392b', weight:5},
    trunk:        {color:'#c0392b', weight:5},
    primary:      {color:'#c0392b', weight:4},
    secondary:    {color:'#e67e22', weight:3},
    tertiary:     {color:'#e67e22', weight:2.5},
    residential:  {color:'#2980b9', weight:2},
    living_street:{color:'#2980b9', weight:1.5},
    unclassified: {color:'#2980b9', weight:1.5},
    service:      {color:'#27ae60', weight:1.5},
    footway:      {color:'#888',    weight:1},
    cycleway:     {color:'#8e44ad', weight:1.5, dashArray:'5 3'},
    path:         {color:'#888',    weight:1,   dashArray:'4 3'},
    track:        {color:'#888',    weight:1,   dashArray:'6 4'},
  };
  return estilos[hw] || {color:'#aaa', weight:1};
}

// --- Exportação GeoJSON ---
function exportGeoJSON(){
  if(!geojsonData){ alert('Nenhum dado para exportar.'); return; }
  const json = JSON.stringify(geojsonData, null, 2);
  baixar(json, `arruamento_sirgas2000_utm24s_${datahora()}.geojson`, 'application/geo+json');
  log('GeoJSON exportado com sucesso', 'ok');
}

// --- Exportação CSV ---
function exportCSV(){
  if(!geojsonData){ alert('Nenhum dado para exportar.'); return; }
  const cols = [
    'osm_id','nome','tipo_via','referencia','sentido','faixas','vel_max_kmh',
    'revestimento','iluminacao','extensao_m','n_vertices',
    'utm_inicio_e','utm_inicio_n','utm_fim_e','utm_fim_n','crs_epsg','crs_nome'
  ];
  const linhas = [cols.join(';')];
  geojsonData.features.forEach(f => {
    const p = f.properties;
    linhas.push(cols.map(c => {
      const v = p[c] === undefined || p[c] === null ? '' : p[c];
      return String(v).includes(';') ? `"${v}"` : v;
    }).join(';'));
  });
  baixar(linhas.join('\n'), `arruamento_${datahora()}.csv`, 'text/csv;charset=utf-8');
  log('CSV exportado com sucesso', 'ok');
}

function baixar(conteudo, nome, tipo){
  const blob = new Blob(['\ufeff' + conteudo], {type: tipo});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function datahora(){
  return new Date().toISOString().replace(/[:.]/g,'-').slice(0,16);
}

function limpar(){
  if(streetsLayer) { map.removeLayer(streetsLayer); streetsLayer=null; }
  geojsonData = null;
  document.getElementById('s-vias').textContent  = '—';
  document.getElementById('s-ext').textContent   = '—';
  document.getElementById('s-pts').textContent   = '—';
  document.getElementById('s-tipos').textContent = '—';
  document.getElementById('btn-geojson').disabled = true;
  document.getElementById('btn-csv').disabled     = true;
  document.getElementById('btn-limpar').disabled  = true;
  log('Dados limpos', 'info');
}

log('Aplicação iniciada. Clique no mapa ou busque um endereço para começar.', 'ok');
