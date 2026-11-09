document.addEventListener('DOMContentLoaded', async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const memoryId = urlParams.get('id');
            let currentOrder = (urlParams.get('order') || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
            if (!memoryId) {
                alert('Memory ID is missing');
                window.location.href="/dashboard.html";
                return;
            }

            const orderLabel = document.getElementById('orderLabel');
            if (orderLabel) {
                orderLabel.textContent = currentOrder === 'desc' ? 'Newest' : 'Oldest';
            }
            const orderToggleBtn = document.getElementById('orderToggleBtn');
            if (orderToggleBtn) {
                orderToggleBtn.addEventListener('click', () => {
                    const nextOrder = currentOrder === 'desc' ? 'asc' : 'desc';
                    window.location.href = `/memories/memory_details.html?id=${encodeURIComponent(memoryId)}&order=${nextOrder}`;
                });
            }

            let currentSlide = 0;
            let slidesCount = 0;

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

            async function loadMemoryDetails() {
                try {
                    const res = await axios.get(`/api/memories/${encodeURIComponent(memoryId)}?order=${currentOrder}`);
                    const data = res.data;
                    const mem = data.memory;
                    
                    document.getElementById('loading').classList.add('hidden');
                    document.getElementById('contentWrapper').classList.remove('hidden');

                    // Populate side timeline
                    const timeline = document.getElementById('timelineContainer');
                    timeline.textContent = '';
                    const colors = ['#2563eb', '#14b8a6', '#f59e42', '#ec4899', '#22c55e', '#eab308', '#ef4444'];
                    (data.allUserMemories || []).forEach((m, idx) => {
                        const isActive = m.id === memoryId;
                        const isNavigable = m.id === data.prevMemoryId || m.id === data.nextMemoryId;
                        const color = colors[idx % colors.length];
                        const initials = (m.title || 'M').split(/\s+/).map(w=>w[0]).join('').substring(0,2).toUpperCase();
                        
                        let style = 'background: #A8C8EC; color: #fff; border: 4px solid #A8C8EC;';
                        let classes = 'flex items-center justify-center w-16 h-16 rounded-full font-bold text-lg transition-all duration-200';
                        
                        if (isActive) {
                            style = `background: ${color}; color: #fff; border: 4px solid #A8C8EC; pointer-events: none; box-shadow: 0 0 0 4px #fff, 0 4px 16px rgba(139,126,200,0.12);`;
                        } else if (isNavigable) {
                            classes += ' hover:scale-105 cursor-pointer';
                        } else {
                            classes += ' opacity-40 pointer-events-none cursor-default';
                        }

                        const a = document.createElement('a');
                        a.href = isNavigable ? `/memories/memory_details.html?id=${encodeURIComponent(m.id)}&order=${currentOrder}` : '#';
                        a.className = classes;
                        a.setAttribute('style', style);
                        a.title = m.title || '';
                        a.textContent = initials;
                        timeline.appendChild(a);
                    });

                    const prevLink = document.getElementById('prevLink');
                    if (data.prevMemoryId) {
                        prevLink.href = `/memories/memory_details.html?id=${encodeURIComponent(data.prevMemoryId)}&order=${currentOrder}`;
                        prevLink.classList.remove('opacity-40', 'pointer-events-none');
                    } else {
                        prevLink.href = '#';
                        prevLink.classList.add('opacity-40', 'pointer-events-none');
                    }

                    const nextLink = document.getElementById('nextLink');
                    if (data.nextMemoryId) {
                        nextLink.href = `/memories/memory_details.html?id=${encodeURIComponent(data.nextMemoryId)}&order=${currentOrder}`;
                        nextLink.classList.remove('opacity-40', 'pointer-events-none');
                    } else {
                        nextLink.href = '#';
                        nextLink.classList.add('opacity-40', 'pointer-events-none');
                    }

                    // Populate details
                    document.title = (mem.title || 'Memory') + ' - MemoryBook';
                    document.getElementById('memTitle').textContent = mem.title;
                    document.getElementById('memDate').querySelector('span').textContent = mem.date;
                    if (mem.mood) {
                        document.getElementById('memMood').classList.remove('hidden');
                        document.getElementById('memMood').querySelector('span').textContent = mem.mood;
                    } else {
                        document.getElementById('memMood').classList.add('hidden');
                    }
                    if (mem.location) {
                        document.getElementById('memLocation').classList.remove('hidden');
                        const link = document.getElementById('memLocation').querySelector('a');
                        link.href = 'https://www.google.com/maps/search/' + encodeURIComponent(mem.location);
                        link.textContent = mem.location;
                    } else {
                        document.getElementById('memLocation').classList.add('hidden');
                    }
                    window.MemoryBookConfig.setTextWithBreaks(document.getElementById('memDesc'), mem.description || '');

                    const memTagsEl = document.getElementById('memTags');
                    memTagsEl.textContent = '';
                    if (mem.tags) {
                        const tagsArr = typeof mem.tags === 'string' ? mem.tags.split(',') : mem.tags;
                        if (tagsArr.length > 0) {
                            memTagsEl.classList.remove('hidden');
                            tagsArr.forEach(t => {
                                const tagSpan = document.createElement('span');
                                tagSpan.className = 'inline-block px-3 py-1 rounded-full bg-[#A8C8EC] text-white text-xs font-medium';
                                tagSpan.textContent = `#${String(t).trim()}`;
                                memTagsEl.appendChild(tagSpan);
                            });
                        } else {
                            memTagsEl.classList.add('hidden');
                        }
                    } else {
                        memTagsEl.classList.add('hidden');
                    }

                    // Friends
                    if (mem.friends && mem.friends.length > 0) {
                        const fNames = mem.friends.map(fid => {
                            const u = data.usersData && data.usersData[fid.charAt(0).toUpperCase()] && data.usersData[fid.charAt(0).toUpperCase()][fid];
                            return u ? (u.first_name || u.username || fid) : fid;
                        });
                        document.getElementById('memFriends').textContent = fNames.join(', ');
                    } else {
                        document.getElementById('memFriends').textContent = 'No friends included';
                    }

                    // Media Gallery
                    const gallery = document.getElementById('mediaGallery');
                    gallery.textContent = '';
                    if (mem.media && mem.media.length > 0) {
                        slidesCount = mem.media.length;
                        currentSlide = 0;
                        (mem.media || []).forEach((file, idx) => {
                            const slideDiv = document.createElement('div');
                            slideDiv.className = 'media-slide w-full flex flex-col items-center';
                            if (idx !== 0) slideDiv.style.display = 'none';

                            const rawUrl = typeof file === 'string' ? file : (file.url || '');
                            const fUrl = window.MemoryBookConfig.resolveMediaUrl(rawUrl);
                            const ext = window.MemoryBookConfig.getCleanExtension(fUrl);
                            let fType = '';
                            if (typeof file === 'object' && file.type) {
                                fType = file.type;
                            }
                            if (!fType) {
                                if (['mp4','webm','ogg','mov'].includes(ext)) fType = 'video/mp4';
                                else if (['mp3','wav','ogg','aac'].includes(ext)) fType = 'audio/mpeg';
                                else fType = 'image/jpeg';
                            }

                            if (fType.startsWith('image/') && fUrl) {
                                const imgEl = document.createElement('img');
                                imgEl.src = fUrl;
                                imgEl.className = 'gallery-img w-full max-w-lg h-auto max-h-[400px] object-contain rounded-xl shadow border-2 border-[#8B7EC8] bg-white mb-2';
                                slideDiv.appendChild(imgEl);
                            } else if (fType.startsWith('video/') && fUrl) {
                                const vidEl = document.createElement('video');
                                vidEl.src = fUrl;
                                vidEl.controls = true;
                                vidEl.className = 'w-full max-w-lg h-auto max-h-[400px] rounded-xl shadow border-2 border-[#8B7EC8] bg-black mb-2';
                                vidEl.setAttribute('type', fType);
                                slideDiv.appendChild(vidEl);
                            } else if (fType.startsWith('audio/') && fUrl) {
                                const audEl = document.createElement('audio');
                                audEl.src = fUrl;
                                audEl.controls = true;
                                audEl.className = 'w-full max-w-lg mb-2';
                                audEl.setAttribute('type', fType);
                                slideDiv.appendChild(audEl);
                            } else {
                                const fileName = typeof file === 'string' ? file.split('?')[0].split('/').pop() : (file.name || 'File');
                                const box = document.createElement('div');
                                box.className = 'w-full flex flex-col items-center justify-center h-32 bg-[#F5F3FB] rounded-xl border border-[#E8E3F5] mb-2';
                                const icon = document.createElement('i');
                                icon.className = 'fa fa-file-alt text-4xl text-[#8B7EC8]';
                                const span = document.createElement('span');
                                span.className = 'ml-2 text-sm';
                                span.textContent = fileName;
                                box.appendChild(icon);
                                box.appendChild(span);
                                slideDiv.appendChild(box);
                            }

                            const rawDlUrl = (typeof file === 'object' && file.download_url) ? window.MemoryBookConfig.resolveMediaUrl(file.download_url) : fUrl;
                            const dlName = (typeof file === 'object' && (file.name || file.fileName)) || (typeof file === 'string' ? file.split('?')[0].split('/').pop() : 'download');
                            if (rawDlUrl) {
                                const dlLink = document.createElement('a');
                                dlLink.href = rawDlUrl;
                                dlLink.download = dlName;
                                dlLink.rel = 'noopener noreferrer';
                                dlLink.className = 'inline-flex px-3 py-1 bg-[#8B7EC8] text-white rounded-md text-xs font-semibold hover:bg-[#6BCB77] transition items-center gap-2';
                                const dlIcon = document.createElement('i');
                                dlIcon.className = 'fa fa-download';
                                dlLink.appendChild(dlIcon);
                                dlLink.appendChild(document.createTextNode(' Download'));
                                slideDiv.appendChild(dlLink);
                            }

                            gallery.appendChild(slideDiv);
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
                        } else {
                            document.getElementById('galleryControls').classList.add('hidden');
                        }
                    } else {
                        const emptyGallery = document.createElement('div');
                        emptyGallery.className = 'text-center text-gray-400';
                        emptyGallery.textContent = 'No media files.';
                        gallery.appendChild(emptyGallery);
                        document.getElementById('galleryControls').classList.add('hidden');
                    }

                    // Extra details
                    const extraContainer = document.getElementById('extraDetails');
                    extraContainer.textContent = '';
                    const skips = ['memory_id', 'id', 'owner', 'media', 'friends', 'title', 'date', 'location', 'description', 'tags', 'mood'];
                    for (const [key, val] of Object.entries(mem)) {
                        if (skips.includes(key)) continue;
                        const disp = Array.isArray(val) ? val.join(', ') : (val === '' || val == null ? '—' : String(val));
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
                    }

                    // Configure Edit Modal with current data
                    setupEditModal(mem);

                } catch(e) {
                    console.error(e);
                    alert('Failed to load memory');
                }
            }

            function setupEditModal(mem) {
                const editModal = document.getElementById('editModal');
                const editBtn = document.getElementById('editBtn');
                const closeEditModal = document.getElementById('closeEditModal');
                const cancelEditBtn = document.getElementById('cancelEditBtn');
                const editForm = document.getElementById('editMemoryForm');
                const editFeedback = document.getElementById('editFeedback');
                const saveEditBtn = document.getElementById('saveEditBtn');
                const saveEditText = document.getElementById('saveEditText');
                const saveEditSpinner = document.getElementById('saveEditSpinner');

                if (!editBtn || !editModal) return;

                const openModal = () => {
                    document.getElementById('editTitle').value = mem.title || '';
                    document.getElementById('editDate').value = mem.date || '';
                    document.getElementById('editMood').value = mem.mood || '';
                    document.getElementById('editLocation').value = mem.location || '';
                    document.getElementById('editTags').value = mem.tags || '';
                    document.getElementById('editDescription').value = mem.description || '';
                    document.getElementById('editMediaInput').value = '';
                    editFeedback.className = 'hidden';
                    editModal.classList.remove('hidden');
                };

                const closeModal = () => {
                    editModal.classList.add('hidden');
                };

                editBtn.onclick = openModal;
                closeEditModal.onclick = closeModal;
                cancelEditBtn.onclick = closeModal;

                editModal.onclick = (e) => {
                    if (e.target === editModal) closeModal();
                };

                editForm.onsubmit = async (e) => {
                    e.preventDefault();
                    saveEditBtn.disabled = true;
                    saveEditText.textContent = 'Saving...';
                    saveEditSpinner.classList.remove('hidden');
                    editFeedback.className = 'hidden';

                    const formData = new FormData();
                    formData.append('title', document.getElementById('editTitle').value.trim());
                    formData.append('date', document.getElementById('editDate').value.trim());
                    formData.append('mood', document.getElementById('editMood').value);
                    formData.append('location', document.getElementById('editLocation').value.trim());
                    formData.append('tags', document.getElementById('editTags').value.trim());
                    formData.append('description', document.getElementById('editDescription').value.trim());

                    const mediaFiles = document.getElementById('editMediaInput').files;
                    for (let i = 0; i < mediaFiles.length; i++) {
                        formData.append('memory_media[]', mediaFiles[i]);
                    }

                    try {
                        const res = await axios.put(`/api/memories/${encodeURIComponent(memoryId)}`, formData, {
                            headers: { 'Content-Type': 'multipart/form-data' }
                        });
                        if (res.data.success) {
                            editFeedback.className = 'p-3 rounded-xl text-sm bg-green-100 text-green-700 block';
                            editFeedback.textContent = 'Memory updated successfully!';
                            setTimeout(() => {
                                closeModal();
                                loadMemoryDetails();
                            }, 800);
                        }
                    } catch (err) {
                        const errMsg = err.response?.data?.error || 'Failed to update memory';
                        editFeedback.className = 'p-3 rounded-xl text-sm bg-red-100 text-red-700 block';
                        editFeedback.textContent = errMsg;
                    } finally {
                        saveEditBtn.disabled = false;
                        saveEditText.textContent = 'Save Changes';
                        saveEditSpinner.classList.add('hidden');
                    }
                };
            }

            // Delete btn
            document.getElementById('deleteBtn').addEventListener('click', async () => {
                if (confirm('Are you sure you want to delete this memory? This cannot be undone.')) {
                    try {
                        const delRes = await axios.delete('/api/memories/' + encodeURIComponent(memoryId));
                        if (delRes.data.redirectId) {
                            window.location.href = `/memories/memory_details.html?id=${encodeURIComponent(delRes.data.redirectId)}&order=${currentOrder}`;
                        } else {
                            window.location.href = "/dashboard.html";
                        }
                    } catch(err) {
                        alert('Delete failed');
                    }
                }
            });

            loadMemoryDetails();
        });