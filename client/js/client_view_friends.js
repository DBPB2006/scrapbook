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

            incList.textContent = '';
            if (incoming.length > 0) {
                incContainer.classList.remove('hidden');
                incBadge.textContent = incoming.length;
                incoming.forEach(req => {
                    const fromName = req.from_name || req.from || '';
                    let imgSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(fromName)}&background=A8C8EC&color=fff`;
                    const rawReqImg = req.from_profile_pic || req.image_url;
                    if (rawReqImg) {
                        const resolved = window.ScrapbookConfig.resolveMediaUrl(rawReqImg);
                        if (resolved) imgSrc = resolved;
                    }

                    const card = document.createElement('div');
                    card.className = 'bg-white rounded-2xl p-5 shadow-sm border-2 border-[#E8E3F5] flex flex-col justify-between';

                    const topRow = document.createElement('div');
                    topRow.className = 'flex items-center space-x-3 mb-3';

                    const img = document.createElement('img');
                    img.src = imgSrc;
                    img.alt = fromName;
                    img.className = 'w-12 h-12 rounded-full object-cover border-2 border-[#8B7EC8]';

                    const metaDiv = document.createElement('div');
                    metaDiv.className = 'flex-1 min-w-0';

                    const h4 = document.createElement('h4');
                    h4.className = 'font-bold text-[#2D2A3D] text-base truncate';
                    h4.textContent = fromName;

                    const emailP = document.createElement('p');
                    emailP.className = 'text-xs text-[#6B6B7D] truncate';
                    emailP.textContent = req.from || '';

                    metaDiv.appendChild(h4);
                    metaDiv.appendChild(emailP);

                    if (req.relationship_type) {
                        const relBadge = document.createElement('span');
                        relBadge.className = 'inline-block bg-[#E8E3F5] text-[#6958A2] px-2 py-0.5 rounded-full text-xs font-medium mt-1';
                        relBadge.textContent = req.relationship_type;
                        metaDiv.appendChild(relBadge);
                    }

                    topRow.appendChild(img);
                    topRow.appendChild(metaDiv);
                    card.appendChild(topRow);

                    if (req.how_you_met) {
                        const howP = document.createElement('p');
                        howP.className = 'text-xs text-gray-500 italic mb-3';
                        howP.textContent = `"${req.how_you_met}"`;
                        card.appendChild(howP);
                    }

                    const btnRow = document.createElement('div');
                    btnRow.className = 'flex gap-2 mt-2';

                    const acceptBtn = document.createElement('button');
                    acceptBtn.type = 'button';
                    acceptBtn.className = 'flex-1 bg-[#8B7EC8] text-white py-2 px-3 rounded-xl hover:bg-[#7A6BB5] transition text-xs font-bold flex items-center justify-center gap-1';
                    const checkIcon = document.createElement('i');
                    checkIcon.className = 'fas fa-check';
                    acceptBtn.appendChild(checkIcon);
                    acceptBtn.appendChild(document.createTextNode(' Accept'));
                    acceptBtn.addEventListener('click', () => window.acceptRequest(req.id, fromName));

                    const declineBtn = document.createElement('button');
                    declineBtn.type = 'button';
                    declineBtn.className = 'flex-1 bg-gray-100 text-gray-600 py-2 px-3 rounded-xl hover:bg-gray-200 transition text-xs font-bold flex items-center justify-center gap-1';
                    const timesIcon = document.createElement('i');
                    timesIcon.className = 'fas fa-times';
                    declineBtn.appendChild(timesIcon);
                    declineBtn.appendChild(document.createTextNode(' Decline'));
                    declineBtn.addEventListener('click', () => window.declineRequest(req.id));

                    btnRow.appendChild(acceptBtn);
                    btnRow.appendChild(declineBtn);
                    card.appendChild(btnRow);
                    incList.appendChild(card);
                });
            } else {
                incContainer.classList.add('hidden');
            }

            // 2. Outgoing requests
            const outRes = await axios.get('/api/friends/requests/outgoing');
            const outgoing = outRes.data || [];
            const outContainer = document.getElementById('outgoingRequestsContainer');
            const outList = document.getElementById('outgoingRequestsList');

            outList.textContent = '';
            if (outgoing.length > 0) {
                outContainer.classList.remove('hidden');
                outgoing.forEach(req => {
                    const toName = req.to_name || req.to || '';
                    const pill = document.createElement('div');
                    pill.className = 'inline-flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-gray-200 text-xs shadow-sm';

                    const toSpan = document.createElement('span');
                    toSpan.className = 'text-gray-700 font-medium';
                    toSpan.textContent = `To: ${toName}`;

                    const statusSpan = document.createElement('span');
                    statusSpan.className = 'text-[#F48498] font-bold';
                    statusSpan.textContent = '(Pending)';

                    const cancelBtn = document.createElement('button');
                    cancelBtn.type = 'button';
                    cancelBtn.className = 'text-gray-400 hover:text-red-500 ml-1';
                    cancelBtn.title = 'Cancel request';
                    const cancelIcon = document.createElement('i');
                    cancelIcon.className = 'fas fa-times-circle';
                    cancelBtn.appendChild(cancelIcon);
                    cancelBtn.addEventListener('click', () => window.cancelRequest(req.id));

                    pill.appendChild(toSpan);
                    pill.appendChild(statusSpan);
                    pill.appendChild(cancelBtn);
                    outList.appendChild(pill);
                });
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
            const friends = res.data || [];
            document.getElementById('loading').classList.add('hidden');

            const grid = document.getElementById('friendsGrid');
            const empty = document.getElementById('noFriends');

            grid.textContent = '';
            if (friends.length === 0) {
                empty.classList.remove('hidden');
                grid.classList.add('hidden');
            } else {
                empty.classList.add('hidden');
                grid.classList.remove('hidden');

                friends.forEach(f => {
                    const safeName = f.name || f.username || 'Friend';
                    let imgSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}`;
                    if (f.image_url) {
                        const resolved = window.ScrapbookConfig.resolveMediaUrl(f.image_url);
                        if (resolved) imgSrc = resolved;
                    }

                    const fId = f.friend_id || f.id || f.email || '';

                    const card = document.createElement('div');
                    card.className = 'bg-white rounded-2xl p-6 shadow transition hover:scale-105 group relative';

                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'absolute top-2 right-2 w-8 h-8 bg-[#E88B8B] text-white rounded-full hover:bg-[#E47777] flex items-center justify-center';
                    const trashIcon = document.createElement('i');
                    trashIcon.className = 'fas fa-trash text-sm';
                    delBtn.appendChild(trashIcon);
                    delBtn.addEventListener('click', () => window.deleteFriend(fId, safeName));

                    const body = document.createElement('div');
                    body.className = 'text-center';

                    const avatarWrap = document.createElement('div');
                    avatarWrap.className = 'relative mb-4';
                    const img = document.createElement('img');
                    img.src = imgSrc;
                    img.alt = safeName;
                    img.className = 'w-20 h-20 rounded-full object-cover mx-auto border-4 border-[#E8E3F5] group-hover:border-[#D1C7EB] transition';
                    img.loading = 'lazy';
                    avatarWrap.appendChild(img);

                    const h3 = document.createElement('h3');
                    h3.className = 'font-semibold text-[#2D2A3D] mb-1';
                    h3.textContent = safeName;

                    const relSpan = document.createElement('span');
                    relSpan.className = 'inline-block bg-[#E8E3F5] text-[#6958A2] px-3 py-1 rounded-full text-sm font-medium mb-3';
                    relSpan.textContent = f.relationship_type || 'Friend';

                    const memCountDiv = document.createElement('div');
                    memCountDiv.className = 'flex items-center justify-center space-x-1 mb-4';
                    const starIcon = document.createElement('i');
                    starIcon.className = 'fas fa-star text-[#F4A6A6] text-sm';
                    const countSpan = document.createElement('span');
                    countSpan.className = 'text-sm text-[#6B6B7D]';
                    countSpan.textContent = `${f.memoryCount || 0} memories`;
                    memCountDiv.appendChild(starIcon);
                    memCountDiv.appendChild(countSpan);

                    const mapLink = document.createElement('a');
                    mapLink.href = `/friends/friendship_map_of_memories.html?friend_id=${encodeURIComponent(fId)}`;
                    mapLink.className = 'w-full bg-[#8B7EC8] text-white py-2 px-4 rounded-lg hover:bg-[#7A6BB5] transition font-medium text-sm';
                    mapLink.textContent = 'View Friendship Map';

                    body.appendChild(avatarWrap);
                    body.appendChild(h3);
                    body.appendChild(relSpan);
                    body.appendChild(memCountDiv);
                    body.appendChild(mapLink);

                    card.appendChild(delBtn);
                    card.appendChild(body);
                    grid.appendChild(card);
                });
            }
        } catch (err) {
            console.error(err);
            document.getElementById('loading').textContent = 'Failed to load friends.';
        }
    }

    window.acceptRequest = async function(id, name) {
        try {
            await axios.post(`/api/friends/requests/${encodeURIComponent(id)}/accept`);
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
                await axios.post(`/api/friends/requests/${encodeURIComponent(id)}/decline`);
                loadPendingRequests();
            } catch (err) {
                alert(err.response?.data?.error || 'Failed to decline request');
            }
        }
    };

    window.cancelRequest = async function(id) {
        if (confirm('Cancel this pending friend request?')) {
            try {
                await axios.delete(`/api/friends/requests/${encodeURIComponent(id)}`);
                loadPendingRequests();
            } catch (err) {
                alert(err.response?.data?.error || 'Failed to cancel request');
            }
        }
    };

    window.deleteFriend = async function(id, name) {
        if (confirm(`Are you sure you want to remove ${name} from your friends list? This action cannot be undone.`)) {
            try {
                await axios.delete('/api/friends/' + encodeURIComponent(id));
                loadFriends();
            } catch(err) {
                alert('Failed to delete friend');
            }
        }
    };

    loadPendingRequests();
    loadFriends();
});