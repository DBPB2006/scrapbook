document.addEventListener('DOMContentLoaded', async () => {
            await loadNavbar();

            let selectedFriendEmails = new Set();
            try {
                const res = await axios.get('/api/current_user');
                const user = res.data;
                const flist = document.getElementById('availableFriendsList');
                if (user.friends && user.friends.length > 0) {
                    let fHtml = '';
                    user.friends.forEach(f => {
                        const em = f.email || f.friend_id;
                        fHtml += `<label class="flex items-center gap-2 mb-2">
                            <input type="checkbox" name="friend_check" value="${em}" data-name="${f.name}" />
                            <span>${f.name} (${em})</span>
                        </label>`;
                    });
                    flist.innerHTML = fHtml;

                    flist.querySelectorAll('input[type=checkbox]').forEach(cb => {
                        cb.addEventListener('change', function() {
                            if (this.checked) selectedFriendEmails.add(this.value);
                            else selectedFriendEmails.delete(this.value);
                        });
                    });
                } else {
                    flist.innerHTML = '<span class="text-sm text-gray-500 block mb-3">No friends added yet.</span><a href="/friends/add_friend.html" class="text-[#8B7EC8] font-medium hover:underline inline-flex items-center text-sm"><i class="fas fa-user-plus mr-2"></i>Add a friend</a>';
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
                        u.name.toLowerCase().includes(query) || 
                        u.email.toLowerCase().includes(query)
                    );

                    matches.forEach(user => {
                        const div = document.createElement('div');
                        div.className = 'px-4 py-2 hover:bg-[#F5F3FB] cursor-pointer text-sm text-[#2D2A3D] border-b border-[#E8E3F5] last:border-0';
                        div.textContent = `${user.name} (${user.email})`;
                        div.onclick = () => {
                            if (!selectedFriendEmails.has(user.email)) {
                                selectedFriendEmails.add(user.email);
                                
                                const badge = document.createElement('div');
                                badge.className = 'inline-flex items-center bg-[#8B7EC8] text-white px-3 py-1 rounded-full mr-2 mb-2 text-sm';
                                badge.innerHTML = `
                                    ${user.name} 
                                    <button type="button" class="ml-2 hover:text-[#2D2A3D]"><i class="fas fa-times"></i></button>
                                `;
                                badge.querySelector('button').onclick = function() {
                                    badge.remove();
                                    selectedFriendEmails.delete(user.email);
                                    // Uncheck if it was in the checkbox list
                                    const cb = document.querySelector(`#availableFriendsList input[value='${user.email}']`);
                                    if (cb) cb.checked = false;
                                };
                                selectedFriends.appendChild(badge);
                                
                                // Check if it was in the checkbox list
                                const cb = document.querySelector(`#availableFriendsList input[value='${user.email}']`);
                                if (cb) cb.checked = true;
                            }
                            userSearchInput.value = '';
                            userSuggestions.innerHTML = '';
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
            const LOCATIONIQ_API_KEY = "pk.235663a366caa807557a9a233647f569";
            let locationTimeout = null;

            locationInput.addEventListener('input', function() {
                const query = this.value.trim();
                locationSuggestions.innerHTML = '';
                if (query.length < 3) {
                    locationSuggestions.classList.add('hidden');
                    return;
                }
                clearTimeout(locationTimeout);
                locationTimeout = setTimeout(() => {
                    fetch(`https://us1.locationiq.com/v1/autocomplete?key=${LOCATIONIQ_API_KEY}&q=${encodeURIComponent(query)}&limit=5&format=json`)
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
                mediaPreviewContainer.innerHTML = '';
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
                        el.innerHTML = `<i class="fa fa-music text-3xl text-[#8B7EC8]"></i><p class="text-xs text-center truncate w-full mt-2">${file.name}</p>`;
                    } else {
                        el = document.createElement('div');
                        el.className = 'w-full h-24 rounded-lg bg-gray-100 flex flex-col items-center justify-center p-2';
                        el.innerHTML = `<i class="fa fa-file-alt text-3xl text-[#8B7EC8]"></i><p class="text-xs text-center truncate w-full mt-2">${file.name}</p>`;
                    }
                    wrapper.appendChild(el);

                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.className = 'absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs';
                    removeBtn.innerHTML = '<i class="fa fa-times"></i>';
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
                    fb.innerHTML = `<div class="bg-green-100 text-green-700 p-3 rounded">${res.data.message}</div>`;
                    fb.className = 'mb-4 block';
                    setTimeout(() => window.location.href="/dashboard.html", 1500);
                } catch(err) {
                    fb.innerHTML = `<div class="bg-red-100 text-red-700 p-3 rounded">${err.response?.data?.error || 'Failed'}</div>`;
                    fb.className = 'mb-4 block';
                }
            });
        });