
const ALL_SPOTS = [...SPOTS_PART1, ...SPOTS_PART2];
const INHA_COORDS = [37.4536, 126.6629];

let activeCategory = 'all';
let searchQuery = '';
let onlySaved = false;
let currentView = 'split'; // 'split' | 'map' | 'grid' | 'table' | 'videos'
let savedIds = new Set(JSON.parse(localStorage.getItem('inha_saved_spots') || '[1, 2, 31, 41, 81, 101]'));
let routeIds = [1, 2, 3, 7];
let currentFiltered = [...ALL_SPOTS];

// ==========================================================
// 1. REAL PLACE PHOTO ENGINE (Wikipedia KO/EN + Wikimedia Commons)
// ==========================================================
let realPhotoCache = {};
try {
  realPhotoCache = JSON.parse(localStorage.getItem('inha_real_place_photos_v4') || '{}');
} catch (e) {
  realPhotoCache = {};
}

// Pre-populate cache for spots that already have official verified photos
realPhotoCache[1] = "https://www.inha.ac.kr/sites/kr/atchmnfl/bbs/64/thumbnail/thumb_temp_1787033417634100.jpg";
realPhotoCache[7] = "https://ak-d.tripcdn.com/images/1i62322349lse2e00FD0C.jpg?proc=source/trip";
realPhotoCache[31] = "https://datacdn.ibtravel.co.kr/files/2023/08/08162208/85954f7635db5e6f662d5015dd54e494_img-1.jpeg";
realPhotoCache[33] = "https://itour.incheon.go.kr/upload/image/2025/01/22/846c1f13-a945-4f8f-bea1-832e4a820a5e.jpg";
realPhotoCache[38] = "https://media.triple.guide/triple-cms/c_limit,f_auto,h_1024,w_1024/ffb75e1b-2e29-41d7-b6e6-d2abe9e1a9de.jpeg";
realPhotoCache[43] = "https://tong.visitkorea.or.kr/cms/resource/69/2786469_image2_1.jpg";
realPhotoCache[103] = "https://m.starfield.co.kr/cdn/nstfd/images/suwon/starfield/main-library-img01.jpg";
realPhotoCache[124] = "https://tong.visitkorea.or.kr/cms/resource/54/3497254_image2_1.jpg";
realPhotoCache[199] = "https://res.klook.com/image/upload/w_750,h_469,c_fill,q_85/w_80,x_15,y_15,g_south_west,l_Klook_water_br_trans_yhcmh3/activities/g3ctyibukegauetvanop.jpg";
realPhotoCache[200] = "https://images.unsplash.com/photo-1672671187899-a10f547341f1?fm=jpg&q=80&w=1000&auto=format&fit=crop";
realPhotoCache[209] = "https://media.gettyimages.com/id/641245568/photo/sunrise-peak-panorama-jeju-island.jpg?s=612x612&w=gi&k=20&c=NTwiT4iMvX3FhpL3Pm8WIrCNJjriibrJZQGsSaC6KOw=";

ALL_SPOTS.forEach(s => {
  if (realPhotoCache[s.id]) {
    s.img = realPhotoCache[s.id];
    s.hasRealPhoto = true;
  }
});

function isValidRealPhotoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg') || lower.includes('.svg/') || lower.includes('.tif') || lower.includes('.pdf') || lower.includes('.ogg') || lower.includes('.webm')) return false;
  if (lower.includes('map') || lower.includes('locator') || lower.includes('location') || lower.includes('flag') || lower.includes('logo') || lower.includes('icon') || lower.includes('symbol') || lower.includes('emblem') || lower.includes('seal') || lower.includes('route') || lower.includes('diagram') || lower.includes('chart') || lower.includes('signature') || lower.includes('coat_of_arms') || lower.includes('disambig')) return false;
  return true;
}

function saveRealPhotoToCache(spotId, url) {
  if (!isValidRealPhotoUrl(url)) return;
  realPhotoCache[spotId] = url;
  const spot = ALL_SPOTS.find(x => x.id === spotId);
  if (spot) {
    spot.img = url;
    spot.hasRealPhoto = true;
  }
  const imgEl = document.getElementById('card-img-' + spotId);
  if (imgEl && imgEl.src !== url) {
    imgEl.src = url;
  }
  const badgeEl = document.getElementById('photo-badge-' + spotId);
  if (badgeEl) {
    badgeEl.style.display = 'inline-block';
  }
  const popupImg = document.getElementById('popup-img-' + spotId);
  if (popupImg && popupImg.src !== url) {
    popupImg.src = url;
  }
  try {
    localStorage.setItem('inha_real_place_photos_v4', JSON.stringify(realPhotoCache));
  } catch (e) {}
}

async function runBatchWikiPhotoFetch() {
  const unresolved = ALL_SPOTS.filter(s => !realPhotoCache[s.id]);
  if (unresolved.length === 0) {
    updatePhotoStatusText();
    return;
  }

  // Batch fetch from Korean Wikipedia (up to 40 titles per request)
  const chunkSize = 35;
  for (let i = 0; i < unresolved.length; i += chunkSize) {
    const chunk = unresolved.slice(i, i + chunkSize);
    const titleMap = {};
    chunk.forEach(s => {
      const t = s.wikiKo || s.kr;
      if (!titleMap[t]) titleMap[t] = [];
      titleMap[t].push(s.id);
    });
    const titlesParam = Object.keys(titleMap).join('|');
    try {
      const url = `https://ko.wikipedia.org/w/api.php?action=query&origin=*&format=json&prop=pageimages&piprop=thumbnail|original&pithumbsize=900&redirects=1&titles=${encodeURIComponent(titlesParam)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.query && data.query.pages) {
        const redirects = {};
        if (data.query.redirects) {
          data.query.redirects.forEach(r => { redirects[r.to] = r.from; });
        }
        if (data.query.normalized) {
          data.query.normalized.forEach(n => { redirects[n.to] = n.from; });
        }
        Object.values(data.query.pages).forEach(page => {
          const imgUrl = (page.thumbnail && page.thumbnail.source) || (page.original && page.original.source);
          if (imgUrl && isValidRealPhotoUrl(imgUrl)) {
            const origTitle = redirects[page.title] || page.title;
            const matchingSpots = chunk.filter(s => (s.wikiKo === page.title || s.wikiKo === origTitle || s.kr === page.title || page.title.includes(s.wikiKo)));
            matchingSpots.forEach(ms => saveRealPhotoToCache(ms.id, imgUrl));
          }
        });
      }
    } catch (e) {}
  }

  // Second pass: Batch fetch from English Wikipedia for remaining spots
  const stillUnresolved = ALL_SPOTS.filter(s => !realPhotoCache[s.id]);
  for (let i = 0; i < stillUnresolved.length; i += chunkSize) {
    const chunk = stillUnresolved.slice(i, i + chunkSize);
    const titlesParam = [...new Set(chunk.map(s => s.wikiEn))].join('|');
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&prop=pageimages&piprop=thumbnail|original&pithumbsize=900&redirects=1&titles=${encodeURIComponent(titlesParam)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.query && data.query.pages) {
        Object.values(data.query.pages).forEach(page => {
          const imgUrl = (page.thumbnail && page.thumbnail.source) || (page.original && page.original.source);
          if (imgUrl && isValidRealPhotoUrl(imgUrl)) {
            const matchingSpots = chunk.filter(s => s.wikiEn && (page.title.toLowerCase().includes(s.wikiEn.toLowerCase()) || s.wikiEn.toLowerCase().includes(page.title.toLowerCase())));
            matchingSpots.forEach(ms => {
              if (!realPhotoCache[ms.id]) saveRealPhotoToCache(ms.id, imgUrl);
            });
          }
        });
      }
    } catch (e) {}
  }

  updatePhotoStatusText();
}

const inFlightSpotFetches = new Set();

async function fetchSingleSpotRealPhoto(spot) {
  if (!spot || realPhotoCache[spot.id] || inFlightSpotFetches.has(spot.id)) return;
  inFlightSpotFetches.add(spot.id);

  const queries = [
    { api: 'ko', q: spot.kr },
    { api: 'ko', q: spot.wikiKo },
    { api: 'commons', q: `${spot.kr}` },
    { api: 'commons', q: `${spot.wikiKo} ${spot.wikiEn}` },
    { api: 'en', q: `${spot.wikiEn} Korea` },
    { api: 'commons', q: `${spot.wikiEn}` }
  ];

  for (const item of queries) {
    if (!item.q) continue;
    try {
      if (item.api === 'ko' || item.api === 'en') {
        const host = item.api === 'ko' ? 'ko.wikipedia.org' : 'en.wikipedia.org';
        const url = `https://${host}/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${encodeURIComponent(item.q)}&gsrlimit=4&prop=pageimages&piprop=thumbnail|original&pithumbsize=900`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.query && data.query.pages) {
          const pages = Object.values(data.query.pages).sort((a, b) => (a.index || 99) - (b.index || 99));
          for (const p of pages) {
            const imgUrl = (p.thumbnail && p.thumbnail.source) || (p.original && p.original.source);
            if (imgUrl && isValidRealPhotoUrl(imgUrl)) {
              saveRealPhotoToCache(spot.id, imgUrl);
              updatePhotoStatusText();
              return;
            }
          }
        }
      } else if (item.api === 'commons') {
        const url = `https://commons.wikimedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${encodeURIComponent(item.q)}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url&iiurlwidth=900`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.query && data.query.pages) {
          const pages = Object.values(data.query.pages).sort((a, b) => (a.index || 99) - (b.index || 99));
          for (const p of pages) {
            const ii = p.imageinfo && p.imageinfo[0];
            const imgUrl = ii && (ii.thumburl || ii.url);
            if (imgUrl && isValidRealPhotoUrl(imgUrl)) {
              saveRealPhotoToCache(spot.id, imgUrl);
              updatePhotoStatusText();
              return;
            }
          }
        }
      }
    } catch (e) {}
  }
}

let cardObserver = null;
function initCardPhotoObserver() {
  if (!('IntersectionObserver' in window)) return;
  if (cardObserver) cardObserver.disconnect();

  cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const sid = parseInt(entry.target.getAttribute('data-spot-id'), 10);
        const spot = ALL_SPOTS.find(x => x.id === sid);
        if (spot && !realPhotoCache[sid]) {
          fetchSingleSpotRealPhoto(spot);
        }
      }
    });
  }, { rootMargin: '300px' });

  document.querySelectorAll('.spot-card[data-spot-id]').forEach(el => {
    cardObserver.observe(el);
  });
}

function updatePhotoStatusText() {
  const count = Object.keys(realPhotoCache).length;
  const el = document.getElementById('photoEngineStatus');
  if (el) {
    el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Ortsfotos (${count} verifiziert)`;
  }
}

async function loadModalPhotoGallery(spot) {
  const strip = document.getElementById('modalGalleryStrip');
  if (!strip) return;
  strip.innerHTML = `<img src="${spot.img}" class="gallery-thumb active" onclick="switchModalHero(this, '${spot.img}')" alt="${spot.name}" />`;

  const foundUrls = new Set([spot.img]);
  const queries = [spot.kr, spot.wikiKo, `${spot.wikiEn} Korea`];

  for (const q of queries) {
    if (!q || foundUrls.size >= 6) continue;
    try {
      const url = `https://commons.wikimedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url&iiurlwidth=900`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.query && data.query.pages) {
        Object.values(data.query.pages).forEach(p => {
          const ii = p.imageinfo && p.imageinfo[0];
          const imgUrl = ii && (ii.thumburl || ii.url);
          if (imgUrl && isValidRealPhotoUrl(imgUrl) && !foundUrls.has(imgUrl) && foundUrls.size < 6) {
            foundUrls.add(imgUrl);
            if (!realPhotoCache[spot.id]) {
              saveRealPhotoToCache(spot.id, imgUrl);
              document.getElementById('modalImg').src = imgUrl;
            }
            const thumb = document.createElement('img');
            thumb.src = imgUrl;
            thumb.className = 'gallery-thumb';
            thumb.alt = spot.name;
            thumb.onclick = function() { switchModalHero(this, imgUrl); };
            strip.appendChild(thumb);
          }
        });
      }
    } catch (e) {}
  }
}

function switchModalHero(thumbEl, imgUrl) {
  document.getElementById('modalImg').src = imgUrl;
  document.querySelectorAll('.gallery-thumb').forEach(el => el.classList.remove('active'));
  thumbEl.classList.add('active');
}

// ==========================================================
// 2. INTERACTIVE LEAFLET MAP ENGINE
// ==========================================================
let map = null;
let currentTileLayer = null;
let markersLayer = null;
let routePolyline = null;
let markerMap = {};

const CATEGORY_COLORS = {
  'Cafes & Bakery': '#D97706',
  'Food & Markets': '#EA580C',
  'Nature & Coast': '#059669',
  'Culture & History': '#7C3AED',
  'Architecture & Views': '#0284C7',
  'Islands & Day Trips': '#0891B2',
  'Nightlife & Vibes': '#DB2777',
  'Hidden Gems': '#B45309'
};

const MAPBOX_TOKEN = 'pk.eyJ1IjoicGhpeGxpIiwiYSI6ImNtdjk5eXk5ZTAwMXUyeW9qeWF6dzM5bXYifQ.4KhYLJfSByJCpGujjvdB3A';

const TILE_URLS = {
  mapbox_streets: {
    url: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=' + MAPBOX_TOKEN,
    attr: '&copy; <a href="https://www.mapbox.com/" target="_blank">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 20
  },
  mapbox_light: {
    url: 'https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/512/{z}/{x}/{y}@2x?access_token=' + MAPBOX_TOKEN,
    attr: '&copy; Mapbox &copy; OpenStreetMap',
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 20
  },
  mapbox_outdoors: {
    url: 'https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/512/{z}/{x}/{y}@2x?access_token=' + MAPBOX_TOKEN,
    attr: '&copy; Mapbox &copy; OpenStreetMap',
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 20
  },
  mapbox_sat: {
    url: 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=' + MAPBOX_TOKEN,
    attr: '&copy; Mapbox &copy; Maxar',
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 20
  },
  esri: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attr: 'Tiles &copy; Esri &mdash; Street Map',
    tileSize: 256,
    zoomOffset: 0,
    maxZoom: 19
  }
};

function initInteractiveMap() {
  if (typeof L === 'undefined') return;
  const mapEl = document.getElementById('interactiveMap');
  if (!mapEl) return;

  map = L.map('interactiveMap', {
    center: INHA_COORDS,
    zoom: 11,
    zoomControl: true
  });

  changeMapTiles('mapbox_streets');

  // Add permanent Inha University Home Marker
  const inhaIcon = L.divIcon({
    className: '',
    html: `<div class="inha-home-pin">Start: Yongil Elementary</div>`,
    iconSize: [160, 26],
    iconAnchor: [80, 13]
  });

  L.marker(INHA_COORDS, { icon: inhaIcon, zIndexOffset: 1000 })
    .addTo(map)
    .bindPopup(`
      <div style="padding:14px; font-family:'Inter',sans-serif;">
        <div style="font-size:0.7rem; font-weight:700; color:#DC2626; text-transform:uppercase;">Dein Startpunkt (Home Base)</div>
        <div style="font-size:0.95rem; font-weight:800; margin:3px 0;">Yongil Elementary School (용일초등학교)</div>
        <div style="font-size:0.78rem; color:#475569; margin-bottom:8px;">244 Inju-daero, Michuhol-gu, Incheon (Bushaltestelle 37233 • Nahe Inha Uni)</div>
        <a href="https://map.naver.com/p/search/%EC%9A%A9%EC%9D%BC%EC%B4%88%EB%93%B1%ED%95%99%EA%B5%90" target="_blank" rel="noopener" class="btn-naver" style="display:inline-flex;">In Naver Map öffnen</a>
      </div>
    `);

  markersLayer = L.layerGroup().addTo(map);
  updateMapMarkers(currentFiltered);
  drawRoutePolyline();
}

function changeMapTiles(styleKey) {
  if (!map) return;

  if (styleKey === 'mapbox') {
    let token = localStorage.getItem('inha_mapbox_token') || '';
    if (!token) {
      token = prompt('Optionaler Mapbox API-Key (beginnt mit pk.eyJ1...):\n\nHinweis: Für den Standard Esri Street Atlas brauchst du keinen Key!', '');
      if (token && token.trim()) {
        token = token.trim();
        localStorage.setItem('inha_mapbox_token', token);
      } else {
        document.getElementById('mapStyleSelect').value = 'esri';
        changeMapTiles('mapbox_streets');
        return;
      }
    }
    if (currentTileLayer) map.removeLayer(currentTileLayer);
    currentTileLayer = L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=' + token, {
      attribution: '&copy; Mapbox &copy; OpenStreetMap',
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 20
    }).addTo(map);
    return;
  }

  if (!TILE_URLS[styleKey]) return;
  if (currentTileLayer) {
    map.removeLayer(currentTileLayer);
  }
  currentTileLayer = L.tileLayer(TILE_URLS[styleKey].url, {
    attribution: TILE_URLS[styleKey].attr,
    maxZoom: 19,
    detectRetina: true
  }).addTo(map);
}

function updateMapMarkers(spots) {
  document.getElementById('mapPinCount').textContent = spots.length;
  if (!map || !markersLayer) return;

  markersLayer.clearLayers();
  markerMap = {};

  spots.forEach(s => {
    if (!s.lat || !s.lng) return;
    const color = CATEGORY_COLORS[s.category] || '#0284C7';
    const size = s.id < 100 ? 26 : 30;
    const pinIcon = L.divIcon({
      className: '',
      html: `<div class="custom-pin ${s.isHiddenGem ? 'gem-ring' : ''}" style="background:${color}; width:${size}px; height:24px;">${s.id}</div>`,
      iconSize: [size, 24],
      iconAnchor: [size / 2, 12],
      popupAnchor: [0, -12]
    });

    const marker = L.marker([s.lat, s.lng], { icon: pinIcon });
    const naverUrl = getNaverUrl(s.kr);
    const googlePhotosUrl = getGooglePhotosUrl(s.kr, s.name);
    const isSaved = savedIds.has(s.id);

    const popupHtml = `
      <div style="font-family:'Inter',sans-serif;">
        <div style="height:135px; width:100%; background:#0F172A; position:relative; overflow:hidden;">
          <img id="popup-img-${s.id}" src="${s.img}" alt="${s.name}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='https://plus.unsplash.com/premium_photo-1661886333708-877148b43ae1?fm=jpg&q=80&w=1000&auto=format&fit=crop'" />
          <span style="position:absolute; top:8px; left:8px; background:rgba(15,23,42,0.85); color:#fff; font-size:0.68rem; font-weight:600; padding:3px 8px; border-radius:99px;">${s.transitTime}</span>
          <button class="save-btn ${isSaved ? 'saved' : ''}" id="popup-save-img-btn-${s.id}" onclick="toggleSave(${s.id}, event)" title="Auf Merkliste speichern" style="position:absolute; top:8px; right:8px; width:30px; height:30px; z-index:10;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
        <div style="padding:12px;">
          <div style="font-size:0.7rem; color:#64748B; font-weight:600;">#${s.id} • ${s.region} • ★ ${s.rating}</div>
          <div style="font-size:0.92rem; font-weight:800; color:#0F172A; margin:2px 0;">${s.name}</div>
          <div style="font-size:0.78rem; color:#475569; font-weight:600; margin-bottom:6px;">${s.kr}</div>
          <p style="font-size:0.76rem; color:#475569; margin-bottom:10px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${s.desc}</p>
          <div style="display:flex; flex-wrap:wrap; gap:5px;">
            <button id="popup-save-btn-${s.id}" class="btn-card-action ${isSaved ? 'saved' : ''}" style="font-size:0.7rem; padding:4px 8px; display:inline-flex; align-items:center; gap:4px;" onclick="toggleSave(${s.id}, event)" title="Auf Merkliste speichern">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              <span>${isSaved ? 'Gemerkt' : 'Merken'}</span>
            </button>
            <a href="${naverUrl}" target="_blank" rel="noopener" class="btn-naver" style="font-size:0.7rem; padding:4px 8px;">Naver Map</a>
            <a href="${googlePhotosUrl}" target="_blank" rel="noopener" class="btn-google-photos" style="font-size:0.7rem; padding:4px 8px;">Google Fotos</a>
            <button class="btn-card-action" style="font-size:0.7rem; padding:4px 7px;" onclick="addToRoute(${s.id})">+ Route</button>
            <button class="btn-card-action" style="font-size:0.7rem; padding:4px 7px;" onclick="openModal(${s.id})">Details</button>
          </div>
        </div>
      </div>
    `;

    marker.bindPopup(popupHtml);
    marker.on('popupopen', () => {
      if (!realPhotoCache[s.id]) {
        fetchSingleSpotRealPhoto(s);
      }
      const currentlySaved = savedIds.has(s.id);
      const pBtn = document.getElementById(`popup-save-btn-${s.id}`);
      if (pBtn) {
        pBtn.classList.toggle('saved', currentlySaved);
        const svg = pBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', currentlySaved ? 'currentColor' : 'none');
        const span = pBtn.querySelector('span');
        if (span) span.textContent = currentlySaved ? 'Gemerkt' : 'Merken';
      }
      const pImgBtn = document.getElementById(`popup-save-img-btn-${s.id}`);
      if (pImgBtn) {
        pImgBtn.classList.toggle('saved', currentlySaved);
        const svg = pImgBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', currentlySaved ? 'currentColor' : 'none');
      }
    });

    marker.addTo(markersLayer);
    markerMap[s.id] = marker;
  });
}

function jumpMap(lat, lng, zoom) {
  if (!map) return;
  switchDockTab('map');
  map.flyTo([lat, lng], zoom, { duration: 0.8 });
}

function fitMapToFiltered() {
  if (!map || currentFiltered.length === 0) return;
  const coords = currentFiltered.filter(s => s.lat && s.lng).map(s => [s.lat, s.lng]);
  if (coords.length > 0) {
    map.fitBounds(L.latLngBounds(coords), { padding: [30, 30], maxZoom: 14 });
  }
}

function focusSpotOnMap(id, ev) {
  if (ev) ev.stopPropagation();
  const s = ALL_SPOTS.find(x => x.id === id);
  if (!s || !map) return;

  if (window.innerWidth <= 860) {
    setMobileTab('map');
  } else if (currentView === 'grid' || currentView === 'table' || currentView === 'videos') {
    setViewMode('split');
  }
  switchDockTab('map');
  setTimeout(() => {
    map.invalidateSize();
    map.flyTo([s.lat, s.lng], 15, { duration: 0.7 });
    if (markerMap[id]) {
      markerMap[id].openPopup();
    }
  }, 120);
}

function highlightPinOnHover(id) {
  if (!markerMap[id]) return;
  const el = markerMap[id].getElement();
  if (el) {
    el.style.transform += ' scale(1.3)';
    el.style.zIndex = '1000';
  }
}

function unhighlightPinOnHover(id) {
  if (!markerMap[id]) return;
  const el = markerMap[id].getElement();
  if (el) {
    el.style.transform = el.style.transform.replace(' scale(1.3)', '');
  }
}

function drawRoutePolyline() {
  if (!map) return;
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  if (routeIds.length === 0) return;

  const latlngs = [INHA_COORDS];
  routeIds.forEach(id => {
    const s = ALL_SPOTS.find(x => x.id === id);
    if (s && s.lat && s.lng) {
      latlngs.push([s.lat, s.lng]);
    }
  });

  if (latlngs.length > 1) {
    routePolyline = L.polyline(latlngs, {
      color: '#0284C7',
      weight: 3.5,
      dashArray: '8, 8',
      opacity: 0.85
    }).addTo(map);
  }
}

function showRouteOnMap() {
  switchDockTab('map');
  if (!map) return;
  const latlngs = [INHA_COORDS];
  routeIds.forEach(id => {
    const s = ALL_SPOTS.find(x => x.id === id);
    if (s && s.lat && s.lng) latlngs.push([s.lat, s.lng]);
  });
  if (latlngs.length > 1) {
    map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 14 });
  }
}

function switchDockTab(tab) {
  document.getElementById('dockTabMap').classList.toggle('active', tab === 'map');
  document.getElementById('dockTabRoute').classList.toggle('active', tab === 'route');
  document.getElementById('mapDockPanel').style.display = tab === 'map' ? 'block' : 'none';
  document.getElementById('routeDockPanel').style.display = tab === 'route' ? 'block' : 'none';
  if (tab === 'map' && map) {
    setTimeout(() => map.invalidateSize(), 60);
  }
}

// ==========================================================
// 3. URL BUILDERS & UI ACTIONS
// ==========================================================
function getNaverUrl(krName) {
  return 'https://map.naver.com/p/search/' + encodeURIComponent(krName);
}

function getKakaoUrl(krName) {
  return 'https://map.kakao.com/?q=' + encodeURIComponent(krName);
}

function getGooglePhotosUrl(krName, enName) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(krName + ' ' + enName);
}

function getGoogleImagesSearchUrl(krName, enName) {
  return 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(krName + ' ' + enName);
}

function showToast(text) {
  const t = document.getElementById('toastMsg');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  }
  showToast('Kopiert: ' + text);
}

function toggleSave(id, ev) {
  if (ev) ev.stopPropagation();
  const isNowSaved = !savedIds.has(id);
  if (isNowSaved) {
    savedIds.add(id);
    showToast('Zur Merkliste hinzugefügt');
  } else {
    savedIds.delete(id);
    showToast('Aus Merkliste entfernt');
  }
  localStorage.setItem('inha_saved_spots', JSON.stringify([...savedIds]));
  updateSavedBadge();

  // Update card save button if present on page
  const cardBtns = document.querySelectorAll(`.spot-card[data-spot-id="${id}"] .save-btn`);
  cardBtns.forEach(btn => {
    btn.classList.toggle('saved', isNowSaved);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isNowSaved ? 'currentColor' : 'none');
  });

  // Update popup save buttons if popup is currently open
  const popupBtn = document.getElementById(`popup-save-btn-${id}`);
  if (popupBtn) {
    popupBtn.classList.toggle('saved', isNowSaved);
    const svg = popupBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isNowSaved ? 'currentColor' : 'none');
    const span = popupBtn.querySelector('span');
    if (span) span.textContent = isNowSaved ? 'Gemerkt' : 'Merken';
  }
  const popupImgBtn = document.getElementById(`popup-save-img-btn-${id}`);
  if (popupImgBtn) {
    popupImgBtn.classList.toggle('saved', isNowSaved);
    const svg = popupImgBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isNowSaved ? 'currentColor' : 'none');
  }

  // Update modal save button if modal is open
  const modalBtn = document.getElementById(`modal-save-btn-${id}`);
  if (modalBtn) {
    modalBtn.classList.toggle('saved', isNowSaved);
    if (isNowSaved) {
      modalBtn.style.background = 'var(--text-primary)';
      modalBtn.style.color = '#FFFFFF';
      modalBtn.style.borderColor = 'var(--text-primary)';
    } else {
      modalBtn.style.background = 'var(--bg-surface)';
      modalBtn.style.color = 'var(--text-primary)';
      modalBtn.style.borderColor = 'var(--border-light)';
    }
    const svg = modalBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isNowSaved ? 'currentColor' : 'none');
    const span = modalBtn.querySelector('span');
    if (span) span.textContent = isNowSaved ? 'Gemerkt' : 'Auf Merkliste';
  }

  // If currently filtering only saved spots, refresh the list
  if (onlySaved) {
    applyFilters(false);
  }
}

function updateSavedBadge() {
  const b1 = document.getElementById('savedCountBadge');
  if (b1) b1.textContent = savedIds.size;
  const b2 = document.getElementById('mobSavedBadge');
  if (b2) b2.textContent = savedIds.size;
}

function setMobileTab(tab) {
  const tabs = ['feed', 'map', 'route', 'saved'];
  tabs.forEach(t => {
    const btn = document.getElementById('mobTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('active', t === tab);
  });

  if (tab === 'feed') {
    setViewMode('grid');
    if (onlySaved) {
      onlySaved = false;
      const b = document.getElementById('viewBtnSaved');
      if (b) b.classList.remove('active');
      applyFilters(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (tab === 'map') {
    setViewMode('map');
    switchDockTab('map');
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
        fitMapToFiltered();
      }, 150);
    }
    const dockEl = document.getElementById('rightDock');
    if (dockEl) dockEl.scrollIntoView({ behavior: 'smooth' });
  } else if (tab === 'route') {
    setViewMode('map');
    switchDockTab('route');
    const dockEl = document.getElementById('rightDock');
    if (dockEl) dockEl.scrollIntoView({ behavior: 'smooth' });
  } else if (tab === 'saved') {
    onlySaved = true;
    const b = document.getElementById('viewBtnSaved');
    if (b) b.classList.add('active');
    applyFilters(false);
    setViewMode('grid');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function toggleSavedFilter() {
  onlySaved = !onlySaved;
  document.getElementById('viewBtnSaved').classList.toggle('active', onlySaved);
  applyFilters(true);
}

function setViewMode(mode) {
  currentView = mode;
  document.getElementById('viewBtnSplit').classList.toggle('active', mode === 'split');
  document.getElementById('viewBtnMap').classList.toggle('active', mode === 'map');
  document.getElementById('viewBtnGrid').classList.toggle('active', mode === 'grid');
  document.getElementById('viewBtnTable').classList.toggle('active', mode === 'table');
  document.getElementById('viewBtnVideos').classList.toggle('active', mode === 'videos');

  const layout = document.getElementById('mainLayout');
  const rightDock = document.getElementById('rightDock');

  layout.classList.remove('full-map-mode', 'grid-only-mode');

  if (mode === 'split') {
    rightDock.style.display = 'flex';
    document.getElementById('cardsGrid').style.display = 'grid';
    document.getElementById('tableView').style.display = 'none';
    document.getElementById('videoView').style.display = 'none';
  } else if (mode === 'map') {
    layout.classList.add('full-map-mode');
    rightDock.style.display = 'flex';
    switchDockTab('map');
    document.getElementById('cardsGrid').style.display = 'grid';
    document.getElementById('tableView').style.display = 'none';
    document.getElementById('videoView').style.display = 'none';
  } else if (mode === 'grid') {
    layout.classList.add('grid-only-mode');
    rightDock.style.display = 'none';
    document.getElementById('cardsGrid').style.display = 'grid';
    document.getElementById('tableView').style.display = 'none';
    document.getElementById('videoView').style.display = 'none';
  } else if (mode === 'table') {
    rightDock.style.display = 'flex';
    document.getElementById('cardsGrid').style.display = 'none';
    document.getElementById('tableView').style.display = 'block';
    document.getElementById('videoView').style.display = 'none';
  } else if (mode === 'videos') {
    layout.classList.add('grid-only-mode');
    rightDock.style.display = 'none';
    document.getElementById('cardsGrid').style.display = 'none';
    document.getElementById('tableView').style.display = 'none';
    document.getElementById('videoView').style.display = 'grid';
  }

  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
}

function setCategory(cat) {
  activeCategory = cat;
  document.querySelectorAll('.cat-pill').forEach(btn => {
    const isMatch = btn.getAttribute('data-cat') === cat;
    btn.classList.toggle('active', isMatch);
  });
  applyFilters(true);
}

function handleSearch(val) {
  searchQuery = val.trim().toLowerCase();
  document.getElementById('searchClear').style.display = searchQuery ? 'flex' : 'none';
  applyFilters(true);
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  handleSearch('');
}

function resetAllFilters() {
  activeCategory = 'all';
  searchQuery = '';
  onlySaved = false;
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').style.display = 'none';
  document.getElementById('regionSelect').value = 'all';
  document.getElementById('durationSelect').value = 'all';
  document.getElementById('costSelect').value = 'all';
  document.getElementById('sortSelect').value = 'default';
  document.getElementById('viewBtnSaved').classList.remove('active');
  setCategory('all');
  if (map) {
    map.flyTo(INHA_COORDS, 11, { duration: 0.7 });
  }
}

function applyFilters(shouldAdjustMap = true) {
  const regionVal = document.getElementById('regionSelect').value;
  const durVal = document.getElementById('durationSelect').value;
  const costVal = document.getElementById('costSelect').value;
  const sortVal = document.getElementById('sortSelect').value;

  let filtered = ALL_SPOTS.filter(s => {
    if (onlySaved && !savedIds.has(s.id)) return false;
    if (activeCategory === 'inha' && !s.isInhaLocal) return false;
    if (activeCategory === 'gems' && !s.isHiddenGem) return false;
    if (activeCategory !== 'all' && activeCategory !== 'inha' && activeCategory !== 'gems' && s.category !== activeCategory) return false;
    if (regionVal !== 'all' && s.region !== regionVal) return false;
    if (durVal !== 'all' && s.durationFilter !== durVal) return false;
    if (costVal !== 'all' && s.cost !== costVal) return false;

    if (searchQuery) {
      const hay = (s.name + ' ' + s.kr + ' ' + s.region + ' ' + s.category + ' ' + s.desc + ' ' + s.tip + ' ' + s.routeFromInha).toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  if (sortVal === 'rating') {
    filtered.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
  } else if (sortVal === 'name') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filtered.sort((a, b) => a.id - b.id);
  }

  currentFiltered = filtered;
  document.getElementById('resultsCounter').textContent = `Zeige ${filtered.length} von ${ALL_SPOTS.length} Reisezielen`;
  
  // Mobile active filter badge count
  let activeCount = 0;
  if (regionVal !== 'all') activeCount++;
  if (durVal !== 'all') activeCount++;
  if (costVal !== 'all') activeCount++;
  if (sortVal !== 'default') activeCount++;
  if (searchQuery) activeCount++;
  if (onlySaved) activeCount++;
  const mBadge = document.getElementById('mobActiveFilterBadge');
  if (mBadge) {
    if (activeCount > 0) {
      mBadge.textContent = activeCount;
      mBadge.style.display = 'inline-flex';
    } else {
      mBadge.style.display = 'none';
    }
  }
  renderCards(filtered);
  renderTable(filtered);
  updateMapMarkers(filtered);
  initCardPhotoObserver();

  if (shouldAdjustMap && map && (regionVal !== 'all' || activeCategory !== 'all' || durVal !== 'all' || searchQuery || onlySaved)) {
    fitMapToFiltered();
  }
}

function renderCards(list) {
  const container = document.getElementById('cardsGrid');
  if (list.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1; background:#fff; border:1px solid var(--border-light); border-radius:12px; padding:48px; text-align:center;">
      <h3 style="font-size:1.1rem; margin-bottom:8px;">Keine passenden Orte gefunden</h3>
      <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:16px;">Versuche einen anderen Suchbegriff oder setze die Filter zurück.</p>
      <button class="nav-btn active" onclick="resetAllFilters()">Alle 220 Orte anzeigen</button>
    </div>`;
    return;
  }

  container.innerHTML = list.map(s => {
    const isSaved = savedIds.has(s.id);
    const hasVerified = !!realPhotoCache[s.id];
    const imgUrl = realPhotoCache[s.id] || s.img;
    const naverUrl = getNaverUrl(s.kr);
    const googlePhotosUrl = getGooglePhotosUrl(s.kr, s.name);

    return `
    <article class="spot-card" data-spot-id="${s.id}" onmouseenter="highlightPinOnHover(${s.id})" onmouseleave="unhighlightPinOnHover(${s.id})">
      <div class="card-media" onclick="openModal(${s.id})">
        <img id="card-img-${s.id}" src="${imgUrl}" alt="${s.name}" loading="lazy" onerror="this.src='https://plus.unsplash.com/premium_photo-1661886333708-877148b43ae1?fm=jpg&q=80&w=1000&auto=format&fit=crop'" />
        <div class="transit-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${s.transitTime}
        </div>
        <button class="save-btn ${isSaved ? 'saved' : ''}" onclick="toggleSave(${s.id}, event)" title="Merken">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
        <div class="card-tags-overlay">
          <div style="display:flex; gap:4px;">
            <span class="mini-tag">#${s.id}</span>
            ${s.isInhaLocal ? '<span class="mini-tag inha">Inha Local</span>' : ''}
            ${s.isHiddenGem ? '<span class="mini-tag gem">Hidden Gem</span>' : ''}
          </div>
          <span id="photo-badge-${s.id}" class="mini-tag verified-photo" style="display:${hasVerified ? 'inline-block' : 'none'};">Ortsfoto</span>
        </div>
      </div>

      <div class="card-body">
        <div class="card-meta-row">
          <span>${s.region} • ${s.category}</span>
          <span class="rating-box">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#F59E0B" stroke="#F59E0B" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            ${s.rating}
          </span>
        </div>

        <h3 class="card-title" onclick="openModal(${s.id})">${s.name}</h3>

        <div class="card-kr-row">
          <span class="card-kr kr-text">${s.kr}</span>
          <button class="copy-kr-btn" onclick="copyText('${s.kr.replace(/'/g, "\\'")}')" title="Koreanischen Namen kopieren">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Hangul
          </button>
        </div>

        <p class="card-desc">${s.desc}</p>

        <div class="card-tip-box">
          <strong>Tipp:</strong> ${s.tip}
        </div>
      </div>

      <div class="card-footer">
        <div style="display:flex; gap:5px; flex-wrap:wrap;">
          <a href="${naverUrl}" target="_blank" rel="noopener" class="btn-naver" title="Direkt in Naver Map öffnen">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            Naver
          </a>
          <a href="${googlePhotosUrl}" target="_blank" rel="noopener" class="btn-google-photos" title="Echte Google Maps Fotos & Bewertungen öffnen">
            Google Fotos
          </a>
        </div>
        <div style="display:flex; gap:5px;">
          <button class="btn-card-action" onclick="focusSpotOnMap(${s.id}, event)" title="Auf interaktiver Karte zeigen">Karte</button>
          <button class="btn-card-action" onclick="addToRoute(${s.id})" title="Zur Route ab Inha hinzufügen">+ Route</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

function renderTable(list) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = list.map(s => `
    <tr>
      <td style="color:var(--text-muted); font-weight:600;">${s.id}</td>
      <td>
        <div style="font-weight:700; cursor:pointer; color:var(--text-primary);" onclick="openModal(${s.id})">${s.name}</div>
        <div class="kr-text" style="font-size:0.78rem; color:var(--text-muted);">${s.kr}</div>
      </td>
      <td>${s.region}</td>
      <td>${s.category}</td>
      <td><span style="font-weight:600; color:var(--accent-ocean);">${s.transitTime}</span></td>
      <td>${s.cost}</td>
      <td>
        <div style="display:flex; gap:5px; flex-wrap:wrap;">
          <a href="${getNaverUrl(s.kr)}" target="_blank" rel="noopener" class="btn-naver">Naver</a>
          <a href="${getGooglePhotosUrl(s.kr, s.name)}" target="_blank" rel="noopener" class="btn-google-photos">Google Fotos</a>
          <button class="btn-card-action" onclick="focusSpotOnMap(${s.id}, event)">Karte</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderRoute() {
  const container = document.getElementById('routeTimeline');
  let html = `
    <div class="timeline-node origin">
      <div class="node-title">
        <span>Start: Inha University</span>
        <span class="kr-text" style="font-size:0.72rem; font-weight:500;">인하대역</span>
      </div>
      <div class="node-sub">Michuhol-gu, Incheon (Suin-Bundang Line)</div>
    </div>
  `;

  routeIds.forEach((id, idx) => {
    const s = ALL_SPOTS.find(x => x.id === id);
    if (!s) return;
    html += `
      <div class="timeline-node">
        <div class="node-title">
          <span style="cursor:pointer;" onclick="focusSpotOnMap(${s.id})">${idx + 1}. ${s.name}</span>
          <button class="node-remove" onclick="removeFromRoute(${idx})" title="Entfernen">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="node-sub">${s.transitTime} • <a href="${getNaverUrl(s.kr)}" target="_blank" rel="noopener" style="color:var(--naver-green); font-weight:600; text-decoration:none;">Naver Map</a></div>
      </div>
    `;
  });

  container.innerHTML = html;
  drawRoutePolyline();

  if (routeIds.length > 0) {
    const firstSpot = ALL_SPOTS.find(x => x.id === routeIds[0]);
    if (firstSpot) {
      document.getElementById('openRouteNaverBtn').href = getNaverUrl(firstSpot.kr);
      document.getElementById('openRouteNaverBtn').innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        1. Stopp (${firstSpot.kr}) in Naver Map
      `;
    }
  }
}

function addToRoute(id) {
  if (!routeIds.includes(id)) {
    routeIds.push(id);
    renderRoute();
    showToast('Zur Route ab Inha hinzugefügt');
  } else {
    showToast('Bereits in deiner Route enthalten');
  }
}

function removeFromRoute(idx) {
  routeIds.splice(idx, 1);
  renderRoute();
}

function clearRoute() {
  routeIds = [];
  renderRoute();
  showToast('Route zurückgesetzt');
}

function loadPresetRoute(ids) {
  routeIds = [...ids];
  renderRoute();
  showRouteOnMap();
  showToast('Kuratierte Inha-Route auf Karte geladen');
}

function openModal(id) {
  const s = ALL_SPOTS.find(x => x.id === id);
  if (!s) return;

  const heroUrl = realPhotoCache[s.id] || s.img;
  document.getElementById('modalImg').src = heroUrl;
  document.getElementById('modalTitle').textContent = s.name;
  document.getElementById('modalKr').textContent = s.kr;
  document.getElementById('modalDesc').textContent = s.desc;
  document.getElementById('modalTip').textContent = s.tip;
  document.getElementById('modalRoute').textContent = s.routeFromInha;
  document.getElementById('modalMeta').textContent = `${s.transitTime}  |  Budget: ${s.cost}  |  GPS: ${s.lat}, ${s.lng}`;

  document.getElementById('modalCopyKrBtn').onclick = () => copyText(s.kr);
  document.getElementById('modalFocusMapBtn').onclick = () => {
    closeModal();
    focusSpotOnMap(s.id);
  };

  document.getElementById('modalBadges').innerHTML = `
    <span class="mini-tag inha">#${s.id} • ${s.region}</span>
    <span class="mini-tag">${s.category}</span>
    ${s.isHiddenGem ? '<span class="mini-tag gem">Hidden Gem</span>' : ''}
  `;

  const isSaved = savedIds.has(s.id);
  document.getElementById('modalActions').innerHTML = `
    <button id="modal-save-btn-${s.id}" class="btn-secondary-link ${isSaved ? 'saved' : ''}" style="${isSaved ? 'background:var(--text-primary); color:#FFFFFF; border-color:var(--text-primary);' : ''} display:inline-flex; align-items:center; gap:6px;" onclick="toggleSave(${s.id}, event)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      <span>${isSaved ? 'Gemerkt' : 'Auf Merkliste'}</span>
    </button>
    <a href="${getNaverUrl(s.kr)}" target="_blank" rel="noopener" class="btn-primary-naver">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      In Naver Map öffnen (${s.kr})
    </a>
    <a href="${getGooglePhotosUrl(s.kr, s.name)}" target="_blank" rel="noopener" class="btn-google-photos" style="padding:9px 14px; font-size:0.84rem;">
      Google Maps Fotos & Reviews
    </a>
    <a href="${getGoogleImagesSearchUrl(s.kr, s.name)}" target="_blank" rel="noopener" class="btn-secondary-link">
      Google Bildersuche (${s.kr})
    </a>
    <a href="${getKakaoUrl(s.kr)}" target="_blank" rel="noopener" class="btn-secondary-link">
      KakaoMap
    </a>
    <a href="${s.videoUrl}" target="_blank" rel="noopener" class="btn-secondary-link">
      YouTube Video-Guide
    </a>
    <button class="btn-secondary-link" onclick="addToRoute(${s.id})">
      + Zur Inha-Route
    </button>
  `;

  document.getElementById('detailModal').classList.add('open');
  document.body.classList.add('modal-open');
  loadModalPhotoGallery(s);
}

function closeModal() {
  document.getElementById('detailModal').classList.remove('open');
  document.body.classList.remove('modal-open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

function ensureMapReady() {
  if (typeof L === "undefined") {
    console.log("Waiting for Leaflet to load from CDN...");
    setTimeout(ensureMapReady, 150);
    return;
  }
  if (!map) {
    initInteractiveMap();
  }
  if (map) {
    map.invalidateSize();
    setTimeout(() => { if (map) map.invalidateSize(); }, 250);
    setTimeout(() => { if (map) map.invalidateSize(); }, 800);
  }
}

// INITIALIZE APPLICATION
updateSavedBadge();
applyFilters(false);
if (document.readyState === "complete" || document.readyState === "interactive") {
  ensureMapReady();
} else {
  document.addEventListener("DOMContentLoaded", ensureMapReady);
  window.addEventListener("load", ensureMapReady);
}
window.addEventListener("resize", () => { if (map) map.invalidateSize(); });
renderRoute();
runBatchWikiPhotoFetch();


// ==========================================================
// MOBILE SLIDE-UP FILTER DRAWER & SCROLL-HIDE HEADER
// ==========================================================
let isDrawerOpen = false;

function toggleMobileFilterDrawer(open) {
  const backdrop = document.getElementById('filterDrawerBackdrop');
  if (!backdrop) return;

  if (typeof open === 'boolean') {
    isDrawerOpen = open;
  } else {
    isDrawerOpen = !isDrawerOpen;
  }

  if (isDrawerOpen) {
    backdrop.classList.add('open');
    document.body.classList.add('drawer-open');
    initDrawerOptions();
  } else {
    backdrop.classList.remove('open');
    document.body.classList.remove('drawer-open');
  }

  const btn = document.getElementById('mobFilterToggleBtn');
  if (btn) btn.classList.toggle('active', isDrawerOpen);
}

function initDrawerOptions() {
  // Clone options from main selects to drawer selects
  const mapPairs = [
    { main: 'regionSelect', drawer: 'drawerRegionSelect' },
    { main: 'durationSelect', drawer: 'drawerDurationSelect' },
    { main: 'costSelect', drawer: 'drawerCostSelect' },
    { main: 'sortSelect', drawer: 'drawerSortSelect' }
  ];

  mapPairs.forEach(p => {
    const mainEl = document.getElementById(p.main);
    const drawerEl = document.getElementById(p.drawer);
    if (mainEl && drawerEl) {
      if (drawerEl.options.length === 0) {
        drawerEl.innerHTML = mainEl.innerHTML;
      }
      drawerEl.value = mainEl.value;
    }
  });

  // Sync active category pill in drawer
  document.querySelectorAll('.drawer-cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-cat') === activeCategory);
  });

  updateDrawerApplyCount();
}

function syncDrawerFilter(targetId, val) {
  const mainEl = document.getElementById(targetId);
  if (mainEl) {
    mainEl.value = val;
    applyFilters(false);
    updateDrawerApplyCount();
  }
}

function setCategoryFromDrawer(cat) {
  setCategory(cat);
  document.querySelectorAll('.drawer-cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-cat') === cat);
  });
  updateDrawerApplyCount();
}

function resetAllFiltersFromDrawer() {
  resetAllFilters();
  initDrawerOptions();
}

function updateDrawerApplyCount() {
  const countEl = document.getElementById('drawerApplyCount');
  if (countEl) {
    countEl.textContent = `${currentFiltered.length} Orte anzeigen`;
  }
}

// Auto-hide compact header on scroll down on mobile
let lastMobileScrollY = 0;
let isMobileNavHidden = false;

window.addEventListener('scroll', () => {
  const nav = document.getElementById('mainTopNav') || document.querySelector('.top-nav');
  if (!nav) return;

  if (window.innerWidth > 860) {
    if (isMobileNavHidden) {
      nav.classList.remove('nav-hidden');
      isMobileNavHidden = false;
    }
    return;
  }

  if (document.body.classList.contains('modal-open') || document.body.classList.contains('drawer-open')) return;

  const currentY = window.pageYOffset || document.documentElement.scrollTop || window.scrollY || 0;
  if (currentY > 40 && currentY > lastMobileScrollY + 6) {
    if (!isMobileNavHidden) {
      nav.classList.add('nav-hidden');
      isMobileNavHidden = true;
    }
  } else if (currentY < lastMobileScrollY - 6 || currentY <= 25) {
    if (isMobileNavHidden) {
      nav.classList.remove('nav-hidden');
      isMobileNavHidden = false;
    }
  }
  lastMobileScrollY = Math.max(0, currentY);
}, { passive: true });
