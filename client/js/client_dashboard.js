document.addEventListener('DOMContentLoaded', async () => {
            await loadNavbar();

            try {
                const res = await axios.get('/api/dashboard_data');
                const data = res.data;

                document.getElementById('welcomeName').textContent = data.firstName;
                document.getElementById('friendsCount').textContent = data.friendsCount;
                document.getElementById('friendsCountLabel').textContent = '+' + data.friendsCount + ' total';
                document.getElementById('memoryCount').textContent = data.memoryCount;
                document.getElementById('memoryCountLabel').textContent = '+' + data.memoryCount + ' total';
                
                document.getElementById('newMemoriesCount').textContent = data.newMemories;
                document.getElementById('newFriendsCount').textContent = data.newFriends;
                document.getElementById('mapViewsCount').textContent = data.mapViews;

                const memList = document.getElementById('recentMemoriesList');
                if (data.recentMemories.length === 0) {
                    memList.innerHTML = '<div class="text-[#6B6B7D]">No memories yet. <a href="/memories/add_memory.html" class="text-[#8B7EC8] underline">Create one!</a></div>';
                } else {
                    let html = '';
                    const rotations = ['rotate-1', '-rotate-1', 'rotate-2'];
                    data.recentMemories.forEach((mem, i) => {
                        const dateObj = new Date(mem.date || Date.now());
                        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        const title = mem.title || 'Untitled';
                        const desc = mem.description || '';
                        const location = mem.location || '';
                        
                        let friendNames = [];
                        if (mem.friends && mem.friends.length > 0) {
                            mem.friends.forEach(fid => {
                                const f = data.allFriends.find(af => af.id == fid || af.email == fid || af.friend_id == fid);
                                if (f) friendNames.push(f.name);
                            });
                        }
                        const friendsStr = friendNames.length ? 'with ' + friendNames.join(', ') : '';
                        
                        let img = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(title);
                        let firstMediaUrl = '';
                        if (mem.media && mem.media.length > 0) {
                            firstMediaUrl = typeof mem.media[0] === 'string' ? mem.media[0] : mem.media[0].url;
                        }
                        if (mem.image && mem.image.startsWith('uploads/')) img = '/' + mem.image;
                        else if (firstMediaUrl && firstMediaUrl.startsWith('uploads/')) img = '/' + firstMediaUrl;

                        const rot = rotations[i % rotations.length];
                        
                        html += '<a href="/memories/memory_details.html?id=' + encodeURIComponent(mem.memory_id || mem.id) + '" class="flex-shrink-0 w-64 block no-underline text-left">';
                        html += '<div class="w-full bg-white p-4 rounded-2xl shadow transition-all duration-300 hover:scale-105 transform ' + rot + ' hover:rotate-0 cursor-pointer">';
                        html += '<div class="relative mb-4">';
                        html += '<img src="' + img + '" alt="' + title + '" class="w-full h-48 object-cover rounded-lg" loading="lazy" />';
                        if (location) {
                            html += '<div class="absolute top-2 right-2 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full text-xs font-medium text-[#6B6B7D]">📍 ' + location + '</div>';
                        }
                        html += '</div>';
                        html += '<h3 class="font-semibold text-[#2D2A3D] mb-2">' + title + '</h3>';
                        html += '<p class="text-sm text-[#6B6B7D] mb-3">' + desc + '</p>';
                        html += '<div class="flex items-center justify-between">';
                        html += '<span class="text-xs text-[#6B6B7D]">' + friendsStr + '</span>';
                        html += '<span class="text-xs text-[#8B7EC8] font-medium">' + dateStr + '</span>';
                        html += '</div>';
                        html += '</div>';
                        html += '</a>';
                    });
                    memList.innerHTML = html;
                }

                const frList = document.getElementById('recentFriendsList');
                if (data.recentFriends.length === 0) {
                    frList.innerHTML = '<div class="text-[#6B6B7D]">No friends added yet.</div>';
                } else {
                    let fhtml = '';
                    data.recentFriends.forEach(f => {
                        let img = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(f.name);
                        if (f.profile_image && f.profile_image.startsWith('uploads/')) img = '/' + f.profile_image;
                        else if (f.image_url && f.image_url.startsWith('uploads/')) img = '/' + f.image_url;
                        
                        const d = f.date_added ? new Date(f.date_added).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                        
                        fhtml += '<div class="flex items-start space-x-3">';
                        fhtml += '<img src="' + img + '" alt="' + f.name + ' profile" class="w-8 h-8 rounded-full object-cover flex-shrink-0" loading="lazy" />';
                        fhtml += '<div class="flex-1 min-w-0">';
                        fhtml += '<p class="text-sm text-[#2D2A3D]"><span class="font-medium">' + f.name + '</span> added as a friend';
                        if (d) fhtml += ' <span class="text-xs text-[#8B7EC8]">(' + d + ')</span>';
                        fhtml += '</p>';
                        fhtml += '</div>';
                        fhtml += '</div>';
                    });
                    frList.innerHTML = fhtml;
                }
            } catch (err) {
                console.error(err);
            }
        });