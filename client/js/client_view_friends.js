document.addEventListener('DOMContentLoaded', async function() {
    await loadNavbar();

    async function loadPendingRequests() {
        try {
            // 1. Incoming requests
            const incRes = await axios.get('/api/friends/requests/incoming');
            const incoming = incRes.data || [];
            const incContainer = document.getElementById('incomingRequestsContainer');
            const incList = document.getElementById('incomingRequestsList');
            const incBadge = document.getElementById('incomingCountBadge');

            if (incoming.length > 0) {
                incContainer.classList.remove('hidden');
                incBadge.textContent = incoming.length;
                let incHtml = '';
                incoming.forEach(req => {
                    const fromName = req.from_name || req.from;
                    let imgSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(fromName)}&background=A8C8EC&color=fff`;
                    const rawReqImg = req.from_profile_pic || req.image_url;
                    if (rawReqImg) {
                        const resolved = window.MemoryBookConfig ? window.MemoryBookConfig.resolveMediaUrl(rawReqImg) : rawReqImg;
                        if (resolved) imgSrc = resolved;
                    }

                    incHtml += `
                    <div class="bg-white rounded-2xl p-5 shadow-sm border-2 border-[#E8E3F5] flex flex-col justify-between">
                        <div class="flex items-center space-x-3 mb-3">
                            <img src="${imgSrc}" alt="${fromName}" class="w-12 h-12 rounded-full object-cover border-2 border-[#8B7EC8]" />
                            <div class="flex-1 min-w-0">
                                <h4 class="font-bold text-[#2D2A3D] text-base truncate">${fromName}</h4>
                                <p class="text-xs text-[#6B6B7D] truncate">${req.from}</p>
                                ${req.relationship_type ? `<span class="inline-block bg-[#E8E3F5] text-[#6958A2] px-2 py-0.5 rounded-full text-xs font-medium mt-1">${req.relationship_type}</span>` : ''}
                            </div>
                        </div>
                        ${req.how_you_met ? `<p class="text-xs text-gray-500 italic mb-3">"${req.how_you_met}"</p>` : ''}
                        <div class="flex gap-2 mt-2">
                            <button onclick="acceptRequest('${req.id}', '${fromName.replace(/'/g, "\\'")}')" class="flex-1 bg-[#8B7EC8] text-white py-2 px-3 rounded-xl hover:bg-[#7A6BB5] transition text-xs font-bold flex items-center justify-center gap-1">
                                <i class="fas fa-check"></i> Accept
                            </button>
                            <button onclick="declineRequest('${req.id}')" class="flex-1 bg-gray-100 text-gray-600 py-2 px-3 rounded-xl hover:bg-gray-200 transition text-xs font-bold flex items-center justify-center gap-1">
                                <i class="fas fa-times"></i> Decline
                            </button>
                        </div>
                    </div>`;
                });
                incList.innerHTML = incHtml;
            } else {
                incContainer.classList.add('hidden');
            }

            // 2. Outgoing requests
            const outRes = await axios.get('/api/friends/requests/outgoing');
            const outgoing = outRes.data || [];
            const outContainer = document.getElementById('outgoingRequestsContainer');
            const outList = document.getElementById('outgoingRequestsList');

            if (outgoing.length > 0) {
                outContainer.classList.remove('hidden');
                let outHtml = '';
                outgoing.forEach(req => {
                    const toName = req.to_name || req.to;
                    outHtml += `
                    <div class="inline-flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-gray-200 text-xs shadow-sm">
                        <span class="text-gray-700 font-medium">To: ${toName}</span>
                        <span class="text-[#F48498] font-bold">(Pending)</span>
                        <button onclick="cancelRequest('${req.id}')" class="text-gray-400 hover:text-red-500 ml-1" title="Cancel request">
                            <i class="fas fa-times-circle"></i>
                        </button>
                    </div>`;
                });
                outList.innerHTML = outHtml;
            } else {
                outContainer.classList.add('hidden');
            }
        } catch (err) {
            console.error('Failed to load pending requests:', err);
        }
    }

    async function loadFriends() {
        try {
            const res = await axios.get('/api/friends');
            const friends = res.data;
            document.getElementById('loading').classList.add('hidden');
            
            const grid = document.getElementById('friendsGrid');
            const empty = document.getElementById('noFriends');
            
            if (friends.length === 0) {
                empty.classList.remove('hidden');
                grid.classList.add('hidden');
            } else {
                empty.classList.add('hidden');
                grid.classList.remove('hidden');
                let html = '';
                
                friends.forEach(f => {
                    const safeName = f.name || f.username || 'Friend';
                    let imgSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}`;
                    if (f.image_url) {
                        const resolved = window.MemoryBookConfig ? window.MemoryBookConfig.resolveMediaUrl(f.image_url) : f.image_url;
                        if (resolved) imgSrc = resolved;
                    }
                    
                    const fId = f.friend_id || f.id || f.email;
                    const escapedName = safeName.replace(/'/g, "\\'");
                    
                    html += `
                    <div class="bg-white rounded-2xl p-6 shadow transition hover:scale-105 group relative">
                        <button onclick="deleteFriend('${fId}', '${escapedName}')" class="absolute top-2 right-2 w-8 h-8 bg-[#E88B8B] text-white rounded-full hover:bg-[#E47777] flex items-center justify-center">
                            <i class="fas fa-trash text-sm"></i>
                        </button>
                        <div class="text-center">
                            <div class="relative mb-4">
                                <img src="${imgSrc}" alt="${safeName}" class="w-20 h-20 rounded-full object-cover mx-auto border-4 border-[#E8E3F5] group-hover:border-[#D1C7EB] transition" loading="lazy" />
                            </div>
                            <h3 class="font-semibold text-[#2D2A3D] mb-1">${safeName}</h3>
                            <span class="inline-block bg-[#E8E3F5] text-[#6958A2] px-3 py-1 rounded-full text-sm font-medium mb-3">
                                ${f.relationship_type || 'Friend'}
                            </span>
                            <div class="flex items-center justify-center space-x-1 mb-4">
                                <i class="fas fa-star text-[#F4A6A6] text-sm"></i>
                                <span class="text-sm text-[#6B6B7D]">
                                    ${f.memoryCount || 0} memories
                                </span>
                            </div>
                            <a href="/friends/friendship_map_of_memories.html?friend_id=${encodeURIComponent(fId)}" class="w-full bg-[#8B7EC8] text-white py-2 px-4 rounded-lg hover:bg-[#7A6BB5] transition font-medium text-sm">View Friendship Map</a>
                        </div>
                    </div>`;
                });
                grid.innerHTML = html;
            }
        } catch (err) {
            console.error(err);
            document.getElementById('loading').textContent = 'Failed to load friends.';
        }
    }
    
    window.acceptRequest = async function(id, name) {
        try {
            await axios.post(`/api/friends/requests/${id}/accept`);
            alert(`You and ${name} are now friends!`);
            loadPendingRequests();
            loadFriends();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to accept request');
        }
    };

    window.declineRequest = async function(id) {
        if (confirm('Decline this friend request?')) {
            try {
                await axios.post(`/api/friends/requests/${id}/decline`);
                loadPendingRequests();
            } catch (err) {
                alert(err.response?.data?.error || 'Failed to decline request');
            }
        }
    };

    window.cancelRequest = async function(id) {
        if (confirm('Cancel this pending friend request?')) {
            try {
                await axios.delete(`/api/friends/requests/${id}`);
                loadPendingRequests();
            } catch (err) {
                alert(err.response?.data?.error || 'Failed to cancel request');
            }
        }
    };

    window.deleteFriend = async function(id, name) {
        if (confirm(`Are you sure you want to remove ${name} from your friends list? This action cannot be undone.`)) {
            try {
                await axios.delete('/api/friends/' + id);
                loadFriends();
            } catch(err) {
                alert('Failed to delete friend');
            }
        }
    };
    
    loadPendingRequests();
    loadFriends();
});