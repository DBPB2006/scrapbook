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
                memList.textContent = '';
                const recentMemories = data.recentMemories || [];
                const allFriends = data.allFriends || [];

                if (recentMemories.length === 0) {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.className = 'text-[#6B6B7D]';
                    emptyDiv.appendChild(document.createTextNode('No memories yet. '));
                    const createLink = document.createElement('a');
                    createLink.href = '/memories/add_memory.html';
                    createLink.className = 'text-[#8B7EC8] underline';
                    createLink.textContent = 'Create one!';
                    emptyDiv.appendChild(createLink);
                    memList.appendChild(emptyDiv);
                } else {
                    const rotations = ['rotate-1', '-rotate-1', 'rotate-2'];
                    recentMemories.forEach((mem, i) => {
                        const dateObj = new Date(mem.date || Date.now());
                        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        const title = mem.title || 'Untitled';
                        const desc = mem.description || '';
                        const location = mem.location || '';

                        let friendNames = [];
                        if (mem.friends && mem.friends.length > 0) {
                            mem.friends.forEach(fid => {
                                const f = allFriends.find(af => af.id == fid || af.email == fid || af.friend_id == fid);
                                if (f) friendNames.push(f.name);
                            });
                        }
                        const friendsStr = friendNames.length ? 'with ' + friendNames.join(', ') : '';

                        let img = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(title);
                        let firstMediaUrl = '';
                        if (mem.media && mem.media.length > 0) {
                            firstMediaUrl = typeof mem.media[0] === 'string' ? mem.media[0] : (mem.media[0].url || mem.media[0].path || '');
                        }
                        const rawCandidate = mem.image || firstMediaUrl;
                        if (rawCandidate) {
                            const resolved = window.ScrapbookConfig.resolveMediaUrl(rawCandidate);
                            if (resolved) img = resolved;
                        }

                        const rot = rotations[i % rotations.length];

                        const link = document.createElement('a');
                        link.href = '/memories/memory_details.html?id=' + encodeURIComponent(mem.memory_id || mem.id);
                        link.className = 'flex-shrink-0 w-64 block no-underline text-left';

                        const card = document.createElement('div');
                        card.className = `w-full bg-white p-4 rounded-2xl shadow transition-all duration-300 hover:scale-105 transform ${rot} hover:rotate-0 cursor-pointer`;

                        const imgBox = document.createElement('div');
                        imgBox.className = 'relative mb-4';
                        const imgEl = document.createElement('img');
                        imgEl.src = img;
                        imgEl.alt = title;
                        imgEl.className = 'w-full h-48 object-cover rounded-lg';
                        imgEl.loading = 'lazy';
                        imgBox.appendChild(imgEl);

                        if (location) {
                            const locBadge = document.createElement('div');
                            locBadge.className = 'absolute top-2 right-2 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full text-xs font-medium text-[#6B6B7D]';
                            locBadge.textContent = '📍 ' + location;
                            imgBox.appendChild(locBadge);
                        }

                        const h3 = document.createElement('h3');
                        h3.className = 'font-semibold text-[#2D2A3D] mb-2';
                        h3.textContent = title;

                        const descP = document.createElement('p');
                        descP.className = 'text-sm text-[#6B6B7D] mb-3';
                        descP.textContent = desc;

                        const footer = document.createElement('div');
                        footer.className = 'flex items-center justify-between';
                        const friendsSpan = document.createElement('span');
                        friendsSpan.className = 'text-xs text-[#6B6B7D]';
                        friendsSpan.textContent = friendsStr;
                        const dateSpan = document.createElement('span');
                        dateSpan.className = 'text-xs text-[#8B7EC8] font-medium';
                        dateSpan.textContent = dateStr;
                        footer.appendChild(friendsSpan);
                        footer.appendChild(dateSpan);

                        card.appendChild(imgBox);
                        card.appendChild(h3);
                        card.appendChild(descP);
                        card.appendChild(footer);
                        link.appendChild(card);
                        memList.appendChild(link);
                    });
                }

                const frList = document.getElementById('recentFriendsList');
                frList.textContent = '';
                const recentFriends = data.recentFriends || [];
                if (recentFriends.length === 0) {
                    const emptyFr = document.createElement('div');
                    emptyFr.className = 'text-[#6B6B7D]';
                    emptyFr.textContent = 'No friends added yet.';
                    frList.appendChild(emptyFr);
                } else {
                    recentFriends.forEach(f => {
                        const fName = f.name || f.email || 'Friend';
                        let img = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(fName);
                        const rawImg = f.profile_image || f.image_url;
                        if (rawImg) {
                            const resolved = window.ScrapbookConfig.resolveMediaUrl(rawImg);
                            if (resolved) img = resolved;
                        }

                        const d = f.date_added ? new Date(f.date_added).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

                        const row = document.createElement('div');
                        row.className = 'flex items-start space-x-3';

                        const imgEl = document.createElement('img');
                        imgEl.src = img;
                        imgEl.alt = `${fName} profile`;
                        imgEl.className = 'w-8 h-8 rounded-full object-cover flex-shrink-0';
                        imgEl.loading = 'lazy';

                        const txtWrap = document.createElement('div');
                        txtWrap.className = 'flex-1 min-w-0';
                        const p = document.createElement('p');
                        p.className = 'text-sm text-[#2D2A3D]';
                        const nameSpan = document.createElement('span');
                        nameSpan.className = 'font-medium';
                        nameSpan.textContent = fName;
                        p.appendChild(nameSpan);
                        p.appendChild(document.createTextNode(' added as a friend'));
                        if (d) {
                            p.appendChild(document.createTextNode(' '));
                            const dSpan = document.createElement('span');
                            dSpan.className = 'text-xs text-[#8B7EC8]';
                            dSpan.textContent = `(${d})`;
                            p.appendChild(dSpan);
                        }
                        txtWrap.appendChild(p);
                        row.appendChild(imgEl);
                        row.appendChild(txtWrap);
                        frList.appendChild(row);
                    });
                }
            } catch (err) {
                console.error(err);
            }
        });