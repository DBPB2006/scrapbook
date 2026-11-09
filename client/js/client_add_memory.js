document.addEventListener('DOMContentLoaded', async () => {
            await loadNavbar();

            let selectedFriendEmails = new Set();
            try {
                const res = await axios.get('/api/current_user');
                const user = res.data;
                const flist = document.getElementById('availableFriendsList');
                flist.textContent = '';
                if (user.friends && user.friends.length > 0) {
                    user.friends.forEach(f => {
                        const em = f.email || f.friend_id || '';
                        const fName = f.name || em;
                        const label = document.createElement('label');
                        label.className = 'flex items-center gap-2 mb-2';

                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.name = 'friend_check';
                        cb.value = em;
                        cb.dataset.name = fName;
                        cb.addEventListener('change', function() {
                            if (this.checked) selectedFriendEmails.add(this.value);
                            else selectedFriendEmails.delete(this.value);
                        });

                        const span = document.createElement('span');
                        span.textContent = `${fName} (${em})`;

                        label.appendChild(cb);
                        label.appendChild(span);
                        flist.appendChild(label);
                    });
                } else {
                    const emptySpan = document.createElement('span');
                    emptySpan.className = 'text-sm text-gray-500 block mb-3';
                    emptySpan.textContent = 'No friends added yet.';
                    const addLink = document.createElement('a');
                    addLink.href = '/friends/add_friend.html';
                    addLink.className = 'text-[#8B7EC8] font-medium hover:underline inline-flex items-center text-sm';
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-user-plus mr-2';
                    addLink.appendChild(icon);
                    addLink.appendChild(document.createTextNode('Add a friend'));
                    flist.appendChild(emptySpan);
                    flist.appendChild(addLink);
                }
            } catch(e) {
                console.error(e);
            }

            const description = document.getElementById('description');
            const charCount = document.getElementById('charCount');
            description.addEventListener('input', function() {
                const count = description.value.length;
                charCount.textContent = `${count}/500`;
                if (count > 500) charCount.classList.add('text-red-500');
                else charCount.classList.remove('text-red-500');
            });

            // USER SEARCH AUTOCOMPLETE
            const userSearchInput = document.getElementById('userSearchInput');
            const userSuggestions = document.getElementById('userSuggestions');
            const selectedFriends = document.getElementById('selectedFriends');
            let allUsers = [];

            if (userSearchInput) {
                // Fetch all users once for client-side filtering (or could hit a search API)
                try {
                    const res = await axios.get('/api/users');
                    allUsers = res.data;
                } catch(e) { console.error('Failed to load users for search', e); }

                userSearchInput.addEventListener('input', function() {
                    const query = this.value.trim().toLowerCase();
                    userSuggestions.innerHTML = '';
                    if (query.length < 1) return;

                    const matches = allUsers.filter(u => 
                        (u.name && u.name.toLowerCase().includes(query)) || 
                        (u.username && u.username.toLowerCase().includes(query)) ||
                        (u.email && u.email.toLowerCase().includes(query))
                    );

                    matches.forEach(user => {
                        const div = document.createElement('div');
                        div.className = 'px-4 py-2 hover:bg-[#F5F3FB] cursor-pointer text-sm text-[#2D2A3D] border-b border-[#E8E3F5] last:border-0';
                        const displayName = user.name || user.username || user.email;
                        div.textContent = `${displayName} (${user.email})`;
                        div.onclick = () => {
                            const findFriendCheckbox = (email) => {
                                const listEl = document.getElementById('availableFriendsList');
                                if (!listEl) return null;
                                return Array.from(listEl.querySelectorAll('input[type="checkbox"]')).find(cb => cb.value === email) || null;
                            };
                            if (!selectedFriendEmails.has(user.email)) {
                                selectedFriendEmails.add(user.email);

                                const badge = document.createElement('div');
                                badge.className = 'inline-flex items-center bg-[#8B7EC8] text-white px-3 py-1 rounded-full mr-2 mb-2 text-sm';
                                badge.appendChild(document.createTextNode(displayName + ' '));

                                const rmBtn = document.createElement('button');
                                rmBtn.type = 'button';
                                rmBtn.className = 'ml-2 hover:text-[#2D2A3D]';
                                const timesIcon = document.createElement('i');
                                timesIcon.className = 'fas fa-times';
                                rmBtn.appendChild(timesIcon);
                                rmBtn.onclick = function() {
                                    badge.remove();
                                    selectedFriendEmails.delete(user.email);
                                    // Uncheck if it was in the checkbox list
                                    const cb = findFriendCheckbox(user.email);
                                    if (cb) cb.checked = false;
                                };
                                badge.appendChild(rmBtn);
                                selectedFriends.appendChild(badge);

                                // Check if it was in the checkbox list
                                const cb = findFriendCheckbox(user.email);
                                if (cb) cb.checked = true;
                            }
                            userSearchInput.value = '';
                            userSuggestions.textContent = '';
                        };
                        userSuggestions.appendChild(div);
                    });
                });
                
                document.addEventListener('click', function(e) {
                    if (!userSearchInput.contains(e.target) && !userSuggestions.contains(e.target)) {
                        userSuggestions.innerHTML = '';
                    }
                });
            }

            // LOCATION AUTOCOMPLETE
            const locationInput = document.getElementById('location');
            const locationSuggestions = document.getElementById('locationSuggestions');
            const LOCATIONIQ_API_KEY = (window.MemoryBookConfig && window.MemoryBookConfig.LOCATIONIQ_API_KEY) || '';
            let locationTimeout = null;

            locationInput.addEventListener('input', function() {
                const query = this.value.trim();
                locationSuggestions.innerHTML = '';
                if (!LOCATIONIQ_API_KEY || query.length < 3) {
                    locationSuggestions.classList.add('hidden');
                    return;
                }
                clearTimeout(locationTimeout);
                locationTimeout = setTimeout(() => {
                    fetch(`https://us1.locationiq.com/v1/autocomplete?key=${encodeURIComponent(LOCATIONIQ_API_KEY)}&q=${encodeURIComponent(query)}&limit=5&format=json`)
                        .then(res => res.json())
                        .then(data => {
                            locationSuggestions.innerHTML = '';
                            if (data && !data.error && data.length > 0) {
                                data.forEach(item => {
                                    const div = document.createElement('div');
                                    div.className = 'px-4 py-2 hover:bg-[#F5F3FB] cursor-pointer text-sm text-[#2D2A3D] border-b border-[#E8E3F5] last:border-0';
                                    div.textContent = item.display_name;
                                    div.onclick = () => {
                                        locationInput.value = item.display_name;
                                        locationSuggestions.classList.add('hidden');
                                    };
                                    locationSuggestions.appendChild(div);
                                });
                                locationSuggestions.classList.remove('hidden');
                            } else {
                                locationSuggestions.classList.add('hidden');
                            }
                        }).catch(err => {
                            locationSuggestions.classList.add('hidden');
                        });
                }, 500); 
            });
            document.addEventListener('click', function(e) {
                if (!locationInput.contains(e.target) && !locationSuggestions.contains(e.target)) {
                    locationSuggestions.classList.add('hidden');
                }
            });

            // MEDIA HANDLING
            const mediaInput = document.getElementById('memoryMediaInput');
            const mediaPreviewContainer = document.getElementById('mediaPreview');
            const liveVideoPreview = document.getElementById('liveVideoPreview');
            const stopRecordingBtn = document.getElementById('stopRecordingBtn');
            const recordAudioBtn = document.getElementById('recordAudioBtn');
            const recordVideoBtn = document.getElementById('recordVideoBtn');
            
            let mediaRecorder;
            let stream;
            const dataTransfer = new DataTransfer();

            function updateFileInput() {
                renderPreviews();
            }

            function addFile(file) {
                dataTransfer.items.add(file);
                updateFileInput();
            }

            function renderPreviews() {
                mediaPreviewContainer.textContent = '';
                Array.from(dataTransfer.files).forEach((file, index) => {
                    const url = URL.createObjectURL(file);
                    const wrapper = document.createElement('div');
                    wrapper.className = 'relative';

                    let el;
                    if (file.type.startsWith('image/')) {
                        el = document.createElement('img');
                        el.src = url;
                        el.className = 'w-full h-24 object-cover rounded-lg';
                    } else if (file.type.startsWith('video/')) {
                        el = document.createElement('video');
                        el.src = url;
                        el.className = 'w-full h-24 object-cover rounded-lg';
                        el.muted = true;
                        el.onmouseenter = () => el.play();
                        el.onmouseleave = () => el.pause();
                    } else if (file.type.startsWith('audio/')) {
                        el = document.createElement('div');
                        el.className = 'w-full h-24 rounded-lg bg-gray-100 flex flex-col items-center justify-center p-2';
                        const icon = document.createElement('i');
                        icon.className = 'fa fa-music text-3xl text-[#8B7EC8]';
                        const nameP = document.createElement('p');
                        nameP.className = 'text-xs text-center truncate w-full mt-2';
                        nameP.textContent = file.name;
                        el.appendChild(icon);
                        el.appendChild(nameP);
                    } else {
                        el = document.createElement('div');
                        el.className = 'w-full h-24 rounded-lg bg-gray-100 flex flex-col items-center justify-center p-2';
                        const icon = document.createElement('i');
                        icon.className = 'fa fa-file-alt text-3xl text-[#8B7EC8]';
                        const nameP = document.createElement('p');
                        nameP.className = 'text-xs text-center truncate w-full mt-2';
                        nameP.textContent = file.name;
                        el.appendChild(icon);
                        el.appendChild(nameP);
                    }
                    wrapper.appendChild(el);

                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.className = 'absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs';
                    const rmIcon = document.createElement('i');
                    rmIcon.className = 'fa fa-times';
                    removeBtn.appendChild(rmIcon);
                    removeBtn.onclick = () => {
                        dataTransfer.items.remove(index);
                        updateFileInput();
                    };
                    wrapper.appendChild(removeBtn);
                    mediaPreviewContainer.appendChild(wrapper);
                });
            }

            mediaInput.addEventListener('change', () => {
                Array.from(mediaInput.files).forEach(file => dataTransfer.items.add(file));
                mediaInput.value = ''; 
                updateFileInput();
            });

            function toggleControls(isRecording) {
                recordAudioBtn.disabled = isRecording;
                recordVideoBtn.disabled = isRecording;
                stopRecordingBtn.disabled = !isRecording;

                if (isRecording && stream && stream.getVideoTracks().length > 0) {
                    liveVideoPreview.classList.remove('hidden');
                    liveVideoPreview.srcObject = stream;
                } else {
                    liveVideoPreview.classList.add('hidden');
                    if (liveVideoPreview.srcObject) {
                        liveVideoPreview.srcObject.getTracks().forEach(track => track.stop());
                    }
                    liveVideoPreview.srcObject = null;
                }
            }

            async function startRecording(type) {
                try {
                    const constraints = type === 'audio' ? { audio: true } : { audio: true, video: true };
                    stream = await navigator.mediaDevices.getUserMedia(constraints);
                    toggleControls(true);
                    
                    const chunks = [];
                    mediaRecorder = new MediaRecorder(stream);
                    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
                    mediaRecorder.onstop = () => {
                        const mime = type === 'audio' ? 'audio/webm' : 'video/webm';
                        const blob = new Blob(chunks, { type: mime });
                        const file = new File([blob], `recording-${Date.now()}.webm`, { type: mime });
                        addFile(file);
                        toggleControls(false);
                    };
                    mediaRecorder.start();
                } catch (err) {
                    alert('Could not start recording: ' + err.message);
                    toggleControls(false);
                }
            }

            stopRecordingBtn.onclick = () => { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); };
            recordAudioBtn.onclick = () => startRecording('audio');
            recordVideoBtn.onclick = () => startRecording('video');

            // SUBMISSION
            const form = document.getElementById('memoryForm');
            const fb = document.getElementById('feedback');
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                fb.className = 'hidden';
                
                const formData = new FormData();
                formData.append('title', document.getElementById('title').value);
                formData.append('date', document.getElementById('date').value);
                formData.append('location', document.getElementById('location').value);
                formData.append('description', document.getElementById('description').value);
                formData.append('tags', document.getElementById('tags').value);
                formData.append('mood', document.getElementById('mood').value);
                
                selectedFriendEmails.forEach(email => {
                    formData.append('selected_friends', email);
                });
                
                Array.from(dataTransfer.files).forEach(file => {
                    formData.append('memory_media[]', file);
                });

                try {
                    const res = await axios.post('/api/memories', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    fb.textContent = '';
                    const msgBox = document.createElement('div');
                    msgBox.className = 'bg-green-100 text-green-700 p-3 rounded';
                    msgBox.textContent = res.data.message || 'Memory created successfully';
                    fb.appendChild(msgBox);
                    fb.className = 'mb-4 block';
                    setTimeout(() => window.location.href="/dashboard.html", 1500);
                } catch(err) {
                    fb.textContent = '';
                    const msgBox = document.createElement('div');
                    msgBox.className = 'bg-red-100 text-red-700 p-3 rounded';
                    msgBox.textContent = err.response?.data?.error || 'Failed';
                    fb.appendChild(msgBox);
                    fb.className = 'mb-4 block';
                }
            });
        });