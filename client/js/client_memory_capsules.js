document.addEventListener('DOMContentLoaded', async () => {
    await loadNavbar();
    let currentUserEmail = '';
    let allUsers = [];

    // Load initial data
    try {
        const userRes = await axios.get('/api/current_user');
        currentUserEmail = userRes.data.email;
    } catch(err) {
        console.error(err);
    }

    // User Selection Logic
    const searchInput = document.getElementById('userSearchInput');
    const hiddenInput = document.getElementById('recipientEmailHidden');
    const selectedDisplay = document.getElementById('selectedUserDisplay');
    const selectedName = document.getElementById('selectedUserName');
    const myselfBtn = document.getElementById('btnMyself');
    const searchUserBtn = document.getElementById('btnSearchUser');
    const suggestionsBox = document.getElementById('userSuggestions');
    
    // Load users for search
    try {
        const usersRes = await axios.get('/api/users');
        allUsers = usersRes.data.map(u => ({
            email: u.email,
            display: `${u.name || u.username || u.email} (${u.email})`
        }));
    } catch(err) {
        console.error('Failed to load users for search:', err);
    }
    
    const selectUser = (email, display) => {
        hiddenInput.value = email;
        selectedName.textContent = display;
        searchInput.classList.add('hidden');
        selectedDisplay.classList.remove('hidden');
        suggestionsBox.classList.add('hidden');
        searchInput.disabled = true;
    };

    const clearSelection = () => {
        searchInput.value = '';
        hiddenInput.value = '';
        searchInput.classList.remove('hidden');
        selectedDisplay.classList.add('hidden');
        suggestionsBox.classList.add('hidden');
        searchInput.disabled = false;
        searchInput.placeholder = 'Type a name or email...';
        searchInput.focus();
    };

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        suggestionsBox.innerHTML = '';
        if (!query) {
            suggestionsBox.classList.add('hidden');
            return;
        }
        const filtered = allUsers.filter(u => u.display.toLowerCase().includes(query)).slice(0, 10);
        if (filtered.length > 0) {
            filtered.forEach(user => {
                const div = document.createElement('div');
                div.textContent = user.display;
                div.className = 'p-2 hover:bg-gray-200 cursor-pointer text-sm text-gray-800';
                div.onclick = () => selectUser(user.email, user.display);
                suggestionsBox.appendChild(div);
            });
            suggestionsBox.classList.remove('hidden');
        } else {
            suggestionsBox.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.classList.add('hidden');
        }
    });

    myselfBtn.addEventListener('click', () => {
        selectUser(currentUserEmail, currentUserEmail);
        myselfBtn.classList.add('active');
        searchUserBtn.classList.remove('active');
    });

    searchUserBtn.addEventListener('click', () => {
        clearSelection();
        searchUserBtn.classList.add('active');
        myselfBtn.classList.remove('active');
    });

    document.getElementById('clearUserSelection').addEventListener('click', clearSelection);

    // Form Submission
    document.getElementById('capsuleForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('errorMsg');
        const succ = document.getElementById('successMsg');
        err.classList.add('hidden');
        succ.classList.add('hidden');
        
        let recipient = hiddenInput.value || searchInput.value.trim();
        if (!recipient) {
            err.textContent = 'Please select a recipient or type an email.';
            err.classList.remove('hidden');
            return;
        }

        const formData = new FormData();
        formData.append('recipient_email', recipient);
        formData.append('message', document.getElementById('message').value);
        formData.append('description', document.getElementById('description').value);
        const localDateVal = document.getElementById('reveal_date').value;
        formData.append('reveal_date', new Date(localDateVal).toISOString());
        
        const fileInput = document.getElementById('mediaInput');
        Array.from(fileInput.files).forEach(f => {
            formData.append('media[]', f);
        });

        try {
            const res = await axios.post('/api/capsules', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            succ.textContent = res.data.message;
            succ.classList.remove('hidden');
            document.getElementById('capsuleForm').reset();
            clearSelection();
            myselfBtn.classList.remove('active');
            searchUserBtn.classList.remove('active');
            loadCapsules();
        } catch (error) {
            err.textContent = error.response?.data?.error || 'Failed to create capsule';
            err.classList.remove('hidden');
        }
    });

    // Media Recording Logic
    const videoPlayer = document.getElementById('videoPlayer');
    const mediaPreview = document.getElementById('mediaPreview');
    const fileInput = document.getElementById('mediaInput');
    let mediaRecorder;
    let recordedChunks = [];

    const startRecording = async (isAudioOnly) => {
        try {
            const constraints = isAudioOnly ? { audio: true } : { video: true, audio: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            videoPlayer.srcObject = stream;
            videoPlayer.src = null;
            videoPlayer.muted = !isAudioOnly;
            videoPlayer.controls = false;
            
            recordedChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                const mimeType = isAudioOnly ? 'audio/webm' : 'video/webm';
                const blob = new Blob(recordedChunks, { type: mimeType });
                
                mediaPreview.innerHTML = '';
                const el = document.createElement(isAudioOnly ? 'audio' : 'video');
                el.src = URL.createObjectURL(blob);
                el.controls = true;
                el.className = isAudioOnly ? 'w-full mb-2' : 'w-full h-48 rounded-lg mb-2';
                mediaPreview.appendChild(el);
                
                const confirmation = document.createElement('div');
                confirmation.className = 'text-pastel-green font-semibold mt-2';
                confirmation.textContent = 'Recording is ready to be submitted.';
                mediaPreview.appendChild(confirmation);

                const fileName = `recording-${Date.now()}.${isAudioOnly ? 'webm' : 'webm'}`;
                const file = new File([blob], fileName, { type: mimeType });
                
                const dataTransfer = new DataTransfer();
                Array.from(fileInput.files).forEach(f => dataTransfer.items.add(f));
                dataTransfer.items.add(file);
                fileInput.files = dataTransfer.files;

                stream.getTracks().forEach(track => track.stop());
            };
            mediaRecorder.start();
        } catch (err) {
            alert(`Could not start recording: ${err.message}`);
        }
    };

    const stopRecording = () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    };

    document.getElementById('recordVideoBtn').onclick = () => startRecording(false);
    document.getElementById('recordAudioBtn').onclick = () => startRecording(true);
    document.getElementById('stopVideoBtn').onclick = stopRecording;
    document.getElementById('stopAudioBtn').onclick = stopRecording;

    // Load capsules
    async function loadCapsules() {
        try {
            const res = await axios.get('/api/capsules');
            const capsules = res.data;
            
            const list = document.getElementById('capsulesList');
            if (capsules.length === 0) {
                list.innerHTML = '<div class="col-span-2 text-center text-gray-500 py-10">No time capsules found.</div>';
                return;
            }
            
            let html = '';
            capsules.forEach(c => {
                const isUnlocked = c.unlocked == 1;
                const rDateStr = c.reveal_date;
                let cTime = '';
                
                const pad = (n) => n.toString().padStart(2, '0');
                const localReveal = new Date(c.reveal_date.replace(' ', 'T') + 'Z');
                const displayReveal = isNaN(localReveal.getTime()) ? c.reveal_date : `${localReveal.getFullYear()}-${pad(localReveal.getMonth()+1)}-${pad(localReveal.getDate())} ${pad(localReveal.getHours())}:${pad(localReveal.getMinutes())}:${pad(localReveal.getSeconds())}`;
                
                const localCreated = new Date(c.created_at.replace(' ', 'T') + 'Z');
                const displayCreated = isNaN(localCreated.getTime()) ? c.created_at : `${localCreated.getFullYear()}-${pad(localCreated.getMonth()+1)}-${pad(localCreated.getDate())} ${pad(localCreated.getHours())}:${pad(localCreated.getMinutes())}:${pad(localCreated.getSeconds())}`;

                if (isUnlocked) {
                    cTime = `<p class="font-semibold mt-2 text-pastel-green"><i class="fas fa-gift mr-1"></i>Capsule is Unlocked</p>`;
                } else {
                    cTime = `<div class="font-semibold text-yellow-700 flex items-center"><i class="fas fa-hourglass-start mr-2"></i>Capsule unlocks in <span class="ml-2 countdown" data-reveal="${rDateStr}"></span></div>
                    <div class="text-center text-gray-400 w-full mt-4"><i class="fas fa-lock text-5xl mb-4"></i><p class="text-lg font-semibold">Content is Locked</p></div>`;
                }

                html += `
                <a href="/capsules/open_capsule.html?id=${encodeURIComponent(c.id)}" class="block group">
                    <div class="rounded-2xl shadow-lg border max-w-md w-full mx-auto p-6 flex flex-col justify-between h-full relative bg-white/90 transition-transform group-hover:scale-105 group-hover:shadow-2xl border-pastel-purple cursor-pointer">
                        <div class="absolute top-4 right-4">
                            <span class="inline-block px-3 py-1 rounded-full text-xs font-bold ${isUnlocked ? 'bg-pastel-green text-green-800' : 'bg-pastel-pink text-red-800'}">
                                <i class="fas ${isUnlocked ? 'fa-lock-open mr-1' : 'fa-lock mr-1'}"></i>${isUnlocked ? 'Unlocked' : 'Locked'}
                            </span>
                        </div>
                        <div class="flex items-center mb-3">
                            <i class="fas fa-user-circle text-2xl text-pastel-purple"></i>
                            <span class="text-lg font-semibold ml-3 text-gray-700">To: ${c.recipient_email}</span>
                        </div>
                        <div class="flex items-center text-sm mb-2 text-pastel-purple">
                            <i class="fas fa-calendar-alt mr-1"></i>Reveal: <span class="font-mono ml-1">${displayReveal}</span>
                        </div>
                        <div class="flex items-center text-sm mb-2 text-pastel-purple">
                            <i class="fas fa-clock mr-1"></i>Created: <span class="font-mono ml-1">${displayCreated}</span>
                        </div>
                        <div class="mt-2 mb-3 text-pastel-purple"><i class="fas fa-comment-dots mr-1"></i>${c.message.replace(/\n/g, '<br/>')}</div>
                        ${c.description ? `<div class="mb-3 text-sm text-gray-600"><i class="fas fa-sticky-note mr-1"></i>${c.description.replace(/\n/g, '<br/>')}</div>` : ''}
                        
                        <div class="mt-3">
                            ${cTime}
                        </div>
                    </div>
                </a>`;
            });
            list.innerHTML = html;
            
            // Start countdown timers
            setupCountdowns();
        } catch (err) {
            console.error(err);
            document.getElementById('capsulesList').innerHTML = '<div class="col-span-2 text-center text-red-500 py-10">Failed to load capsules.</div>';
        }
    }
    
    function setupCountdowns() {
        const countdowns = document.querySelectorAll('.countdown');
        if (countdowns.length === 0) return;

    

    const interval = setInterval(() => {
        let shouldReload = false;
        countdowns.forEach(el => {
            const revealDateStr = el.dataset.reveal;
            
            const now = new Date();
            const reveal = new Date(revealDateStr.replace(' ', 'T') + 'Z');
            let diffMs = reveal - now;

            if (diffMs <= 0) {
                if (el.textContent !== 'Ready to unlock! Refresh page.') {
                    el.textContent = 'Ready to unlock! Refresh page.';
                }
                return;
            }

            if (diffMs <= 0) {
                el.textContent = 'Ready to unlock! Refresh page.';
                return;
            }

            const y = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365));
            diffMs -= y * (1000 * 60 * 60 * 24 * 365);
            const m = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
            diffMs -= m * (1000 * 60 * 60 * 24 * 30);
            const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            diffMs -= d * (1000 * 60 * 60 * 24);
            const h = Math.floor(diffMs / (1000 * 60 * 60));
            diffMs -= h * (1000 * 60 * 60);
            const min = Math.floor(diffMs / (1000 * 60));
            diffMs -= min * (1000 * 60);
            const s = Math.floor(diffMs / 1000);

            el.textContent = `${y}y ${m}m ${d}d ${h}h ${min}m ${s}s`;
        });

    }, 1000);
}
    
    loadCapsules();
});