document.addEventListener('DOMContentLoaded', async () => {
    await loadNavbar();
    try {
        const res = await axios.get('/api/friendship_graph');
        const graphData = res.data;
        document.getElementById('appContent').style.display = 'block';

        const suggList = document.getElementById('suggestions-list');
        if(graphData.suggestedFriends && graphData.suggestedFriends.length > 0) {
            suggList.innerHTML = '';
            graphData.suggestedFriends.forEach(name => {
                suggList.innerHTML += `<div class="p-2 rounded-lg bg-[#ede9fe]"><p class="font-semibold text-sm text-[#7c3aed]">${name}</p></div>`;
            });
        } else {
            suggList.innerHTML = `<p class="text-sm text-gray-500">No suggestions right now.</p>`;
        }

        const svg = document.getElementById('friendshipGraph');
        const tooltip = document.getElementById('tooltip');
        const nodeColors = { current: '#f472b6', friend: '#a78bfa', suggestion: '#2dd4bf', other: '#d1d5db' };
        const friendshipColor = '#a5b4fc';
        const memoryColor = '#f9a8d4';

        let showFriendships = true;
        let showMemories = false;

        function getEdgeEndpoints(p1, p2, radius, offset = 0) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist === 0) return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
            const offsetX = (dx / dist) * radius;
            const offsetY = (dy / dist) * radius;
            const perpX = -(dy / dist) * offset;
            const perpY = (dx / dist) * offset;
            return {
                x1: p1.x + offsetX + perpX,
                y1: p1.y + offsetY + perpY,
                x2: p2.x - offsetX + perpX,
                y2: p2.y - offsetY + perpY
            };
        }
        function createSvgElement(tag, attrs) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
            for (const k in attrs) el.setAttribute(k, attrs[k]);
            return el;
        }
        function createMarkers(defs) {
            const marker = createSvgElement('marker', { id: 'arrowhead', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
            marker.appendChild(createSvgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: friendshipColor, opacity: 0.7 }));
            defs.appendChild(marker);
        }
        function drawGraph() {
            svg.innerHTML = '';
            const defs = createSvgElement('defs', {});
            createMarkers(defs);
            svg.appendChild(defs);
            
            if (showMemories) {
                for (let i = 0; i < graphData.userCount; i++) {
                    for (let j = i + 1; j < graphData.userCount; j++) {
                        const freq = graphData.memoryMatrix[i][j];
                        if (freq > 0) {
                            const p1 = graphData.nodePositions[i], p2 = graphData.nodePositions[j];
                            const offset = -12;
                            const { x1, y1, x2, y2 } = getEdgeEndpoints(p1, p2, 28, offset);
                            svg.appendChild(createSvgElement('line', { x1, y1, x2, y2, stroke: memoryColor, 'stroke-width': 2 + freq, 'stroke-dasharray': '7,7', opacity: 0.7 }));
                            
                            const edgeKey = i < j ? i + '_' + j : j + '_' + i;
                            if (graphData.memoryEdges[edgeKey]) {
                                const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                                graphData.memoryEdges[edgeKey].forEach(mem => {
                                    const f = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
                                    f.setAttribute('x', mx - 40); f.setAttribute('y', my - 16); f.setAttribute('width', 80); f.setAttribute('height', 32);
                                    const div = document.createElement('div');
                                    div.setAttribute('class', 'memory-pill');
                                    div.innerText = mem.title;
                                    div.onclick = () => { window.location.href="/memories/memory_details.html?id=" + encodeURIComponent(mem.id); };
                                    f.appendChild(div);
                                    svg.appendChild(f);
                                });
                            }
                        }
                    }
                }
            }
            
            if (showFriendships) {
                for (let i = 0; i < graphData.userCount; i++) {
                    for (let j = 0; j < graphData.userCount; j++) {
                        if (graphData.friendshipMatrix[i][j]) {
                            const p1 = graphData.nodePositions[i], p2 = graphData.nodePositions[j];
                            let offset = 0;
                            if (graphData.friendshipMatrix[j][i] && i !== j) offset = 12;
                            const { x1, y1, x2, y2 } = getEdgeEndpoints(p1, p2, 28, offset);
                            svg.appendChild(createSvgElement('line', { x1, y1, x2, y2, stroke: friendshipColor, 'stroke-width': 2, opacity: 0.8, 'marker-end': 'url(#arrowhead)' }));
                        }
                    }
                }
            }
            
            graphData.users.forEach((user, i) => {
                const pos = graphData.nodePositions[i];
                const type = graphData.nodeTypes[i];
                const initials = (user.name || user.username || '??').substring(0, 2).toUpperCase();
                const displayName = user.name || user.username || 'Unknown';
                const nodeGroup = createSvgElement('g', { class: 'node' });
                nodeGroup.appendChild(createSvgElement('circle', { cx: pos.x, cy: pos.y, r: 28, fill: nodeColors[type], stroke: '#ffffff88', 'stroke-width': 4 }));
                nodeGroup.appendChild(createSvgElement('text', { x: pos.x, y: pos.y, class: 'node-initials' })).textContent = initials;
                nodeGroup.appendChild(createSvgElement('text', { x: pos.x, y: pos.y + 28 + 15, class: 'node-label' })).textContent = displayName;
                nodeGroup.addEventListener('mousemove', (e) => {
                    tooltip.style.opacity = '1';
                    tooltip.style.left = `${e.pageX + 15}px`;
                    tooltip.style.top = `${e.pageY}px`;
                    tooltip.innerHTML = `<strong>${displayName}</strong>`;
                });
                nodeGroup.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
                svg.appendChild(nodeGroup);
            });
        }

        function updateEdgeToggleButtons() {
            const btns = [document.getElementById('showFriendshipsBtn'), document.getElementById('showMemoriesBtn'), document.getElementById('showBothBtn')];
            btns.forEach(btn => btn.classList.remove('active'));
            if (showFriendships && showMemories) btns[2].classList.add('active');
            else if (showFriendships) btns[0].classList.add('active');
            else if (showMemories) btns[1].classList.add('active');
        }

        document.getElementById('showFriendshipsBtn').onclick = () => { showFriendships = true; showMemories = false; updateEdgeToggleButtons(); drawGraph(); };
        document.getElementById('showMemoriesBtn').onclick = () => { showFriendships = false; showMemories = true; updateEdgeToggleButtons(); drawGraph(); };
        document.getElementById('showBothBtn').onclick = () => { showFriendships = true; showMemories = true; updateEdgeToggleButtons(); drawGraph(); };
        
        document.getElementById('toggleNetworkBtn').onclick = () => {
            document.getElementById('mapView').classList.add('hidden');
            document.getElementById('graphView').classList.remove('hidden');
            document.getElementById('graphControls').style.display = 'flex';
            document.getElementById('toggleNetworkBtn').classList.add('active');
            document.getElementById('toggleMapBtn').classList.remove('active');
        };
        
        document.getElementById('toggleMapBtn').onclick = () => {
            document.getElementById('graphView').classList.add('hidden');
            document.getElementById('mapView').classList.remove('hidden');
            document.getElementById('graphControls').style.display = 'none';
            document.getElementById('toggleMapBtn').classList.add('active');
            document.getElementById('toggleNetworkBtn').classList.remove('active');
            if (!window._leafletMapLoaded) {
                initMap();
                window._leafletMapLoaded = true;
            } else {
                setTimeout(()=>window._leafletMap.invalidateSize(), 200);
            }
        };

        const LOCATIONIQ_API_KEY = "pk.235663a366caa807557a9a233647f569";
        function geocodeLocation(location) {
          const cacheKey = 'geocode_' + location;
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) return Promise.resolve(JSON.parse(cached));
          return fetch(`https://us1.locationiq.com/v1/search?key=${LOCATIONIQ_API_KEY}&q=${encodeURIComponent(location)}&format=json&limit=1`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (data && data.length > 0) {
                const coords = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
                sessionStorage.setItem(cacheKey, JSON.stringify(coords));
                return coords;
              }
              sessionStorage.setItem(cacheKey, JSON.stringify(null));
              return null;
            }).catch(e => null);
        }

        function initMap() {
          const map = L.map('map').setView([20.5937, 78.9629], 4);
          window._leafletMap = map;
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

          let anyMarker = false;
          if (graphData.memoryLocations.length === 0) {
            map._container.innerHTML = '<div class="text-center text-gray-400 mt-12">No memory locations found.</div>';
            return;
          }

          const processLocation = async (index) => {
            if (index >= graphData.memoryLocations.length) {
              if (!anyMarker) map._container.innerHTML = '<div class="text-center text-gray-400 mt-12">No memory locations found.</div>';
              return;
            }
            
            const mem = graphData.memoryLocations[index];
            const isCached = sessionStorage.getItem('geocode_' + mem.location) !== null;
            
            try {
                const coords = await geocodeLocation(mem.location);
                let lat = 20.5937, lon = 78.9629, found = false;
                if (coords) { lat = coords[0]; lon = coords[1]; found = true; }
                anyMarker = true;
                const marker = L.marker([lat, lon]).addTo(map);
                let popup = `<a href="/memories/memory_details.html?id=${encodeURIComponent(mem.id)}" class='text-[#7c3aed] font-bold'>${mem.title}</a><br>`;
                if (found) popup += `<a href='https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mem.location)}' target='_blank' class='text-blue-600 underline'>${mem.location}</a>`;
                else popup += `<span class='text-xs text-gray-500'>Could not find exact location for: <b>${mem.location}</b>.</span>`;
                marker.bindPopup(popup);
            } catch(e) {}
            setTimeout(() => processLocation(index + 1), isCached ? 10 : 600);
          };
          processLocation(0);
        }
        
        updateEdgeToggleButtons();
        drawGraph();
    } catch(e) {
        alert('Failed to load graph data.');
    }
});