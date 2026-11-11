document.addEventListener('DOMContentLoaded', async () => {
    await loadNavbar();
    try {
        const res = await axios.get('/api/friendship_graph');
        const graphData = res.data;
        document.getElementById('appContent').style.display = 'block';

        const suggList = document.getElementById('suggestions-list');
        suggList.textContent = '';
        if (graphData.suggestedFriends && graphData.suggestedFriends.length > 0) {
            graphData.suggestedFriends.forEach(name => {
                const pill = document.createElement('div');
                pill.className = 'p-2 rounded-lg bg-[#ede9fe]';
                const p = document.createElement('p');
                p.className = 'font-semibold text-sm text-[#7c3aed]';
                p.textContent = name;
                pill.appendChild(p);
                suggList.appendChild(pill);
            });
        } else {
            const emptyP = document.createElement('p');
            emptyP.className = 'text-sm text-gray-500';
            emptyP.textContent = 'No suggestions right now.';
            suggList.appendChild(emptyP);
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

            // Render Memory Edges from memoryEdges collection
            if (showMemories && graphData.memoryEdges) {
                for (const edgeKey in graphData.memoryEdges) {
                    const parts = edgeKey.split('_');
                    const i = parseInt(parts[0], 10);
                    const j = parseInt(parts[1], 10);
                    const memoriesList = graphData.memoryEdges[edgeKey];
                    const freq = memoriesList ? memoriesList.length : 0;

                    if (freq > 0 && graphData.nodePositions[i] && graphData.nodePositions[j]) {
                        const p1 = graphData.nodePositions[i], p2 = graphData.nodePositions[j];
                        const offset = -12;
                        const { x1, y1, x2, y2 } = getEdgeEndpoints(p1, p2, 28, offset);
                        svg.appendChild(createSvgElement('line', {
                            x1, y1, x2, y2,
                            stroke: memoryColor,
                            'stroke-width': 2 + freq,
                            'stroke-dasharray': '7,7',
                            opacity: 0.7
                        }));

                        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                        memoriesList.forEach(mem => {
                            const f = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
                            f.setAttribute('x', mx - 40); f.setAttribute('y', my - 16);
                            f.setAttribute('width', 80); f.setAttribute('height', 32);
                            const div = document.createElement('div');
                            div.setAttribute('class', 'memory-pill');
                            div.innerText = mem.title;
                            div.onclick = () => { window.location.href = "/memories/memory_details.html?id=" + encodeURIComponent(mem.id); };
                            f.appendChild(div);
                            svg.appendChild(f);
                        });
                    }
                }
            }

            // Render Friendship Edges directly from Undirected Adjacency List
            if (showFriendships) {
                const drawnEdges = new Set();
                const adjList = graphData.adjacencyList || {};

                // Map email to node index
                const emailToIdx = graphData.emailIndexMap || {};
                if (graphData.users && Object.keys(emailToIdx).length === 0) {
                    graphData.users.forEach((u, idx) => {
                        if (u.email) emailToIdx[u.email.toLowerCase()] = idx;
                    });
                }

                for (const uEmail in adjList) {
                    const i = emailToIdx[uEmail.toLowerCase()];
                    if (i === undefined) continue;
                    const neighbors = adjList[uEmail] || [];
                    for (const vEmail of neighbors) {
                        const j = emailToIdx[vEmail.toLowerCase()];
                        if (j === undefined || i === j) continue;

                        // Prevent drawing duplicate undirected edges between i and j
                        const edgeKey = i < j ? `${i}_${j}` : `${j}_${i}`;
                        if (drawnEdges.has(edgeKey)) continue;
                        drawnEdges.add(edgeKey);

                        const p1 = graphData.nodePositions[i], p2 = graphData.nodePositions[j];
                        if (!p1 || !p2) continue;
                        const { x1, y1, x2, y2 } = getEdgeEndpoints(p1, p2, 28, 0);
                        svg.appendChild(createSvgElement('line', {
                            x1, y1, x2, y2,
                            stroke: friendshipColor,
                            'stroke-width': 2,
                            opacity: 0.8
                        }));
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
                    tooltip.textContent = '';
                    const strong = document.createElement('strong');
                    strong.textContent = displayName;
                    tooltip.appendChild(strong);
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
                setTimeout(() => window._leafletMap.invalidateSize(), 200);
            }
        };

        const LOCATIONIQ_API_KEY = (window.ScrapbookConfig && window.ScrapbookConfig.LOCATIONIQ_API_KEY) || '';
        function geocodeLocation(location) {
            if (!LOCATIONIQ_API_KEY) return Promise.resolve(null);
            const cacheKey = 'geocode_' + location;
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) return Promise.resolve(JSON.parse(cached));
            return fetch(`https://us1.locationiq.com/v1/search?key=${encodeURIComponent(LOCATIONIQ_API_KEY)}&q=${encodeURIComponent(location)}&format=json&limit=1`)
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

        function setMapEmptyMessage(container) {
            container.textContent = '';
            const msg = document.createElement('div');
            msg.className = 'text-center text-gray-400 mt-12';
            msg.textContent = 'No memory locations found.';
            container.appendChild(msg);
        }

        function initMap() {
            const map = L.map('map').setView([20.5937, 78.9629], 4);
            window._leafletMap = map;
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

            let anyMarker = false;
            if (!graphData.memoryLocations || graphData.memoryLocations.length === 0) {
                setMapEmptyMessage(map._container);
                return;
            }

            const processLocation = async (index) => {
                if (index >= graphData.memoryLocations.length) {
                    if (!anyMarker) setMapEmptyMessage(map._container);
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

                    const popupEl = document.createElement('div');
                    const memLink = document.createElement('a');
                    memLink.href = `/memories/memory_details.html?id=${encodeURIComponent(mem.id)}`;
                    memLink.className = 'text-[#7c3aed] font-bold';
                    memLink.textContent = mem.title || 'Memory';
                    popupEl.appendChild(memLink);
                    popupEl.appendChild(document.createElement('br'));

                    if (found) {
                        const mapLink = document.createElement('a');
                        mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mem.location)}`;
                        mapLink.target = '_blank';
                        mapLink.rel = 'noopener noreferrer';
                        mapLink.className = 'text-blue-600 underline';
                        mapLink.textContent = mem.location;
                        popupEl.appendChild(mapLink);
                    } else {
                        const fallbackSpan = document.createElement('span');
                        fallbackSpan.className = 'text-xs text-gray-500';
                        fallbackSpan.appendChild(document.createTextNode('Could not find exact location for: '));
                        const boldLoc = document.createElement('b');
                        boldLoc.textContent = mem.location || '';
                        fallbackSpan.appendChild(boldLoc);
                        fallbackSpan.appendChild(document.createTextNode('.'));
                        popupEl.appendChild(fallbackSpan);
                    }
                    marker.bindPopup(popupEl);
                } catch (e) { }
                setTimeout(() => processLocation(index + 1), isCached ? 10 : 600);
            };
            processLocation(0);
        }

        updateEdgeToggleButtons();
        drawGraph();
    } catch (e) {
        alert('Failed to load graph data.');
    }
});