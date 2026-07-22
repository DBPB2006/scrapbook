document.addEventListener('DOMContentLoaded', async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const memoryId = urlParams.get('id');
            if (!memoryId) {
                alert('Memory ID is missing');
                window.location.href="/dashboard.html";
                return;
            }

            let currentSlide = 0;
            let slidesCount = 0;

            function showSlide(idx) {
                const slides = document.querySelectorAll('.media-slide');
                slides.forEach((s, i) => {
                    s.style.display = (i === idx) ? '' : 'none';
                    if (i !== idx) {
                        const v = s.querySelector('video');
                        if (v) v.pause();
                        const a = s.querySelector('audio');
                        if (a) a.pause();
                    }
                });
            }

            try {
                const res = await axios.get('/api/memories/' + memoryId);
                const data = res.data;
                const mem = data.memory;
                
                document.getElementById('loading').classList.add('hidden');
                document.getElementById('contentWrapper').classList.remove('hidden');

                // Populate side timeline
                const timeline = document.getElementById('timelineContainer');
                const colors = ['#2563eb', '#14b8a6', '#f59e42', '#ec4899', '#22c55e', '#eab308', '#ef4444'];
                let tHtml = '';
                data.allUserMemories.forEach((m, idx) => {
                    const isActive = m.id === memoryId;
                    const isNavigable = m.id === data.prevMemoryId || m.id === data.nextMemoryId;
                    const color = colors[idx % colors.length];
                    const initials = (m.title || 'M').split(/\s+/).map(w=>w[0]).join('').substring(0,2).toUpperCase();
                    
                    let style = `background: #A8C8EC; color: #fff; border: 4px solid #A8C8EC;`;
                    let classes = `flex items-center justify-center w-16 h-16 rounded-full font-bold text-lg transition-all duration-200`;
                    
                    if (isActive) {
                        style = `background: ${color}; color: #fff; border: 4px solid #A8C8EC; pointer-events: none; box-shadow: 0 0 0 4px #fff, 0 4px 16px rgba(139,126,200,0.12);`;
                    } else if (isNavigable) {
                        classes += ' hover:scale-105 cursor-pointer';
                    } else {
                        classes += ' opacity-40 pointer-events-none cursor-default';
                    }
                    tHtml += `<a href="${isNavigable ? '/memories/memory_details.html?id=' +m.id : '#'}" class="${classes}" style="${style}" title="${m.title}">${initials}</a>`;
                });
                timeline.innerHTML = tHtml;

                if (data.prevMemoryId) {
                    const p = document.getElementById('prevLink');
                    p.href="/memories/memory_details.html?id=" + data.prevMemoryId;
                    p.classList.remove('opacity-40', 'pointer-events-none');
                }
                if (data.nextMemoryId) {
                    const n = document.getElementById('nextLink');
                    n.href="/memories/memory_details.html?id=" + data.nextMemoryId;
                    n.classList.remove('opacity-40', 'pointer-events-none');
                }

                // Populate details
                document.title = mem.title + ' - MemoryBook';
                document.getElementById('memTitle').textContent = mem.title;
                document.getElementById('memDate').querySelector('span').textContent = mem.date;
                if (mem.mood) {
                    document.getElementById('memMood').classList.remove('hidden');
                    document.getElementById('memMood').querySelector('span').textContent = mem.mood;
                }
                if (mem.location) {
                    document.getElementById('memLocation').classList.remove('hidden');
                    const link = document.getElementById('memLocation').querySelector('a');
                    link.href = 'https://www.google.com/maps/search/' + encodeURIComponent(mem.location);
                    link.textContent = mem.location;
                }
                document.getElementById('memDesc').innerHTML = (mem.description || '').replace(/\n/g, '<br/>');

                if (mem.tags) {
                    const tagsArr = typeof mem.tags === 'string' ? mem.tags.split(',') : mem.tags;
                    if (tagsArr.length > 0) {
                        document.getElementById('memTags').classList.remove('hidden');
                        document.getElementById('memTags').innerHTML = tagsArr.map(t => `<span class="inline-block px-3 py-1 rounded-full bg-[#A8C8EC] text-white text-xs font-medium">#${t.trim()}</span>`).join('');
                    }
                }

                // Friends
                if (mem.friends && mem.friends.length > 0) {
                    const fNames = mem.friends.map(fid => {
                        const u = data.usersData && data.usersData[fid.charAt(0).toUpperCase()] && data.usersData[fid.charAt(0).toUpperCase()][fid];
                        return u ? (u.first_name || u.username || fid) : fid;
                    });
                    document.getElementById('memFriends').textContent = fNames.join(', ');
                }

                // Delete btn
                document.getElementById('deleteBtn').addEventListener('click', async () => {
                    if (confirm('Are you sure you want to delete this memory? This cannot be undone.')) {
                        try {
                            const delRes = await axios.delete('/api/memories/' + memoryId);
                            if (delRes.data.redirectId) {
                                window.location.href="/memories/memory_details.html?id=" + delRes.data.redirectId;
                            } else {
                                window.location.href="/dashboard.html";
                            }
                        } catch(err) {
                            alert('Delete failed');
                        }
                    }
                });

                // Media Gallery
                const gallery = document.getElementById('mediaGallery');
                if (mem.media && mem.media.length > 0) {
                    slidesCount = mem.media.length;
                    let gHtml = '';
                    (mem.media || []).forEach((file, idx) => {
                        const disp = idx === 0 ? '' : 'display:none;';
                        let fUrl = '';
                        let fType = '';
                        if (typeof file === 'string') {
                            fUrl = file.startsWith('/') ? file : '/' + file;
                            let lower = fUrl.toLowerCase();
                            if (lower.match(/\\.(mp4|webm|ogg)$/)) fType = 'video/mp4';
                            else if (lower.match(/\\.(mp3|wav)$/)) fType = 'audio/mpeg';
                            else fType = 'image/jpeg';
                        } else {
                            fUrl = file.url.startsWith('/') ? file.url : '/' + file.url;
                            fType = file.type || 'image/jpeg';
                        }

                        let inner = '';
                        if (fType.startsWith('image/')) {
                            inner = `<img src="${fUrl}" class="gallery-img w-full max-w-lg h-auto max-h-[400px] object-contain rounded-xl shadow border-2 border-[#8B7EC8] bg-white mb-2" />`;
                        } else if (fType.startsWith('video/')) {
                            inner = `<video src="${fUrl}" controls class="w-full max-w-lg h-auto max-h-[400px] rounded-xl shadow border-2 border-[#8B7EC8] bg-black mb-2" type="${fType}"></video>`;
                        } else if (fType.startsWith('audio/')) {
                            inner = `<audio src="${fUrl}" controls class="w-full max-w-lg mb-2" type="${fType}"></audio>`;
                        } else {
                            let fileName = typeof file === 'string' ? file.split('/').pop() : (file.name || 'File');
                            inner = `<div class="w-full flex flex-col items-center justify-center h-32 bg-[#F5F3FB] rounded-xl border border-[#E8E3F5] mb-2"><i class="fa fa-file-alt text-4xl text-[#8B7EC8]"></i><span class="ml-2 text-sm">${fileName}</span></div>`;
                        }
                        
                        // Download link
                        const dl = `<a href="${fUrl}" download class="inline-flex px-3 py-1 bg-[#8B7EC8] text-white rounded-md text-xs font-semibold hover:bg-[#6BCB77] transition items-center gap-2"><i class="fa fa-download"></i> Download</a>`;
                        
                        gHtml += `<div class="media-slide w-full flex flex-col items-center" style="${disp}">${inner}${dl}</div>`;
                    });
                    gallery.innerHTML = gHtml;
                    if (slidesCount > 1) {
                        document.getElementById('galleryControls').classList.remove('hidden');
                        document.getElementById('prevSlide').onclick = () => {
                            currentSlide = (currentSlide - 1 + slidesCount) % slidesCount;
                            showSlide(currentSlide);
                        };
                        document.getElementById('nextSlide').onclick = () => {
                            currentSlide = (currentSlide + 1) % slidesCount;
                            showSlide(currentSlide);
                        };
                    }
                } else {
                    gallery.innerHTML = '<div class="text-center text-gray-400">No media files.</div>';
                }

                // Extra details
                let extraHtml = '';
                const skips = ['memory_id', 'id', 'owner', 'media', 'friends', 'title', 'date', 'location', 'description', 'tags', 'mood'];
                for (const [key, val] of Object.entries(mem)) {
                    if (skips.includes(key)) continue;
                    const disp = Array.isArray(val) ? val.join(', ') : (val === '' || val == null ? '—' : val);
                    extraHtml += `
                    <div class="flex justify-between items-center py-2">
                        <dt class="font-medium text-gray-600 capitalize">${key.replace(/_/g, ' ')}</dt>
                        <dd class="text-gray-800 text-right">${disp}</dd>
                    </div>`;
                }
                document.getElementById('extraDetails').innerHTML = extraHtml;

            } catch(e) {
                console.error(e);
                alert('Failed to load memory');
            }
        });