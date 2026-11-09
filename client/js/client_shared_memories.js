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
            const resolvedPreview = previewImg ? window.MemoryBookConfig.resolveMediaUrl(previewImg) : '';
            if (resolvedPreview) {
                memImg.src = resolvedPreview;
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
            metaBadgeEl.textContent = '';
            const mediaCount = (m.media && Array.isArray(m.media)) ? m.media.length : 0;
            if (mediaCount > 0) {
                const mediaBadge = document.createElement('span');
                mediaBadge.className = 'px-2.5 py-1 rounded-full bg-[#8B7EC8] text-white text-xs font-semibold flex items-center gap-1.5';
                const icon = document.createElement('i');
                icon.className = 'fa fa-photo-film';
                mediaBadge.appendChild(icon);
                mediaBadge.appendChild(document.createTextNode(` ${mediaCount} media file(s) included`));
                metaBadgeEl.appendChild(mediaBadge);
            }
            if (m.mood) {
                const moodBadge = document.createElement('span');
                moodBadge.className = 'px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-medium flex items-center gap-1';
                const icon = document.createElement('i');
                icon.className = 'fa fa-smile';
                moodBadge.appendChild(icon);
                moodBadge.appendChild(document.createTextNode(' ' + m.mood));
                metaBadgeEl.appendChild(moodBadge);
            }
            if (m.location) {
                const locBadge = document.createElement('span');
                locBadge.className = 'px-2.5 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium flex items-center gap-1';
                const icon = document.createElement('i');
                icon.className = 'fa fa-location-dot';
                locBadge.appendChild(icon);
                locBadge.appendChild(document.createTextNode(' ' + m.location));
                metaBadgeEl.appendChild(locBadge);
            }
            if (m.tags) {
                const tagsList = typeof m.tags === 'string' ? m.tags.split(',') : (Array.isArray(m.tags) ? m.tags : [m.tags]);
                tagsList.forEach(t => {
                    if (String(t).trim()) {
                        const tagBadge = document.createElement('span');
                        tagBadge.className = 'px-2.5 py-1 rounded-full bg-[#A8C8EC] text-white text-xs font-medium';
                        tagBadge.textContent = '#' + String(t).trim().replace(/^#/, '');
                        metaBadgeEl.appendChild(tagBadge);
                    }
                });
            }
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
            const data = res.data || [];
            const list = document.getElementById('recentSharedList');
            list.textContent = '';
            if(data.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'text-gray-400 text-center';
                emptyDiv.textContent = 'You haven’t shared any memories yet.';
                list.appendChild(emptyDiv);
                return;
            }
            data.slice(0,5).forEach(m => {
                const targetId = m.memory_id || m.original_memory_id || '';
                const galleryId = 'media-gallery-' + (m.memory_id || '');

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

                const li = document.createElement('li');
                li.className = 'flex items-start gap-3 p-4 rounded-xl bg-[#F5F3FB] hover:bg-[#E6F1FB] transition border border-[#F4A6A6]/30 cursor-pointer';
                li.addEventListener('click', () => {
                    window.location.href = '/memories/view_shared_memory.html?id=' + encodeURIComponent(targetId);
                });

                const body = document.createElement('div');
                body.className = 'flex-1 relative';

                const headerRow = document.createElement('div');
                headerRow.className = 'flex items-center justify-between';

                const whoDiv = document.createElement('div');
                whoDiv.className = 'font-semibold text-[#8B7EC8]';
                whoDiv.textContent = m.is_received ? 'From: ' + (m.from_username || m.from || '') : 'To: ' + (m.to_username || m.to || '');
                if (m.is_received && !m.seen) {
                    const newBadge = document.createElement('span');
                    newBadge.className = 'ml-2 text-xs bg-red-500 text-white px-2 py-0.5 rounded-full';
                    newBadge.textContent = 'New';
                    whoDiv.appendChild(newBadge);
                }

                const dateDiv = document.createElement('div');
                dateDiv.className = 'text-xs text-gray-400';
                dateDiv.textContent = m.date || '';

                headerRow.appendChild(whoDiv);
                headerRow.appendChild(dateDiv);
                body.appendChild(headerRow);

                const titleDiv = document.createElement('div');
                titleDiv.className = 'text-sm font-medium text-gray-800 mt-1';
                titleDiv.textContent = m.memory_title || m.title || '(No Title)';
                body.appendChild(titleDiv);

                if (m.mood || m.location) {
                    const pillsWrap = document.createElement('div');
                    pillsWrap.className = 'flex flex-wrap gap-1 mt-1';
                    if (m.mood) {
                        const moodPill = document.createElement('span');
                        moodPill.className = 'text-[11px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800';
                        const icon = document.createElement('i');
                        icon.className = 'fa fa-smile mr-1';
                        moodPill.appendChild(icon);
                        moodPill.appendChild(document.createTextNode(m.mood));
                        pillsWrap.appendChild(moodPill);
                    }
                    if (m.location) {
                        const locPill = document.createElement('span');
                        locPill.className = 'text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-800';
                        const icon = document.createElement('i');
                        icon.className = 'fa fa-location-dot mr-1';
                        locPill.appendChild(icon);
                        locPill.appendChild(document.createTextNode(m.location));
                        pillsWrap.appendChild(locPill);
                    }
                    body.appendChild(pillsWrap);
                }

                const snippet = m.description || m.message || '';
                const snippetDiv = document.createElement('div');
                snippetDiv.className = 'text-xs text-gray-600 mt-1 line-clamp-2';
                snippetDiv.textContent = snippet.substring(0, 80) + (snippet.length > 80 ? '...' : '');
                body.appendChild(snippetDiv);

                if (allRecentMedia.length > 0) {
                    const galleryDiv = document.createElement('div');
                    galleryDiv.className = 'media-gallery mt-2';
                    galleryDiv.id = galleryId;
                    galleryDiv.dataset.current = '0';

                    allRecentMedia.forEach((att, idx) => {
                        const rawUrl = typeof att === 'string' ? att : (att.url || att.preview_url || att.path || '');
                        const src = window.MemoryBookConfig.resolveMediaUrl(rawUrl);
                        const ext = window.MemoryBookConfig.getCleanExtension(src);
                        let type = (typeof att === 'object' && (att.type || att.mimeType)) || '';
                        if (!type) {
                            if (['jpg','jpeg','png','gif','webp'].includes(ext)) type = 'image/jpeg';
                            else if (['mp4','mov','avi','webm'].includes(ext)) type = 'video/mp4';
                            else if (['mp3','wav','ogg','aac','m4a'].includes(ext)) type = 'audio/mpeg';
                            else type = 'other';
                        }

                        const slide = document.createElement('div');
                        slide.className = 'media-slide';
                        slide.dataset.index = String(idx);
                        if (idx !== 0) slide.style.display = 'none';

                        const dlUrl = (typeof att === 'object' && att.download_url) ? window.MemoryBookConfig.resolveMediaUrl(att.download_url) : src;
                        const dlName = (typeof att === 'object' && (att.fileName || att.name)) || (typeof rawUrl === 'string' ? rawUrl.split('?')[0].split('/').pop() : 'attachment');

                        if (type.startsWith('image/') && src) {
                            const img = document.createElement('img');
                            img.src = src;
                            img.className = 'max-h-32 rounded-lg mb-2 object-cover';
                            slide.appendChild(img);
                        } else if (type.startsWith('video/') && src) {
                            const vid = document.createElement('video');
                            vid.src = src;
                            vid.controls = true;
                            vid.className = 'max-h-32 rounded-lg mb-2';
                            slide.appendChild(vid);
                        } else if (type.startsWith('audio/') && src) {
                            const aud = document.createElement('audio');
                            aud.src = src;
                            aud.controls = true;
                            aud.className = 'mb-2';
                            slide.appendChild(aud);
                        } else {
                            const fileBox = document.createElement('div');
                            fileBox.className = 'flex flex-col items-center mb-2';
                            const fileIcon = document.createElement('i');
                            fileIcon.className = 'fa fa-file-alt text-2xl text-[#8B7EC8] mb-1';
                            const nameSpan = document.createElement('span');
                            nameSpan.className = 'text-xs text-[#6B6B7D]';
                            nameSpan.textContent = dlName;
                            fileBox.appendChild(fileIcon);
                            fileBox.appendChild(nameSpan);
                            slide.appendChild(fileBox);
                        }

                        if (dlUrl) {
                            const dlLink = document.createElement('a');
                            dlLink.href = dlUrl;
                            dlLink.download = dlName;
                            dlLink.rel = 'noopener noreferrer';
                            dlLink.className = 'inline-flex px-2 py-1 bg-[#8B7EC8] text-white rounded text-xs font-semibold hover:bg-[#6BCB77] transition items-center gap-2';
                            dlLink.addEventListener('click', (e) => e.stopPropagation());
                            const dlIcon = document.createElement('i');
                            dlIcon.className = 'fa fa-download';
                            dlLink.appendChild(dlIcon);
                            dlLink.appendChild(document.createTextNode(' Download'));
                            slide.appendChild(dlLink);
                        }

                        galleryDiv.appendChild(slide);
                    });

                    if (allRecentMedia.length > 1) {
                        const ctrlRow = document.createElement('div');
                        ctrlRow.className = 'flex gap-2 mt-2 items-center';

                        const makeNavBtn = (label, delta) => {
                            const btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = 'px-2 py-1 bg-[#ede9fe] text-[#7c3aed] rounded font-semibold text-xs';
                            btn.textContent = label;
                            btn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const s = galleryDiv.querySelectorAll('.media-slide');
                                let c = parseInt(galleryDiv.dataset.current || '0', 10);
                                c = (c + delta + s.length) % s.length;
                                galleryDiv.dataset.current = String(c);
                                s.forEach((x, i) => { x.style.display = i === c ? '' : 'none'; });
                            });
                            return btn;
                        };

                        const countSpan = document.createElement('span');
                        countSpan.className = 'text-xs text-gray-500';
                        countSpan.textContent = `${allRecentMedia.length} files`;

                        ctrlRow.appendChild(makeNavBtn('Prev', -1));
                        ctrlRow.appendChild(makeNavBtn('Next', 1));
                        ctrlRow.appendChild(countSpan);
                        galleryDiv.appendChild(ctrlRow);
                    }

                    body.appendChild(galleryDiv);
                }

                li.appendChild(body);
                list.appendChild(li);
            });
        } catch(e) {}
    }

    loadRecent();
});