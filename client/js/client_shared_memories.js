document.addEventListener('DOMContentLoaded', async () => {
    await loadNavbar();
    document.getElementById('mainApp').style.display = 'flex';

    let allUsers = [];
    let myMemories = [];
    try {
        const usersRes = await axios.get('/api/users');
        allUsers = usersRes.data;

        const memRes = await axios.get('/api/memories');
        myMemories = memRes.data;

        const selMem = document.getElementById('selected_memory_id');
        myMemories.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.memory_id;
            opt.textContent = `${m.title || '(No Title)'} (${m.date || ''})`;
            selMem.appendChild(opt);
        });
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
            if(m.image) {
                memImg.src = m.image.startsWith('uploads/') ? '/' + m.image : m.image;
                memImg.classList.remove('hidden');
            } else {
                memImg.classList.add('hidden');
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

        const fd = new FormData();
        fd.append('to_email', sEmail.value);
        fd.append('selected_memory_id', document.getElementById('selected_memory_id').value);
        fd.append('memory_title', document.getElementById('memory_title').value);
        fd.append('message', document.getElementById('message').value);
        fd.append('date', document.getElementById('date').value);
        
        const files = document.getElementById('attachments').files;
        for(let i=0; i<files.length; i++) {
            fd.append('attachments[]', files[i]);
        }

        try {
            await axios.post('/api/shared_memories', fd, { headers: { 'Content-Type': 'multipart/form-data' }});
            succ.classList.remove('hidden');
            document.getElementById('shareForm').reset();
            document.getElementById('memoryPreview').classList.add('hidden');
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
            data.slice(0,3).forEach(m => {
                const targetId = m.original_memory_id || m.memory_id;
                const galleryId = 'media-gallery-' + m.memory_id;
                let attachmentsHtml = '';
                
                if (m.attachments && m.attachments.length > 0) {
                    attachmentsHtml += `<div class="media-gallery mt-2" id="${galleryId}">`;
                    m.attachments.forEach((att, idx) => {
                        const ext = att.split('.').pop().toLowerCase();
                        let type = 'other';
                        if (['jpg','jpeg','png','gif','webp'].includes(ext)) type = 'image';
                        else if (['mp4','mov','avi','webm'].includes(ext)) type = 'video';
                        else if (['mp3','wav','ogg','aac','m4a'].includes(ext)) type = 'audio';
                        
                        const src = att.startsWith('uploads/') ? '/' + att : att;
                        const disp = idx === 0 ? '' : 'display:none;';
                        
                        attachmentsHtml += `<div class="media-slide" data-index="${idx}" style="${disp}">`;
                        if (type === 'image') {
                            attachmentsHtml += `<img src="${src}" class="max-h-32 rounded-lg mb-2" />`;
                        } else if (type === 'video') {
                            attachmentsHtml += `<video src="${src}" controls class="max-h-32 rounded-lg mb-2"></video>`;
                        } else if (type === 'audio') {
                            attachmentsHtml += `<audio src="${src}" controls class="mb-2"></audio>`;
                        } else {
                            attachmentsHtml += `<div class="flex flex-col items-center mb-2"><i class="fa fa-file-alt text-2xl text-[#8B7EC8] mb-1"></i><span class="text-xs text-[#6B6B7D]">${att.split('/').pop()}</span></div>`;
                        }
                        
                        attachmentsHtml += `
                            <a href="${src}" download class="inline-flex px-2 py-1 bg-[#8B7EC8] text-white rounded text-xs font-semibold hover:bg-[#6BCB77] transition items-center gap-2" onclick="event.stopPropagation();">
                                <i class="fa fa-download"></i> Download
                            </a>
                        </div>`;
                    });
                    
                    if (m.attachments.length > 1) {
                        attachmentsHtml += `
                        <div class="flex gap-2 mt-2">
                          <button type="button" onclick="event.stopPropagation(); const g=this.closest('.media-gallery'); let c=parseInt(g.dataset.current||0); const s=g.querySelectorAll('.media-slide'); c=(c-1+s.length)%s.length; g.dataset.current=c; s.forEach((x,i)=>x.style.display=i===c?'':'none');" class="px-2 py-1 bg-[#ede9fe] text-[#7c3aed] rounded font-semibold">Prev</button>
                          <button type="button" onclick="event.stopPropagation(); const g=this.closest('.media-gallery'); let c=parseInt(g.dataset.current||0); const s=g.querySelectorAll('.media-slide'); c=(c+1)%s.length; g.dataset.current=c; s.forEach((x,i)=>x.style.display=i===c?'':'none');" class="px-2 py-1 bg-[#ede9fe] text-[#7c3aed] rounded font-semibold">Next</button>
                        </div>`;
                    }
                    attachmentsHtml += `</div>`;
                }

                html += `
                <li class="flex items-center gap-3 p-4 rounded-xl bg-[#F5F3FB] hover:bg-[#E6F1FB] transition border border-[#F4A6A6]/30 cursor-pointer" onclick="window.location.href='/memories/view_shared_memory.html?id=${targetId}'">
                  <div class="flex-1 relative">
                    <div class="font-semibold text-[#8B7EC8]">
                      ${m.is_received ? 'From: ' + (m.from_username || m.from) : 'To: ' + (m.to_username || m.to)}
                      ${m.is_received && !m.seen ? '<span class="ml-2 text-xs bg-red-500 text-white px-2 py-0.5 rounded-full">New</span>' : ''}
                    </div>
                    <div class="text-sm text-gray-500">${m.memory_title || '(No Title)'}</div>
                    <div class="text-xs text-gray-400">${m.date || ''}</div>
                    <div class="text-xs text-gray-600 mt-1 line-clamp-2" style="max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
                      ${(m.message || '').substring(0,60)}${(m.message && m.message.length > 60) ? '...' : ''}
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