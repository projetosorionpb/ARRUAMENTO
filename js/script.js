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

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  
  let data = null;
  let lastError = null;
  
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      data = await resp.json();
      log(`Sucesso via ${url}`, 'ok');
      break; // Sai do loop se der certo
    } catch(e) {
      lastError = e;
      log(`Falha na API ${url}: ${e.message}`, 'warn');
    }
  }

  if (data) {
    log(`Resposta recebida: ${data.elements.length} elementos OSM`, 'ok');
    processar(data, raio);
  } else {
    log('Erro na consulta em todas as APIs: ' + (lastError ? lastError.message : ''), 'err');
    alert('Erro ao consultar o OpenStreetMap.\n\nPossíveis causas:\n• Sem conexão com a internet ou bloqueio de rede\n• Servidores Overpass sobrecarregados (tente novamente)\n• Área muito grande\n\nErro: ' + (lastError ? lastError.message : ''));
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

    // Determina a largura da via em metros para o contorno
    let faixas = parseInt(way.tags?.lanes);
    let widthMeters = 8; // padrão
    if(faixas && !isNaN(faixas)) {
      widthMeters = faixas * 3.5;
    } else {
      const widMap = {
        motorway: 20, trunk: 20, primary: 14, secondary: 12, tertiary: 10,
        residential: 7, living_street: 6, unclassified: 7, service: 5,
        footway: 2, cycleway: 2, path: 2, track: 3
      };
      widthMeters = widMap[hw] || 8;
    }

    const lineFeature = {
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
        largura_m:      widthMeters,
      }
    };

    // Gera o contorno (Polygon) usando turf.js
    try {
      const polyFeature = turf.buffer(lineFeature, widthMeters / 2, {units: 'meters'});
      if (polyFeature) {
        polyFeature.properties = lineFeature.properties;
        polyFeature.properties._centerline = coordsWGS; // guarda eixo original para DXF
        features.push(polyFeature);
      } else {
        features.push(lineFeature);
      }
    } catch(e) {
      features.push(lineFeature);
    }
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
  document.getElementById('btn-dxf').disabled     = false;
  document.getElementById('dxf-scale').disabled   = false;
  document.getElementById('btn-csv').disabled     = false;
  document.getElementById('btn-limpar').disabled  = false;
}

function estiloVia(hw){
  const estilos = {
    motorway:     {color:'#c0392b', weight:1, fillColor:'#c0392b', fillOpacity: 0.5},
    trunk:        {color:'#c0392b', weight:1, fillColor:'#c0392b', fillOpacity: 0.5},
    primary:      {color:'#c0392b', weight:1, fillColor:'#c0392b', fillOpacity: 0.5},
    secondary:    {color:'#e67e22', weight:1, fillColor:'#e67e22', fillOpacity: 0.5},
    tertiary:     {color:'#e67e22', weight:1, fillColor:'#e67e22', fillOpacity: 0.5},
    residential:  {color:'#2980b9', weight:1, fillColor:'#2980b9', fillOpacity: 0.5},
    living_street:{color:'#2980b9', weight:1, fillColor:'#2980b9', fillOpacity: 0.5},
    unclassified: {color:'#2980b9', weight:1, fillColor:'#2980b9', fillOpacity: 0.5},
    service:      {color:'#27ae60', weight:1, fillColor:'#27ae60', fillOpacity: 0.5},
    footway:      {color:'#888',    weight:1, fillColor:'#888',    fillOpacity: 0.5},
    cycleway:     {color:'#8e44ad', weight:1, fillColor:'#8e44ad', fillOpacity: 0.5, dashArray:'5 3'},
    path:         {color:'#888',    weight:1, fillColor:'#888',    fillOpacity: 0.5, dashArray:'4 3'},
    track:        {color:'#888',    weight:1, fillColor:'#888',    fillOpacity: 0.5, dashArray:'6 4'},
  };
  return estilos[hw] || {color:'#aaa', weight:1, fillColor:'#aaa', fillOpacity:0.5};
}

// --- Função auxiliar para transformar coordenadas WGS84 para UTM 24S ---
function projWGS2UTM(coords) {
  if (typeof coords[0] === 'number') {
    const utm = toUTM(coords[0], coords[1]);
    return [parseFloat(utm[0].toFixed(3)), parseFloat(utm[1].toFixed(3))];
  } else {
    return coords.map(projWGS2UTM);
  }
}

// --- Exportação GeoJSON ---
function exportGeoJSON(){
  if(!geojsonData){ alert('Nenhum dado para exportar.'); return; }
  
  // Cria uma cópia profunda para converter geometria para UTM 24S (escala real em metros)
  const exportData = JSON.parse(JSON.stringify(geojsonData));
  exportData.features.forEach(f => {
    f.geometry.coordinates = projWGS2UTM(f.geometry.coordinates);
  });
  
  exportData.crs.properties.name = 'urn:ogc:def:crs:EPSG::31984';
  exportData.name = 'arruamento_utm24s_escala_real';

  const json = JSON.stringify(exportData, null, 2);
  baixar(json, `arruamento_contornos_utm24s_${datahora()}.geojson`, 'application/geo+json');
  log('GeoJSON exportado com sucesso (Coordenadas UTM, Escala 1:1)', 'ok');
}

// --- Exportação DXF ---
// Gera linhas paralelas (bordas) de cada via, SEM fechar polígono
function offsetPolyline(ptsUTM, dist) {
  // Gera uma polyline deslocada perpendicularmente por 'dist' metros
  const result = [];
  for (let i = 0; i < ptsUTM.length; i++) {
    let nx = 0, ny = 0;
    if (i < ptsUTM.length - 1) {
      const dx = ptsUTM[i+1][0] - ptsUTM[i][0];
      const dy = ptsUTM[i+1][1] - ptsUTM[i][1];
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      nx = -dy / len;
      ny =  dx / len;
    } else {
      // Último ponto: usa a direção do segmento anterior
      const dx = ptsUTM[i][0] - ptsUTM[i-1][0];
      const dy = ptsUTM[i][1] - ptsUTM[i-1][1];
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      nx = -dy / len;
      ny =  dx / len;
    }
    result.push([ptsUTM[i][0] + nx * dist, ptsUTM[i][1] + ny * dist]);
  }
  return result;
}

function exportDXF(){
  if(!geojsonData){ alert('Nenhum dado para exportar.'); return; }

  log('Gerando DXF — unindo polígonos de vias...', 'info');

  // 1. Coleta todos os polígonos bufferizados e faz a união (merge) deles
  let merged = null;
  let countMerged = 0;

  geojsonData.features.forEach(f => {
    let poly = null;
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      poly = f;
    } else if (f.geometry.type === 'LineString' && f.properties._centerline) {
      // Tenta gerar buffer se ainda for LineString
      try {
        poly = turf.buffer(f, (f.properties.largura_m || 8) / 2, {units: 'meters'});
      } catch(e) { /* ignora */ }
    }
    if (!poly) return;

    try {
      if (!merged) {
        merged = poly;
      } else {
        merged = turf.union(merged, poly);
      }
      countMerged++;
    } catch(e) {
      // Se falhar a união de um polígono individual, pula
    }
  });

  if (!merged) {
    alert('Não foi possível gerar o DXF. Nenhum polígono válido.');
    return;
  }

  log(`${countMerged} polígonos unidos. Extraindo contornos...`, 'info');

  // 2. Extrai os anéis (contornos) do polígono unido
  const polylines = [];
  const layer = 'arruamento';

function extrairAneis(geom, escalaMultiplier) {
    if (geom.type === 'Polygon') {
      geom.coordinates.forEach(anel => {
        const ptsUTM = anel.map(c => {
          const utm = toUTM(c[0], c[1]);
          return [utm[0] * escalaMultiplier, utm[1] * escalaMultiplier];
        });
        polylines.push(ptsUTM);
      });
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(poly => {
        poly.forEach(anel => {
          const ptsUTM = anel.map(c => {
            const utm = toUTM(c[0], c[1]);
            return [utm[0] * escalaMultiplier, utm[1] * escalaMultiplier];
          });
          polylines.push(ptsUTM);
        });
      });
    }
  }

  const escalaMultiplier = parseInt(document.getElementById('dxf-scale').value) || 1;
  extrairAneis(merged.geometry || merged, escalaMultiplier);

  // 3. Monta DXF AC1009
  const pairs = [];
  function g(code, val) { pairs.push(String(code).padStart(3), String(val)); }

  // === HEADER ===
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSBASE'); g(10, '0.0'); g(20, '0.0'); g(30, '0.0');
  g(9, '$EXTMIN'); g(10, '0.0'); g(20, '0.0'); g(30, '0.0');
  g(9, '$EXTMAX'); g(10, '50000000.0'); g(20, '50000000.0'); g(30, '0.0');
  g(0, 'ENDSEC');

  // === TABLES ===
  g(0, 'SECTION'); g(2, 'TABLES');

  // LTYPE table
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, '1');
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, '0'); g(3, 'Solid line'); g(72, '65'); g(73, '0'); g(40, '0.0');
  g(0, 'ENDTAB');

  // LAYER table — tudo preto (cor 7)
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, '2');
  g(0, 'LAYER'); g(2, '0'); g(70, '0'); g(62, '7'); g(6, 'CONTINUOUS');
  g(0, 'LAYER'); g(2, layer); g(70, '0'); g(62, '7'); g(6, 'CONTINUOUS');
  g(0, 'ENDTAB');

  // STYLE table
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, '1');
  g(0, 'STYLE'); g(2, 'STANDARD'); g(70, '0'); g(40, '0.0'); g(41, '1.0'); g(50, '0.0'); g(71, '0'); g(3, 'txt');
  g(0, 'ENDTAB');

  g(0, 'ENDSEC');

  // === ENTITIES (POLYLINE + VERTEX + SEQEND) ===
  g(0, 'SECTION'); g(2, 'ENTITIES');

  polylines.forEach(pts => {
    g(0, 'POLYLINE');
    g(8, layer);
    g(66, '1');
    g(70, '1');  // 1 = polyline fechada
    g(10, '0.0'); g(20, '0.0'); g(30, '0.0');

    pts.forEach(p => {
      g(0, 'VERTEX');
      g(8, layer);
      g(10, p[0].toFixed(4));
      g(20, p[1].toFixed(4));
      g(30, '0.0');
    });

    g(0, 'SEQEND');
    g(8, layer);
  });

  g(0, 'ENDSEC');

  // === EOF ===
  g(0, 'EOF');

  const dxfStr = pairs.join('\r\n') + '\r\n';

  // Download sem BOM
  const blob = new Blob([dxfStr], {type: 'application/octet-stream'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `arruamento_contornos_utm24s_${datahora()}.dxf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  log(`DXF exportado: ${polylines.length} polylines (preto) — interseções unidas`, 'ok');
}

// --- Exportação CSV ---
function exportCSV(){
  if(!geojsonData){ alert('Nenhum dado para exportar.'); return; }
  const cols = [
    'osm_id','nome','tipo_via','referencia','sentido','faixas','vel_max_kmh',
    'revestimento','iluminacao','extensao_m','n_vertices','largura_m',
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
  document.getElementById('btn-dxf').disabled     = true;
  document.getElementById('dxf-scale').disabled   = true;
  document.getElementById('btn-csv').disabled     = true;
  document.getElementById('btn-limpar').disabled  = true;
  log('Dados limpos', 'info');
}

log('Aplicação iniciada. Clique no mapa ou busque um endereço para começar.', 'ok');
