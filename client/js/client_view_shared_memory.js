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
        const res = await axios.get('/api/shared_memories/' + mid);
        const mem = res.data.sharedMemory;
        const received = res.data.receivedMemories;

        document.getElementById('appContent').style.display = 'flex';

        // Sidebar
        const sb = document.getElementById('sidebarMemories');
        received.forEach(m => {
            const isActive = (m.original_memory_id === mid) || (m.memory_id === mid);
            const initial = (m.memory_title || m.original_memory_id || 'M').substring(0,2).toUpperCase();
            const link = document.createElement('a');
            link.href="/memories/view_shared_memory.html?id=" + encodeURIComponent(m.original_memory_id || m.memory_id);
            link.className = `flex flex-col items-center w-full py-2 rounded-xl transition ${isActive ? 'bg-[#8B7EC8]/20 border-l-4 border-[#8B7EC8]' : 'hover:bg-[#A8C8EC]/10'}`;
            link.innerHTML = `
                <div class="w-10 h-10 rounded-full bg-[#A8C8EC] flex items-center justify-center text-lg font-bold text-white border-2 border-[#8B7EC8] mb-1">${initial}</div>
                <span class="text-xs text-[#8B7EC8] font-semibold truncate w-16 text-center">${m.memory_title || 'M'}</span>
            `;
            sb.appendChild(link);
        });

        // Main Details
        document.getElementById('mTitle').textContent = mem.memory_title || mem.title || 'Memory';
        document.getElementById('mDate').textContent = mem.date || '';
        document.getElementById('mDesc').innerHTML = (mem.description || mem.message || '').replace(/\n/g, '<br/>');
        document.getElementById('mCreator').textContent = mem.from_username || mem.from;
        
        // Show shared message if distinct from description
        const msgContainer = document.getElementById('mMsgContainer');
        const msgEl = document.getElementById('mMsg');
        if (msgContainer && msgEl) {
            if (mem.message && mem.description && mem.message.trim() !== mem.description.trim()) {
                msgContainer.style.display = 'block';
                msgEl.innerHTML = mem.message.replace(/\n/g, '<br/>');
            } else {
                msgContainer.style.display = 'none';
            }
        }

        if (mem.description) {
            const descSec = document.getElementById('mDescSection');
            const userDescEl = document.getElementById('mUserDesc');
            if (descSec && userDescEl) {
                descSec.classList.remove('hidden');
                userDescEl.innerHTML = mem.description.replace(/\n/g, '<br/>');
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

        if (mem.tags) {
            const tagsArr = typeof mem.tags === 'string' ? mem.tags.split(',') : (Array.isArray(mem.tags) ? mem.tags : [mem.tags]);
            const cleanTags = tagsArr.map(t => t.trim()).filter(Boolean);
            if (cleanTags.length > 0) {
                document.getElementById('memTags').classList.remove('hidden');
                document.getElementById('memTags').innerHTML = cleanTags.map(t => `<span class="inline-block px-3 py-1 rounded-full bg-[#A8C8EC] text-white text-xs font-medium">#${t.replace(/^#/, '')}</span>`).join('');
            } else {
                document.getElementById('memTags').classList.add('hidden');
            }
        } else {
            document.getElementById('memTags').classList.add('hidden');
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
        let mediaHtml = '';
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

        if(allMedia.length > 0) {
            allMedia.forEach((mPath, idx) => {
                const disp = idx === 0 ? '' : 'display:none;';
                const rawUrl = typeof mPath === 'string' ? mPath : (mPath.url || mPath.preview_url || mPath.path || '');
                const src = window.MemoryBookConfig ? window.MemoryBookConfig.resolveMediaUrl(rawUrl) : rawUrl;
                const ext = window.MemoryBookConfig ? window.MemoryBookConfig.getCleanExtension(src) : src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
                let mType = (typeof mPath === 'object' && (mPath.type || mPath.mimeType)) || '';
                if (!mType) {
                    if(['jpg','jpeg','png','gif','webp','svg'].includes(ext)) mType = 'image/jpeg';
                    else if(['mp4','mov','webm','ogg'].includes(ext)) mType = 'video/mp4';
                    else if(['mp3','wav','ogg','aac','m4a'].includes(ext)) mType = 'audio/mpeg';
                }

                mediaHtml += `<div class="media-slide w-full flex flex-col items-center mb-4" style="${disp}">`;
                if(mType.startsWith('image/')) {
                    mediaHtml += `<img src="${src}" class="gallery-img w-full max-w-lg h-auto max-h-[400px] object-contain rounded-xl shadow border-2 border-[#8B7EC8] bg-white mb-2" />`;
                } else if (mType.startsWith('video/')) {
                    mediaHtml += `<video src="${src}" controls class="w-full max-w-lg rounded-xl shadow border-2 border-[#8B7EC8] bg-black mb-2" type="${mType}"></video>`;
                } else if (mType.startsWith('audio/')) {
                    mediaHtml += `<audio src="${src}" controls class="w-full max-w-lg mb-2" type="${mType}"></audio>`;
                } else {
                    const dispFileName = (typeof mPath === 'object' && (mPath.fileName || mPath.name)) || (typeof rawUrl === 'string' ? rawUrl.split('?')[0].split('/').pop() : 'File');
                    mediaHtml += `<div class="w-full flex flex-col items-center justify-center h-32 bg-[#F5F3FB] rounded-xl border border-[#E8E3F5] mb-2"><i class="fa fa-file-alt text-4xl text-[#8B7EC8]"></i><span class="ml-2 text-sm">${dispFileName}</span></div>`;
                }
                const dlUrl = (typeof mPath === 'object' && mPath.download_url) ? mPath.download_url : src;
                const dlName = (typeof mPath === 'object' && (mPath.fileName || mPath.name)) || (typeof rawUrl === 'string' ? rawUrl.split('?')[0].split('/').pop() : 'download');
                mediaHtml += `<a href="${dlUrl}" download="${dlName}" class="px-3 py-1 bg-[#8B7EC8] text-white rounded-md text-xs font-semibold hover:bg-[#6BCB77] transition flex items-center gap-2"><i class="fa fa-download"></i> Download</a></div>`;
            });
            mg.innerHTML = mediaHtml;
            
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
            mg.innerHTML = '<div class="text-center text-gray-400">No media files.</div>';
        }

        // Extra details
        let extraHtml = '';
        const skipFields = ['image', 'memory_id', 'created_at', 'updated_at', 'original_memory_id', 'user_email', 'email', 'created_by', 'attachment', 'attachments', 'description', 'date', 'mood', 'message', 'title', 'memory_title', 'media', 'raw_media', 'seen', 'from', 'to', 'from_username', 'to_username', '_id', 'original_owner', 'friends', 'tags', 'location'];
        for (const [key, val] of Object.entries(mem)) {
            if (skipFields.includes(key)) continue;
            if (key.includes('email') && typeof val === 'string' && val.includes('@')) continue; // rough filter for filter_var email
            if (typeof val === 'string' && (val.includes('/Applications/') || val.includes('uploads/') || val.includes('.jpg') || val.includes('.png'))) continue;
            if (val === '' || val == null) continue;
            
            const disp = Array.isArray(val) ? val.join(', ') : val;
            extraHtml += `
            <div class="flex justify-between items-center py-2">
                <dt class="font-medium text-gray-600 capitalize">${key.replace(/_/g, ' ')}</dt>
                <dd class="text-gray-800 text-right">${disp}</dd>
            </div>`;
        }
        
        if (extraHtml) {
            document.getElementById('extraDetailsSection').classList.remove('hidden');
            document.getElementById('extraDetails').innerHTML = extraHtml;
        }

    } catch(e) {
        alert('Failed to load shared memory.');
        window.location.href="/memories/shared_memories.html";
    }
});