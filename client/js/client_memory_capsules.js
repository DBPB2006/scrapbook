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
        const list = document.getElementById('capsulesList');
        try {
            const res = await axios.get('/api/capsules?t=' + Date.now());
            const capsules = res.data || [];

            list.textContent = '';
            if (capsules.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'col-span-2 text-center text-gray-500 py-10';
                emptyDiv.textContent = 'No time capsules found.';
                list.appendChild(emptyDiv);
                return;
            }

            capsules.forEach(c => {
                const isUnlocked = c.unlocked == 1;
                const rDateStr = c.reveal_date || '';

                const pad = (n) => n.toString().padStart(2, '0');
                const localReveal = new Date(String(rDateStr).replace(' ', 'T') + 'Z');
                const displayReveal = isNaN(localReveal.getTime()) ? rDateStr : `${localReveal.getFullYear()}-${pad(localReveal.getMonth()+1)}-${pad(localReveal.getDate())} ${pad(localReveal.getHours())}:${pad(localReveal.getMinutes())}:${pad(localReveal.getSeconds())}`;

                const cDateStr = c.created_at || '';
                const localCreated = new Date(String(cDateStr).replace(' ', 'T') + 'Z');
                const displayCreated = isNaN(localCreated.getTime()) ? cDateStr : `${localCreated.getFullYear()}-${pad(localCreated.getMonth()+1)}-${pad(localCreated.getDate())} ${pad(localCreated.getHours())}:${pad(localCreated.getMinutes())}:${pad(localCreated.getSeconds())}`;

                const link = document.createElement('a');
                link.href = `/capsules/open_capsule.html?id=${encodeURIComponent(c.id)}`;
                link.className = 'block group';

                const card = document.createElement('div');
                card.className = 'rounded-2xl shadow-lg border max-w-md w-full mx-auto p-6 flex flex-col justify-between h-full relative bg-white/90 transition-transform group-hover:scale-105 group-hover:shadow-2xl border-pastel-purple cursor-pointer';

                const badgeWrap = document.createElement('div');
                badgeWrap.className = 'absolute top-4 right-4';
                const badge = document.createElement('span');
                badge.className = `inline-block px-3 py-1 rounded-full text-xs font-bold ${isUnlocked ? 'bg-pastel-green text-green-800' : 'bg-pastel-pink text-red-800'}`;
                const badgeIcon = document.createElement('i');
                badgeIcon.className = `fas ${isUnlocked ? 'fa-lock-open mr-1' : 'fa-lock mr-1'}`;
                badge.appendChild(badgeIcon);
                badge.appendChild(document.createTextNode(isUnlocked ? 'Unlocked' : 'Locked'));
                badgeWrap.appendChild(badge);
                card.appendChild(badgeWrap);

                const recipRow = document.createElement('div');
                recipRow.className = 'flex items-center mb-3';
                const userIcon = document.createElement('i');
                userIcon.className = 'fas fa-user-circle text-2xl text-pastel-purple';
                const recipSpan = document.createElement('span');
                recipSpan.className = 'text-lg font-semibold ml-3 text-gray-700';
                recipSpan.textContent = `To: ${c.recipient_email || ''}`;
                recipRow.appendChild(userIcon);
                recipRow.appendChild(recipSpan);
                card.appendChild(recipRow);

                const revealRow = document.createElement('div');
                revealRow.className = 'flex items-center text-sm mb-2 text-pastel-purple';
                const calIcon = document.createElement('i');
                calIcon.className = 'fas fa-calendar-alt mr-1';
                revealRow.appendChild(calIcon);
                revealRow.appendChild(document.createTextNode('Reveal: '));
                const revealVal = document.createElement('span');
                revealVal.className = 'font-mono ml-1';
                revealVal.textContent = displayReveal;
                revealRow.appendChild(revealVal);
                card.appendChild(revealRow);

                const createdRow = document.createElement('div');
                createdRow.className = 'flex items-center text-sm mb-2 text-pastel-purple';
                const clockIcon = document.createElement('i');
                clockIcon.className = 'fas fa-clock mr-1';
                createdRow.appendChild(clockIcon);
                createdRow.appendChild(document.createTextNode('Created: '));
                const createdVal = document.createElement('span');
                createdVal.className = 'font-mono ml-1';
                createdVal.textContent = displayCreated;
                createdRow.appendChild(createdVal);
                card.appendChild(createdRow);

                const msgDiv = document.createElement('div');
                msgDiv.className = 'mt-2 mb-3 text-pastel-purple';
                const msgIcon = document.createElement('i');
                msgIcon.className = 'fas fa-comment-dots mr-1';
                msgDiv.appendChild(msgIcon);
                window.MemoryBookConfig.setTextWithBreaks(msgDiv, c.message || '', { append: true });
                card.appendChild(msgDiv);

                if (c.description) {
                    const descDiv = document.createElement('div');
                    descDiv.className = 'mb-3 text-sm text-gray-600';
                    const descIcon = document.createElement('i');
                    descIcon.className = 'fas fa-sticky-note mr-1';
                    descDiv.appendChild(descIcon);
                    window.MemoryBookConfig.setTextWithBreaks(descDiv, c.description, { append: true });
                    card.appendChild(descDiv);
                }

                const statusWrap = document.createElement('div');
                statusWrap.className = 'mt-3';
                if (isUnlocked) {
                    const unlockedP = document.createElement('p');
                    unlockedP.className = 'font-semibold mt-2 text-pastel-green';
                    const giftIcon = document.createElement('i');
                    giftIcon.className = 'fas fa-gift mr-1';
                    unlockedP.appendChild(giftIcon);
                    unlockedP.appendChild(document.createTextNode('Capsule is Unlocked'));
                    statusWrap.appendChild(unlockedP);
                } else {
                    const countdownRow = document.createElement('div');
                    countdownRow.className = 'font-semibold text-yellow-700 flex items-center';
                    const hgIcon = document.createElement('i');
                    hgIcon.className = 'fas fa-hourglass-start mr-2';
                    countdownRow.appendChild(hgIcon);
                    countdownRow.appendChild(document.createTextNode('Capsule unlocks in '));
                    const cdSpan = document.createElement('span');
                    cdSpan.className = 'ml-2 countdown';
                    cdSpan.dataset.reveal = rDateStr;
                    countdownRow.appendChild(cdSpan);

                    const lockedBanner = document.createElement('div');
                    lockedBanner.className = 'text-center text-gray-400 w-full mt-4';
                    const lockIcon = document.createElement('i');
                    lockIcon.className = 'fas fa-lock text-5xl mb-4';
                    const lockText = document.createElement('p');
                    lockText.className = 'text-lg font-semibold';
                    lockText.textContent = 'Content is Locked';
                    lockedBanner.appendChild(lockIcon);
                    lockedBanner.appendChild(lockText);

                    statusWrap.appendChild(countdownRow);
                    statusWrap.appendChild(lockedBanner);
                }
                card.appendChild(statusWrap);
                link.appendChild(card);
                list.appendChild(link);
            });

            // Start countdown timers
            setupCountdowns();
        } catch (err) {
            console.error(err);
            list.textContent = '';
            const errDiv = document.createElement('div');
            errDiv.className = 'col-span-2 text-center text-red-500 py-10';
            errDiv.textContent = 'Failed to load capsules.';
            list.appendChild(errDiv);
        }
    }
    
    function setupCountdowns() {
        const countdowns = document.querySelectorAll('.countdown');
        if (countdowns.length === 0) return;

        setInterval(() => {
            countdowns.forEach(el => {
                const revealDateStr = el.dataset.reveal;
                if (!revealDateStr) return;
                
                const now = new Date();
                const reveal = new Date(revealDateStr.replace(' ', 'T') + 'Z');
                let diffMs = reveal - now;

                if (diffMs <= 0) {
                    if (el.textContent !== 'Ready to unlock! Refresh page.') {
                        el.textContent = 'Ready to unlock! Refresh page.';
                    }
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