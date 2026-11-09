document.addEventListener('DOMContentLoaded', async () => {
    await loadNavbar();
    const urlParams = new URLSearchParams(window.location.search);
    const mid = urlParams.get('id');
    if (!mid) {
        alert('No memory ID provided.');
        window.location.href="/memories/shared_memories.html";
        return;
    }

    try {
        const res = await axios.get('/api/shared_memories/' + encodeURIComponent(mid));
        const mem = res.data.sharedMemory;
        const received = res.data.receivedMemories || [];

        document.getElementById('appContent').style.display = 'flex';

        // Sidebar
        const sb = document.getElementById('sidebarMemories');
        received.forEach(m => {
            const isActive = (m.memory_id === mid) || (m.original_memory_id === mid);
            const initial = (m.memory_title || m.original_memory_id || 'M').substring(0,2).toUpperCase();
            const link = document.createElement('a');
            link.href = '/memories/view_shared_memory.html?id=' + encodeURIComponent(m.memory_id || m.original_memory_id);
            link.className = `flex flex-col items-center w-full py-2 rounded-xl transition ${isActive ? 'bg-[#8B7EC8]/20 border-l-4 border-[#8B7EC8]' : 'hover:bg-[#A8C8EC]/10'}`;

            const circle = document.createElement('div');
            circle.className = 'w-10 h-10 rounded-full bg-[#A8C8EC] flex items-center justify-center text-lg font-bold text-white border-2 border-[#8B7EC8] mb-1';
            circle.textContent = initial;

            const label = document.createElement('span');
            label.className = 'text-xs text-[#8B7EC8] font-semibold truncate w-16 text-center';
            label.textContent = m.memory_title || 'M';

            link.appendChild(circle);
            link.appendChild(label);
            sb.appendChild(link);
        });

        // Main Details
        document.getElementById('mTitle').textContent = mem.memory_title || mem.title || 'Memory';
        document.getElementById('mDate').textContent = mem.date || '';
        window.MemoryBookConfig.setTextWithBreaks(document.getElementById('mDesc'), mem.description || mem.message || '');
        document.getElementById('mCreator').textContent = mem.from_username || mem.from;

        // Show shared message if distinct from description
        const msgContainer = document.getElementById('mMsgContainer');
        const msgEl = document.getElementById('mMsg');
        if (msgContainer && msgEl) {
            if (mem.message && mem.description && mem.message.trim() !== mem.description.trim()) {
                msgContainer.style.display = 'block';
                window.MemoryBookConfig.setTextWithBreaks(msgEl, mem.message);
            } else {
                msgContainer.style.display = 'none';
            }
        }

        if (mem.description) {
            const descSec = document.getElementById('mDescSection');
            const userDescEl = document.getElementById('mUserDesc');
            if (descSec && userDescEl) {
                descSec.classList.remove('hidden');
                window.MemoryBookConfig.setTextWithBreaks(userDescEl, mem.description);
            }
        }

        if (mem.mood) {
            document.getElementById('memMood').classList.remove('hidden');
            document.getElementById('mMoodText').textContent = mem.mood;
        } else {
            document.getElementById('memMood').classList.add('hidden');
        }
        
        if (mem.location) {
            document.getElementById('memLocation').classList.remove('hidden');
            const locLink = document.getElementById('mLocText');
            locLink.href = 'https://www.google.com/maps/search/' + encodeURIComponent(mem.location);
            locLink.textContent = mem.location;
        } else {
            document.getElementById('memLocation').classList.add('hidden');
        }

        const memTagsEl = document.getElementById('memTags');
        memTagsEl.textContent = '';
        if (mem.tags) {
            const tagsArr = typeof mem.tags === 'string' ? mem.tags.split(',') : (Array.isArray(mem.tags) ? mem.tags : [mem.tags]);
            const cleanTags = tagsArr.map(t => String(t).trim()).filter(Boolean);
            if (cleanTags.length > 0) {
                memTagsEl.classList.remove('hidden');
                cleanTags.forEach(t => {
                    const span = document.createElement('span');
                    span.className = 'inline-block px-3 py-1 rounded-full bg-[#A8C8EC] text-white text-xs font-medium';
                    span.textContent = '#' + t.replace(/^#/, '');
                    memTagsEl.appendChild(span);
                });
            } else {
                memTagsEl.classList.add('hidden');
            }
        } else {
            memTagsEl.classList.add('hidden');
        }

        if (mem.friends && (Array.isArray(mem.friends) ? mem.friends.length > 0 : Boolean(mem.friends))) {
            document.getElementById('memFriendsContainer').style.display = 'block';
            const fList = Array.isArray(mem.friends) ? mem.friends : [mem.friends];
            document.getElementById('memFriends').textContent = fList.join(', ');
        } else {
            document.getElementById('memFriendsContainer').style.display = 'none';
        }
        
        // Media Gallery - combine attachments, original memory media, and image with deduplication
        const mg = document.getElementById('mediaGallery');
        mg.textContent = '';
        const allMedia = [];
        const seenKeys = new Set();

        function addMediaItem(item) {
            if (!item) return;
            let dedupeKey = '';
            if (typeof item === 'string') {
                dedupeKey = item.split('?')[0];
            } else if (typeof item === 'object') {
                dedupeKey = item.key || (item.url && typeof item.url === 'object' && item.url.key) || (item.preview_url ? item.preview_url.split('?')[0] : '') || (typeof item.url === 'string' ? item.url.split('?')[0] : '');
            }
            if (dedupeKey && seenKeys.has(dedupeKey)) return;
            if (dedupeKey) seenKeys.add(dedupeKey);
            allMedia.push(item);
        }

        if (mem.attachments && Array.isArray(mem.attachments)) {
            mem.attachments.forEach(a => addMediaItem(a));
        }
        if (mem.media && Array.isArray(mem.media)) {
            mem.media.forEach(m => addMediaItem(m));
        }
        if (mem.image) {
            addMediaItem(mem.image);
        }
        
        let slidesCount = allMedia.length;
        let currentSlide = 0;

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

        if (allMedia.length > 0) {
            allMedia.forEach((mPath, idx) => {
                const slide = document.createElement('div');
                slide.className = 'media-slide w-full flex flex-col items-center mb-4';
                if (idx !== 0) slide.style.display = 'none';

                const rawUrl = typeof mPath === 'string' ? mPath : (mPath.url || mPath.preview_url || mPath.path || '');
                const src = window.MemoryBookConfig.resolveMediaUrl(rawUrl);
                const ext = window.MemoryBookConfig.getCleanExtension(src);
                let mType = (typeof mPath === 'object' && (mPath.type || mPath.mimeType)) || '';
                if (!mType) {
                    if(['jpg','jpeg','png','gif','webp'].includes(ext)) mType = 'image/jpeg';
                    else if(['mp4','mov','webm','ogg'].includes(ext)) mType = 'video/mp4';
                    else if(['mp3','wav','ogg','aac','m4a'].includes(ext)) mType = 'audio/mpeg';
                }

                if (mType.startsWith('image/') && src) {
                    const img = document.createElement('img');
                    img.src = src;
                    img.className = 'gallery-img w-full max-w-lg h-auto max-h-[400px] object-contain rounded-xl shadow border-2 border-[#8B7EC8] bg-white mb-2';
                    slide.appendChild(img);
                } else if (mType.startsWith('video/') && src) {
                    const vid = document.createElement('video');
                    vid.src = src;
                    vid.controls = true;
                    vid.className = 'w-full max-w-lg rounded-xl shadow border-2 border-[#8B7EC8] bg-black mb-2';
                    vid.setAttribute('type', mType);
                    slide.appendChild(vid);
                } else if (mType.startsWith('audio/') && src) {
                    const aud = document.createElement('audio');
                    aud.src = src;
                    aud.controls = true;
                    aud.className = 'w-full max-w-lg mb-2';
                    aud.setAttribute('type', mType);
                    slide.appendChild(aud);
                } else {
                    const dispFileName = (typeof mPath === 'object' && (mPath.fileName || mPath.name)) || (typeof rawUrl === 'string' ? rawUrl.split('?')[0].split('/').pop() : 'File');
                    const box = document.createElement('div');
                    box.className = 'w-full flex flex-col items-center justify-center h-32 bg-[#F5F3FB] rounded-xl border border-[#E8E3F5] mb-2';
                    const icon = document.createElement('i');
                    icon.className = 'fa fa-file-alt text-4xl text-[#8B7EC8]';
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'ml-2 text-sm';
                    nameSpan.textContent = dispFileName;
                    box.appendChild(icon);
                    box.appendChild(nameSpan);
                    slide.appendChild(box);
                }

                const dlUrl = (typeof mPath === 'object' && mPath.download_url) ? window.MemoryBookConfig.resolveMediaUrl(mPath.download_url) : src;
                const dlName = (typeof mPath === 'object' && (mPath.fileName || mPath.name)) || (typeof rawUrl === 'string' ? rawUrl.split('?')[0].split('/').pop() : 'download');
                if (dlUrl) {
                    const dlLink = document.createElement('a');
                    dlLink.href = dlUrl;
                    dlLink.download = dlName;
                    dlLink.rel = 'noopener noreferrer';
                    dlLink.className = 'px-3 py-1 bg-[#8B7EC8] text-white rounded-md text-xs font-semibold hover:bg-[#6BCB77] transition flex items-center gap-2';
                    const dlIcon = document.createElement('i');
                    dlIcon.className = 'fa fa-download';
                    dlLink.appendChild(dlIcon);
                    dlLink.appendChild(document.createTextNode(' Download'));
                    slide.appendChild(dlLink);
                }

                mg.appendChild(slide);
            });

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
            const emptyMedia = document.createElement('div');
            emptyMedia.className = 'text-center text-gray-400';
            emptyMedia.textContent = 'No media files.';
            mg.appendChild(emptyMedia);
        }

        // Extra details
        const extraContainer = document.getElementById('extraDetails');
        extraContainer.textContent = '';
        let hasExtra = false;
        const skipFields = ['image', 'memory_id', 'created_at', 'updated_at', 'original_memory_id', 'user_email', 'email', 'created_by', 'attachment', 'attachments', 'description', 'date', 'mood', 'message', 'title', 'memory_title', 'media', 'raw_media', 'seen', 'from', 'to', 'from_username', 'to_username', '_id', 'original_owner', 'friends', 'tags', 'location'];
        for (const [key, val] of Object.entries(mem)) {
            if (skipFields.includes(key)) continue;
            if (key.includes('email') && typeof val === 'string' && val.includes('@')) continue; // rough filter for filter_var email
            if (typeof val === 'string' && (val.includes('/Applications/') || val.includes('uploads/') || val.includes('.jpg') || val.includes('.png'))) continue;
            if (val === '' || val == null) continue;

            const disp = Array.isArray(val) ? val.join(', ') : String(val);
            const row = document.createElement('div');
            row.className = 'flex justify-between items-center py-2';
            const dt = document.createElement('dt');
            dt.className = 'font-medium text-gray-600 capitalize';
            dt.textContent = key.replace(/_/g, ' ');
            const dd = document.createElement('dd');
            dd.className = 'text-gray-800 text-right';
            dd.textContent = disp;
            row.appendChild(dt);
            row.appendChild(dd);
            extraContainer.appendChild(row);
            hasExtra = true;
        }

        if (hasExtra) {
            document.getElementById('extraDetailsSection').classList.remove('hidden');
        }

    } catch(e) {
        alert('Failed to load shared memory.');
        window.location.href="/memories/shared_memories.html";
    }
});