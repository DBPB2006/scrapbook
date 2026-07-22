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
                const res = await axios.get('/api/capsules/' + capsuleId);
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
                
                document.getElementById('capMessage').innerHTML = (capsule.message || '').replace(/\n/g, '<br/>');
                if (capsule.description) {
                    const dEl = document.getElementById('capDesc');
                    dEl.innerHTML = capsule.description.replace(/\n/g, '<br/>');
                    dEl.classList.remove('hidden');
                }

                // Populate other capsules
                const ocList = document.getElementById('otherCapsulesList');
                if (otherCapsules && otherCapsules.length > 0) {
                    let ocHtml = '';
                    otherCapsules.forEach(oc => {
                        const ocRDate = new Date(oc.reveal_date.replace(' ', 'T') + 'Z');
                        const ocDisplayReveal = isNaN(ocRDate.getTime()) ? oc.reveal_date : `${ocRDate.getFullYear()}-${pad(ocRDate.getMonth()+1)}-${pad(ocRDate.getDate())} ${pad(ocRDate.getHours())}:${pad(ocRDate.getMinutes())}:${pad(ocRDate.getSeconds())}`;

                        ocHtml += `
                        <li class="mb-3">
                            <a href="/capsules/open_capsule.html?id=${encodeURIComponent(oc.id)}" class="block">
                                <div class="border rounded-lg p-3 bg-white/60 hover:bg-white transition-colors cursor-pointer border-pastel-purple">
                                    <div class="font-semibold text-gray-700 text-sm">To: ${oc.recipient_email}</div>
                                    <div class="text-xs text-gray-500"> ${ocDisplayReveal || '-'} </div>
                                </div>
                            </a>
                        </li>`;
                    });
                    ocList.innerHTML = ocHtml;
                } else {
                    ocList.innerHTML = '<li class="text-gray-400 text-sm">No other capsules.</li>';
                }

                // Media viewer
                const mContainer = document.getElementById('media-viewer-container');
                let mediaItems = [];
                if (capsule.media && Array.isArray(capsule.media)) {
                    mediaItems = capsule.media;
                } else if (capsule.media && typeof capsule.media === 'string') {
                    mediaItems = [{ path: capsule.media, type: capsule.media_type || '' }];
                }

                if (isUnlocked) {
                    if (mediaItems.length > 0) {
                        mContainer.innerHTML = '<div id="media-content" class="w-full h-full flex items-center justify-center"></div>';
                        const mediaContentEl = document.getElementById('media-content');
                        let currentIndex = 0;

                        function renderMedia(index) {
                            if (!mediaItems[index]) return;
                            const item = mediaItems[index];
                            const mediaType = item.type || '';
                            const src = item.path.startsWith('data:') ? item.path : `/${item.path}`;
                            
                            mediaContentEl.innerHTML = '';
                            let mediaEl;
                            
                            if (mediaType.startsWith('image/')) {
                                mediaEl = document.createElement('img');
                                mediaEl.className = 'w-full h-full object-contain';
                                mediaEl.src = src;
                            } else if (mediaType.startsWith('audio/')) {
                                mediaEl = document.createElement('audio');
                                mediaEl.className = 'w-3/4';
                                mediaEl.controls = true;
                                mediaEl.src = src;
                            } else if (mediaType.startsWith('video/')) {
                                mediaEl = document.createElement('video');
                                mediaEl.className = 'w-full h-full object-contain';
                                mediaEl.controls = true;
                                mediaEl.src = src;
                            } else {
                                mediaEl = document.createElement('div');
                                mediaEl.className = 'text-center text-gray-400 w-full';
                                mediaEl.innerHTML = `Unsupported media type (${mediaType})`;
                            }

                            if (mediaEl) {
                                mediaContentEl.appendChild(mediaEl);
                                // Add download link
                                const dlLink = document.createElement('a');
                                dlLink.href = src;
                                dlLink.download = '';
                                dlLink.className = 'absolute bottom-4 right-4 z-20 bg-[#8B7EC8] text-white px-4 py-2 rounded-lg shadow hover:bg-[#7A6BB5] transition flex items-center gap-2';
                                dlLink.innerHTML = `<i class="fas fa-download"></i> Download Media`;
                                mediaContentEl.appendChild(dlLink);
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
                        mContainer.innerHTML = `
                            <div class="text-center text-gray-400 w-full">
                                <i class="fas fa-paperclip text-5xl mb-4"></i>
                                <p class="text-lg font-semibold">No attached media</p>
                            </div>`;
                    }
                } else {
                    mContainer.innerHTML = `
                        <div class="text-center text-gray-400 w-full">
                            <i class="fas fa-lock text-5xl mb-4"></i>
                            <p class="text-lg font-semibold">Content is Locked</p>
                        </div>`;
                }

            } catch(e) {
                console.error(e);
                alert('Failed to load capsule.');
            }
        });