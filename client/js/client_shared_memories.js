document.addEventListener('DOMContentLoaded', async () => {
    await loadNavbar();
    document.getElementById('mainApp').style.display = 'flex';

    let allUsers = [];
    let myMemories = [];
    try {
        const usersRes = await axios.get('/api/users');
        allUsers = usersRes.data;

        const memRes = await axios.get('/api/memories');
        myMemories = Array.isArray(memRes.data) ? memRes.data : (memRes.data.memories || []);

        const selMem = document.getElementById('selected_memory_id');
        myMemories.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.memory_id;
            opt.textContent = `${m.title || '(No Title)'} (${m.date || ''})`;
            selMem.appendChild(opt);
        });

        // Preselect memory if specified in query string
        const urlParams = new URLSearchParams(window.location.search);
        const preselectId = urlParams.get('id') || urlParams.get('memory_id');
        if (preselectId && myMemories.some(m => m.memory_id === preselectId)) {
            selMem.value = preselectId;
            selMem.dispatchEvent(new Event('change'));
        }
    } catch(e) {
        console.error(e);
    }

    // Step 1 logic
    const sIn = document.getElementById('userSearchInput');
    const sSugg = document.getElementById('userSuggestions');
    const sEmail = document.getElementById('selectedUserEmail');
    const sName = document.getElementById('selectedUserName');

    sIn.addEventListener('input', () => {
        const q = sIn.value.toLowerCase();
        sSugg.innerHTML = '';
        if(!q) return;
        const matches = allUsers.filter(u => 
            (u.name && u.name.toLowerCase().includes(q)) || 
            (u.email && u.email.toLowerCase().includes(q)) || 
            (u.username && u.username.toLowerCase().includes(q))
        ).slice(0, 10);
        
        matches.forEach(m => {
            const div = document.createElement('div');
            const dName = m.username || m.name || m.email;
            div.textContent = `${dName} (${m.email})`;
            div.className = 'p-2 border-b cursor-pointer hover:bg-gray-100';
            div.onclick = () => {
                sIn.value = `${dName} (${m.email})`;
                sEmail.value = m.email;
                sName.value = dName;
                sSugg.innerHTML = '';
            };
            sSugg.appendChild(div);
        });
    });

    document.getElementById('continueBtn').addEventListener('click', () => {
        if(!sEmail.value) {
            alert('Please select a user from the suggestions.');
            return;
        }
        document.getElementById('step1').classList.add('hidden');
        document.getElementById('step2').classList.remove('hidden');
        document.getElementById('displaySelectedUser').textContent = sName.value;
        document.getElementById('displayUsername').textContent = '@' + sName.value;
        document.getElementById('displayEmail').textContent = sEmail.value;
    });

    document.getElementById('backToSearchBtn').addEventListener('click', () => {
        document.getElementById('step2').classList.add('hidden');
        document.getElementById('step1').classList.remove('hidden');
        sEmail.value = '';
        sIn.value = '';
    });

    // Memory selection preview
    document.getElementById('selected_memory_id').addEventListener('change', function() {
        const mid = this.value;
        const pv = document.getElementById('memoryPreview');
        const memImg = document.getElementById('memImg');
        if(!mid) {
            pv.classList.add('hidden');
            document.getElementById('memory_title').value = '';
            document.getElementById('message').value = '';
            document.getElementById('date').value = '';
            const existingBadges = document.getElementById('memMetaBadges');
            if (existingBadges) existingBadges.remove();
            return;
        }
        const m = myMemories.find(x => x.memory_id === mid);
        if(m) {
            document.getElementById('memTitle').textContent = m.title || '';
            document.getElementById('memDate').textContent = m.date || '';
            document.getElementById('memDesc').textContent = m.description || '';
            document.getElementById('memory_title').value = m.title || '';
            document.getElementById('message').value = m.description || '';
            document.getElementById('date').value = m.date || '';
            pv.classList.remove('hidden');

            let previewImg = m.image;
            if (!previewImg && m.media && m.media.length > 0) {
                const firstImg = m.media.find(x => {
                    const t = x.type || x.mimeType || '';
                    return t.startsWith('image/');
                });
                previewImg = firstImg ? (firstImg.url || firstImg.preview_url || firstImg.path) : (m.media[0].url || m.media[0].preview_url || m.media[0].path);
            }
            if(previewImg) {
                memImg.src = window.MemoryBookConfig ? window.MemoryBookConfig.resolveMediaUrl(previewImg) : previewImg;
                memImg.classList.remove('hidden');
            } else {
                memImg.classList.add('hidden');
            }

            // Display badges for media files and details
            let metaBadgeEl = document.getElementById('memMetaBadges');
            if (!metaBadgeEl) {
                metaBadgeEl = document.createElement('div');
                metaBadgeEl.id = 'memMetaBadges';
                metaBadgeEl.className = 'flex flex-wrap gap-2 mt-2 pt-2 border-t border-[#8B7EC8]/20';
                pv.appendChild(metaBadgeEl);
            }
            let badgesHtml = '';
            const mediaCount = (m.media && Array.isArray(m.media)) ? m.media.length : 0;
            if (mediaCount > 0) {
                badgesHtml += `<span class="px-2.5 py-1 rounded-full bg-[#8B7EC8] text-white text-xs font-semibold flex items-center gap-1.5"><i class="fa fa-photo-film"></i> ${mediaCount} media file(s) included</span>`;
            }
            if (m.mood) {
                badgesHtml += `<span class="px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-medium flex items-center gap-1"><i class="fa fa-smile"></i> ${m.mood}</span>`;
            }
            if (m.location) {
                badgesHtml += `<span class="px-2.5 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium flex items-center gap-1"><i class="fa fa-location-dot"></i> ${m.location}</span>`;
            }
            if (m.tags) {
                const tagsList = typeof m.tags === 'string' ? m.tags.split(',') : (Array.isArray(m.tags) ? m.tags : [m.tags]);
                tagsList.forEach(t => {
                    if (t.trim()) badgesHtml += `<span class="px-2.5 py-1 rounded-full bg-[#A8C8EC] text-white text-xs font-medium">#${t.trim().replace(/^#/, '')}</span>`;
                });
            }
            metaBadgeEl.innerHTML = badgesHtml;
        }
    });

    // Form Submit
    document.getElementById('shareForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('errorMsg');
        const succ = document.getElementById('successMsg');
        err.classList.add('hidden');
        succ.classList.add('hidden');

        const mid = document.getElementById('selected_memory_id').value;
        const m = myMemories.find(x => x.memory_id === mid);

        const fd = new FormData();
        fd.append('to_email', sEmail.value);
        fd.append('selected_memory_id', mid);
        fd.append('memory_title', document.getElementById('memory_title').value);
        fd.append('message', document.getElementById('message').value);
        fd.append('date', document.getElementById('date').value);
        
        if (m) {
            if (m.description) fd.append('description', m.description);
            if (m.mood) fd.append('mood', m.mood);
            if (m.location) fd.append('location', m.location);
            if (m.tags) fd.append('tags', typeof m.tags === 'string' ? m.tags : m.tags.join(', '));
            if (m.friends) fd.append('friends', JSON.stringify(m.friends));
        }

        const files = document.getElementById('attachments').files;
        for(let i=0; i<files.length; i++) {
            fd.append('attachments[]', files[i]);
        }

        try {
            await axios.post('/api/shared_memories', fd, { headers: { 'Content-Type': 'multipart/form-data' }});
            succ.classList.remove('hidden');
            document.getElementById('shareForm').reset();
            document.getElementById('memoryPreview').classList.add('hidden');
            const existingBadges = document.getElementById('memMetaBadges');
            if (existingBadges) existingBadges.remove();
            loadRecent();
        } catch(error) {
            err.textContent = error.response?.data?.error || 'Failed to share memory';
            err.classList.remove('hidden');
        }
    });

    async function loadRecent() {
        try {
            const res = await axios.get('/api/shared_memories');
            const data = res.data;
            const list = document.getElementById('recentSharedList');
            if(data.length === 0) {
                list.innerHTML = '<div class="text-gray-400 text-center">You haven’t shared any memories yet.</div>';
                return;
            }
            let html = '';
            data.slice(0,5).forEach(m => {
                const targetId = m.original_memory_id || m.memory_id;
                const galleryId = 'media-gallery-' + m.memory_id;
                let attachmentsHtml = '';
                
                const allRecentMedia = [];
                const seenRec = new Set();
                const addRecMedia = (item) => {
                    if (!item) return;
                    let k = '';
                    if (typeof item === 'string') k = item.split('?')[0];
                    else if (typeof item === 'object') k = item.key || (item.url && typeof item.url === 'object' && item.url.key) || (item.preview_url ? item.preview_url.split('?')[0] : '') || (typeof item.url === 'string' ? item.url.split('?')[0] : '');
                    if (k && seenRec.has(k)) return;
                    if (k) seenRec.add(k);
                    allRecentMedia.push(item);
                };
                if (m.attachments && Array.isArray(m.attachments)) m.attachments.forEach(addRecMedia);
                if (m.media && Array.isArray(m.media)) m.media.forEach(addRecMedia);
                if (m.image) addRecMedia(m.image);

                if (allRecentMedia.length > 0) {
                    attachmentsHtml += `<div class="media-gallery mt-2" id="${galleryId}">`;
                    allRecentMedia.forEach((att, idx) => {
                        const rawUrl = typeof att === 'string' ? att : (att.url || att.preview_url || att.path || '');
                        const src = window.MemoryBookConfig ? window.MemoryBookConfig.resolveMediaUrl(rawUrl) : rawUrl;
                        const ext = window.MemoryBookConfig ? window.MemoryBookConfig.getCleanExtension(src) : src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
                        let type = (typeof att === 'object' && (att.type || att.mimeType)) || '';
                        if (!type) {
                            if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) type = 'image/jpeg';
                            else if (['mp4','mov','avi','webm'].includes(ext)) type = 'video/mp4';
                            else if (['mp3','wav','ogg','aac','m4a'].includes(ext)) type = 'audio/mpeg';
                            else type = 'other';
                        }
                        
                        const disp = idx === 0 ? '' : 'display:none;';
                        const dlUrl = (typeof att === 'object' && att.download_url) ? att.download_url : src;
                        const dlName = (typeof att === 'object' && (att.fileName || att.name)) || (typeof rawUrl === 'string' ? rawUrl.split('?')[0].split('/').pop() : 'attachment');
                        
                        attachmentsHtml += `<div class="media-slide" data-index="${idx}" style="${disp}">`;
                        if (type.startsWith('image/')) {
                            attachmentsHtml += `<img src="${src}" class="max-h-32 rounded-lg mb-2 object-cover" />`;
                        } else if (type.startsWith('video/')) {
                            attachmentsHtml += `<video src="${src}" controls class="max-h-32 rounded-lg mb-2"></video>`;
                        } else if (type.startsWith('audio/')) {
                            attachmentsHtml += `<audio src="${src}" controls class="mb-2"></audio>`;
                        } else {
                            attachmentsHtml += `<div class="flex flex-col items-center mb-2"><i class="fa fa-file-alt text-2xl text-[#8B7EC8] mb-1"></i><span class="text-xs text-[#6B6B7D]">${dlName}</span></div>`;
                        }
                        
                        attachmentsHtml += `
                            <a href="${dlUrl}" download="${dlName}" class="inline-flex px-2 py-1 bg-[#8B7EC8] text-white rounded text-xs font-semibold hover:bg-[#6BCB77] transition items-center gap-2" onclick="event.stopPropagation();">
                                <i class="fa fa-download"></i> Download
                            </a>
                        </div>`;
                    });
                    
                    if (allRecentMedia.length > 1) {
                        attachmentsHtml += `
                        <div class="flex gap-2 mt-2 items-center">
                          <button type="button" onclick="event.stopPropagation(); const g=this.closest('.media-gallery'); let c=parseInt(g.dataset.current||0); const s=g.querySelectorAll('.media-slide'); c=(c-1+s.length)%s.length; g.dataset.current=c; s.forEach((x,i)=>x.style.display=i===c?'':'none');" class="px-2 py-1 bg-[#ede9fe] text-[#7c3aed] rounded font-semibold text-xs">Prev</button>
                          <button type="button" onclick="event.stopPropagation(); const g=this.closest('.media-gallery'); let c=parseInt(g.dataset.current||0); const s=g.querySelectorAll('.media-slide'); c=(c+1)%s.length; g.dataset.current=c; s.forEach((x,i)=>x.style.display=i===c?'':'none');" class="px-2 py-1 bg-[#ede9fe] text-[#7c3aed] rounded font-semibold text-xs">Next</button>
                          <span class="text-xs text-gray-500">${allRecentMedia.length} files</span>
                        </div>`;
                    }
                    attachmentsHtml += `</div>`;
                }

                // Metadata tags in recent card
                let metaPills = '';
                if (m.mood) metaPills += `<span class="text-[11px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800"><i class="fa fa-smile mr-1"></i>${m.mood}</span> `;
                if (m.location) metaPills += `<span class="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-800"><i class="fa fa-location-dot mr-1"></i>${m.location}</span> `;

                html += `
                <li class="flex items-start gap-3 p-4 rounded-xl bg-[#F5F3FB] hover:bg-[#E6F1FB] transition border border-[#F4A6A6]/30 cursor-pointer" onclick="window.location.href='/memories/view_shared_memory.html?id=${targetId}'">
                  <div class="flex-1 relative">
                    <div class="flex items-center justify-between">
                      <div class="font-semibold text-[#8B7EC8]">
                        ${m.is_received ? 'From: ' + (m.from_username || m.from) : 'To: ' + (m.to_username || m.to)}
                        ${m.is_received && !m.seen ? '<span class="ml-2 text-xs bg-red-500 text-white px-2 py-0.5 rounded-full">New</span>' : ''}
                      </div>
                      <div class="text-xs text-gray-400">${m.date || ''}</div>
                    </div>
                    <div class="text-sm font-medium text-gray-800 mt-1">${m.memory_title || m.title || '(No Title)'}</div>
                    ${metaPills ? '<div class="flex flex-wrap gap-1 mt-1">' + metaPills + '</div>' : ''}
                    <div class="text-xs text-gray-600 mt-1 line-clamp-2">
                      ${(m.description || m.message || '').substring(0,80)}${((m.description || m.message || '').length > 80) ? '...' : ''}
                    </div>
                    ${attachmentsHtml}
                  </div>
                </li>`;
            });
            list.innerHTML = html;
        } catch(e) {}
    }

    loadRecent();
});