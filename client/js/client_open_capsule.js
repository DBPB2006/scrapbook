document.addEventListener('DOMContentLoaded', async () => {
            await loadNavbar();
            const urlParams = new URLSearchParams(window.location.search);
            const capsuleId = urlParams.get('id');
            if (!capsuleId) {
                alert('No capsule id provided.');
                window.location.href="/capsules/memory_capsules.html";
                return;
            }

            try {
                const res = await axios.get('/api/capsules/' + encodeURIComponent(capsuleId) + '?t=' + Date.now());
                const { capsule, otherCapsules } = res.data;
                const isUnlocked = capsule.unlocked == 1;

                document.getElementById('loading').classList.add('hidden');
                document.getElementById('mainContent').classList.remove('hidden');

                // Populate side panel details
                document.getElementById('capFrom').textContent = capsule.user_email;
                document.getElementById('capTo').textContent = capsule.recipient_email;
                const sIcon = document.getElementById('statusIcon');
                const sText = document.getElementById('statusText');
                if (isUnlocked) {
                    sIcon.className = 'fas fa-lock-open text-green-500 text-lg mr-4 w-6 text-center';
                    sText.textContent = 'Unlocked';
                    sText.className = 'ml-auto font-semibold text-green-500';
                } else {
                    sIcon.className = 'fas fa-lock text-[#F48498] text-lg mr-4 w-6 text-center';
                    sText.textContent = 'Locked';
                    sText.className = 'ml-auto font-semibold text-[#F48498]';
                }

                // Populate main details
                const rDate = new Date(capsule.reveal_date.replace(' ', 'T') + 'Z');
                const pad = (n) => n.toString().padStart(2, '0');
                const displayReveal = isNaN(rDate.getTime()) ? capsule.reveal_date : `${rDate.getFullYear()}-${pad(rDate.getMonth()+1)}-${pad(rDate.getDate())} ${pad(rDate.getHours())}:${pad(rDate.getMinutes())}:${pad(rDate.getSeconds())}`;
                
                const cDate = new Date(capsule.created_at.replace(' ', 'T') + 'Z');
                const displayCreated = isNaN(cDate.getTime()) ? capsule.created_at : `${cDate.getFullYear()}-${pad(cDate.getMonth()+1)}-${pad(cDate.getDate())} ${pad(cDate.getHours())}:${pad(cDate.getMinutes())}:${pad(cDate.getSeconds())}`;

                document.getElementById('capFrom').textContent = capsule.user_email;
                document.getElementById('capReveals').textContent = displayReveal || '-';
                document.getElementById('capCreated').textContent = displayCreated || '-';

                window.ScrapbookConfig.setTextWithBreaks(document.getElementById('capMessage'), capsule.message || '');
                if (capsule.description) {
                    const dEl = document.getElementById('capDesc');
                    window.ScrapbookConfig.setTextWithBreaks(dEl, capsule.description);
                    dEl.classList.remove('hidden');
                }

                // Populate other capsules
                const ocList = document.getElementById('otherCapsulesList');
                ocList.textContent = '';
                if (otherCapsules && otherCapsules.length > 0) {
                    otherCapsules.forEach(oc => {
                        const ocRDate = new Date(oc.reveal_date.replace(' ', 'T') + 'Z');
                        const ocDisplayReveal = isNaN(ocRDate.getTime()) ? oc.reveal_date : `${ocRDate.getFullYear()}-${pad(ocRDate.getMonth()+1)}-${pad(ocRDate.getDate())} ${pad(ocRDate.getHours())}:${pad(ocRDate.getMinutes())}:${pad(ocRDate.getSeconds())}`;

                        const li = document.createElement('li');
                        li.className = 'mb-3';
                        const link = document.createElement('a');
                        link.href = `/capsules/open_capsule.html?id=${encodeURIComponent(oc.id)}`;
                        link.className = 'block';
                        const box = document.createElement('div');
                        box.className = 'border rounded-lg p-3 bg-white/60 hover:bg-white transition-colors cursor-pointer border-pastel-purple';
                        const recipDiv = document.createElement('div');
                        recipDiv.className = 'font-semibold text-gray-700 text-sm';
                        recipDiv.textContent = `To: ${oc.recipient_email || ''}`;
                        const dateDiv = document.createElement('div');
                        dateDiv.className = 'text-xs text-gray-500';
                        dateDiv.textContent = ocDisplayReveal || '-';
                        box.appendChild(recipDiv);
                        box.appendChild(dateDiv);
                        link.appendChild(box);
                        li.appendChild(link);
                        ocList.appendChild(li);
                    });
                } else {
                    const emptyLi = document.createElement('li');
                    emptyLi.className = 'text-gray-400 text-sm';
                    emptyLi.textContent = 'No other capsules.';
                    ocList.appendChild(emptyLi);
                }

                // Media viewer
                const mContainer = document.getElementById('media-viewer-container');
                mContainer.textContent = '';
                let mediaItems = [];
                if (capsule.media && Array.isArray(capsule.media)) {
                    mediaItems = capsule.media;
                } else if (capsule.media && typeof capsule.media === 'string') {
                    mediaItems = [{ path: capsule.media, type: capsule.media_type || '' }];
                }

                if (isUnlocked) {
                    if (mediaItems.length > 0) {
                        const mediaContentEl = document.createElement('div');
                        mediaContentEl.id = 'media-content';
                        mediaContentEl.className = 'w-full h-full flex items-center justify-center';
                        mContainer.appendChild(mediaContentEl);
                        let currentIndex = 0;

                        function renderMedia(index) {
                            if (!mediaItems[index]) return;
                            const item = mediaItems[index];
                            let mediaType = item.type || '';
                            const src = window.ScrapbookConfig.resolveMediaUrl(item.path);

                            if (!mediaType && typeof item.path === 'string') {
                                const ext = window.ScrapbookConfig.getCleanExtension(item.path);
                                if (['jpg','jpeg','png','gif','webp'].includes(ext)) mediaType = 'image/jpeg';
                                else if (['mp4','webm','mov','ogg'].includes(ext)) mediaType = 'video/mp4';
                                else if (['mp3','wav','ogg','m4a','aac'].includes(ext)) mediaType = 'audio/mp3';
                            }

                            mediaContentEl.textContent = '';
                            let mediaEl;

                            if (mediaType.startsWith('image/') && src) {
                                mediaEl = document.createElement('img');
                                mediaEl.className = 'w-full h-full object-contain';
                                mediaEl.src = src;
                            } else if (mediaType.startsWith('audio/') && src) {
                                mediaEl = document.createElement('audio');
                                mediaEl.className = 'w-3/4';
                                mediaEl.controls = true;
                                mediaEl.src = src;
                            } else if (mediaType.startsWith('video/') && src) {
                                mediaEl = document.createElement('video');
                                mediaEl.className = 'w-full h-full object-contain';
                                mediaEl.controls = true;
                                mediaEl.src = src;
                            } else {
                                mediaEl = document.createElement('div');
                                mediaEl.className = 'text-center text-gray-400 w-full';
                                mediaEl.textContent = `Unsupported media type (${mediaType || 'unknown'})`;
                            }

                            if (mediaEl) {
                                mediaContentEl.appendChild(mediaEl);
                                const dlUrl = window.ScrapbookConfig.resolveMediaUrl(item.download_url || src);
                                if (dlUrl) {
                                    const dlLink = document.createElement('a');
                                    dlLink.href = dlUrl;
                                    dlLink.download = item.name || '';
                                    dlLink.rel = 'noopener noreferrer';
                                    dlLink.className = 'absolute bottom-4 right-4 z-20 bg-[#8B7EC8] text-white px-4 py-2 rounded-lg shadow hover:bg-[#7A6BB5] transition flex items-center gap-2';
                                    const dlIcon = document.createElement('i');
                                    dlIcon.className = 'fas fa-download';
                                    dlLink.appendChild(dlIcon);
                                    dlLink.appendChild(document.createTextNode(' Download Media'));
                                    mediaContentEl.appendChild(dlLink);
                                }
                            }
                        }

                        if (mediaItems.length > 1) {
                            document.getElementById('mediaControls').classList.remove('hidden');
                            document.getElementById('prev-media').onclick = () => {
                                currentIndex = (currentIndex - 1 + mediaItems.length) % mediaItems.length;
                                renderMedia(currentIndex);
                            };
                            document.getElementById('next-media').onclick = () => {
                                currentIndex = (currentIndex + 1) % mediaItems.length;
                                renderMedia(currentIndex);
                            };
                        }

                        renderMedia(0);
                    } else {
                        const emptyMedia = document.createElement('div');
                        emptyMedia.className = 'text-center text-gray-400 w-full';
                        const clipIcon = document.createElement('i');
                        clipIcon.className = 'fas fa-paperclip text-5xl mb-4';
                        const p = document.createElement('p');
                        p.className = 'text-lg font-semibold';
                        p.textContent = 'No attached media';
                        emptyMedia.appendChild(clipIcon);
                        emptyMedia.appendChild(p);
                        mContainer.appendChild(emptyMedia);
                    }
                } else {
                    const lockedBox = document.createElement('div');
                    lockedBox.className = 'text-center text-gray-400 w-full';
                    const lockIcon = document.createElement('i');
                    lockIcon.className = 'fas fa-lock text-5xl mb-4';
                    const p = document.createElement('p');
                    p.className = 'text-lg font-semibold';
                    p.textContent = 'Content is Locked';
                    lockedBox.appendChild(lockIcon);
                    lockedBox.appendChild(p);
                    mContainer.appendChild(lockedBox);
                }

            } catch(e) {
                console.error(e);
                alert('Failed to load capsule.');
            }
        });