document.addEventListener('DOMContentLoaded', async function() {
    await loadNavbar();

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
                    let imgSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(f.name)}`;
                    if (f.image_url && f.image_url.startsWith('uploads/')) {
                        imgSrc = '/' + f.image_url;
                    }
                    
                    const fId = f.friend_id || f.id || f.email;
                    
                    html += `
                    <div class="bg-white rounded-2xl p-6 shadow transition hover:scale-105 group relative">
                        <button onclick="deleteFriend('${fId}', '${f.name.replace(/'/g, "\\'")}')" class="absolute top-2 right-2 w-8 h-8 bg-[#E88B8B] text-white rounded-full hover:bg-[#E47777] flex items-center justify-center">
                            <i class="fas fa-trash text-sm"></i>
                        </button>
                        <div class="text-center">
                            <div class="relative mb-4">
                                <img src="${imgSrc}" alt="${f.name}" class="w-20 h-20 rounded-full object-cover mx-auto border-4 border-[#E8E3F5] group-hover:border-[#D1C7EB] transition" loading="lazy" />
                            </div>
                            <h3 class="font-semibold text-[#2D2A3D] mb-1">${f.name}</h3>
                            <span class="inline-block bg-[#E8E3F5] text-[#6958A2] px-3 py-1 rounded-full text-sm font-medium mb-3">
                                ${f.relationship_type || 'Friend'}
                            </span>
                            <div class="flex items-center justify-center space-x-1 mb-4">
                                <i class="fas fa-star text-[#F4A6A6] text-sm"></i>
                                <span class="text-sm text-[#6B6B7D]">
                                    ${f.memoryCount} memories
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
    
    window.deleteFriend = async function(id, name) {
        if (confirm(`Are you sure you want to remove ${name} from your friends list? This action cannot be undone.`)) {
            try {
                await axios.delete('/api/friends/' + id);
                loadFriends(); // Reload list
            } catch(err) {
                alert('Failed to delete friend');
            }
        }
    };
    
    loadFriends();
});