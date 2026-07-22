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
        document.getElementById('mTitle').textContent = mem.memory_title || 'Memory';
        document.getElementById('mDate').textContent = mem.date || '';
        document.getElementById('mDesc').innerHTML = (mem.message || '').replace(/\n/g, '<br/>');
        document.getElementById('mCreator').textContent = mem.from_username || mem.from;
        
        if (mem.description) {
            document.getElementById('mDescSection').classList.remove('hidden');
            document.getElementById('mUserDesc').innerHTML = mem.description.replace(/\n/g, '<br/>');
        }

        if (mem.mood) {
            document.getElementById('memMood').classList.remove('hidden');
            document.getElementById('mMoodText').textContent = mem.mood;
        }
        
        if (mem.location) {
            document.getElementById('memLocation').classList.remove('hidden');
            const locLink = document.getElementById('mLocText');
            locLink.href = 'https://www.google.com/maps/search/' + encodeURIComponent(mem.location);
            locLink.textContent = mem.location;
        }

        if (mem.tags) {
            const tagsArr = typeof mem.tags === 'string' ? mem.tags.split(',') : mem.tags;
            if (tagsArr.length > 0) {
                document.getElementById('memTags').classList.remove('hidden');
                document.getElementById('memTags').innerHTML = tagsArr.map(t => `<span class="inline-block px-3 py-1 rounded-full bg-[#A8C8EC] text-white text-xs font-medium">#${t.trim()}</span>`).join('');
            }
        }

        if (mem.friends && mem.friends.length > 0) {
            document.getElementById('memFriendsContainer').style.display = 'block';
            document.getElementById('memFriends').textContent = (Array.isArray(mem.friends) ? mem.friends : [mem.friends]).join(', ');
        }
        
        // Media
        const mg = document.getElementById('mediaGallery');
        let mediaHtml = '';
        const allMedia = [];
        if(mem.image) allMedia.push(mem.image);
        if(mem.attachments) mem.attachments.forEach(a => allMedia.push(a));
        
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
                const src = mPath.startsWith('uploads/') ? '/' + mPath : mPath;
                const ext = src.split('.').pop().toLowerCase();
                let mType = 'other';
                if(['jpg','jpeg','png','gif','webp'].includes(ext)) mType = 'image';
                if(['mp4','mov','webm'].includes(ext)) mType = 'video';
                if(['mp3','wav','ogg'].includes(ext)) mType = 'audio';

                mediaHtml += `<div class="media-slide w-full flex flex-col items-center mb-4" style="${disp}">`;
                if(mType === 'image') {
                    mediaHtml += `<img src="${src}" class="gallery-img w-full max-w-lg h-auto max-h-[400px] object-contain rounded-xl shadow border-2 border-[#8B7EC8] bg-white mb-2" />`;
                } else if (mType === 'video') {
                    mediaHtml += `<video src="${src}" controls class="w-full max-w-lg rounded-xl shadow border-2 border-[#8B7EC8] bg-black mb-2"></video>`;
                } else if (mType === 'audio') {
                    mediaHtml += `<audio src="${src}" controls class="w-full max-w-lg mb-2"></audio>`;
                } else {
                    mediaHtml += `<div class="w-full flex items-center justify-center h-32 bg-[#F5F3FB] rounded-xl border border-[#E8E3F5] mb-2"><i class="fa fa-file-alt text-4xl text-[#8B7EC8]"></i></div>`;
                }
                mediaHtml += `<a href="${src}" download class="px-3 py-1 bg-[#8B7EC8] text-white rounded-md text-xs font-semibold hover:bg-[#6BCB77] transition flex items-center gap-2"><i class="fa fa-download"></i> Download</a></div>`;
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
        const skipFields = ['image', 'memory_id', 'created_at', 'updated_at', 'original_memory_id', 'user_email', 'email', 'created_by', 'attachment', 'attachments', 'description', 'date', 'mood', 'message', 'title', 'memory_title'];
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