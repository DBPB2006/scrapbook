document.addEventListener('DOMContentLoaded', async () => {
        await loadNavbar();

        try {
            const res = await axios.get('/api/dashboard_data');
            const data = res.data;

            document.getElementById('welcomeName').textContent = data.firstName;

            if (data.hasUnseenSharedMemory) {
                const popup = document.getElementById('sharedMemoryPopup');
                const link = document.getElementById('viewSharedMemoryLink');
                link.href = '/memories/view_shared_memory.html?id=' + encodeURIComponent(data.newestUnseenMemoryId);
                popup.classList.remove('hidden');

                window.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') popup.classList.add('hidden');
                });
                popup.addEventListener('click', function(e) {
                    if (e.target === this) popup.classList.add('hidden');
                });
            }

            const sentMemories = data.sentSharedMemories || [];
            document.getElementById('sharedMemoriesCount').textContent = `(${sentMemories.length})`;
            
            const badge = document.getElementById('shareCountBadge');
            if (sentMemories.length > 0) {
                badge.textContent = sentMemories.length;
                badge.classList.remove('hidden');
            }

            const listContainer = document.getElementById('sharedMemoriesListContainer');
            listContainer.textContent = '';
            if (sentMemories.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'text-gray-400 text-center';
                emptyDiv.textContent = 'No shared memories yet. Memories you share with friends will appear here.';
                listContainer.appendChild(emptyDiv);
            } else {
                const ul = document.createElement('ul');
                ul.className = 'space-y-4';
                sentMemories.forEach(mem => {
                    const toName = mem.to_username || mem.to || '';
                    const title = mem.memory_title || '(No Title)';
                    const date = mem.date || '';
                    let message = mem.message || '';
                    if (message.length > 60) message = message.substring(0, 60) + '...';

                    const li = document.createElement('li');
                    li.className = 'flex items-center gap-3 p-4 rounded-xl bg-white shadow hover:bg-gray-50 transition border border-[#e0e0f0]';

                    const wrap = document.createElement('div');
                    wrap.className = 'flex-1';

                    const link = document.createElement('a');
                    link.href = `/memories/view_shared_memory.html?id=${encodeURIComponent(mem.memory_id || mem.id)}`;
                    link.className = 'font-semibold text-[#8B7EC8] hover:underline text-base';
                    link.textContent = toName;

                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'text-sm text-gray-900 font-medium truncate';
                    titleDiv.textContent = title;

                    const dateDiv = document.createElement('div');
                    dateDiv.className = 'text-xs text-gray-400 mb-1';
                    dateDiv.textContent = date;

                    const msgDiv = document.createElement('div');
                    msgDiv.className = 'text-xs text-gray-600 line-clamp-2';
                    msgDiv.style.maxWidth = '220px';
                    msgDiv.style.overflow = 'hidden';
                    msgDiv.style.whiteSpace = 'nowrap';
                    msgDiv.style.textOverflow = 'ellipsis';
                    msgDiv.textContent = message;

                    wrap.appendChild(link);
                    wrap.appendChild(titleDiv);
                    wrap.appendChild(dateDiv);
                    wrap.appendChild(msgDiv);
                    li.appendChild(wrap);
                    ul.appendChild(li);
                });
                listContainer.appendChild(ul);
            }

            if (data.userMemories && data.userMemories.length > 0) {
                const exploreGrid = document.getElementById('exploreGrid');
                const firstMemoryId = data.userMemories[0].memory_id || data.userMemories[0].id;

                const viewMemoryCard = document.createElement('a');
                viewMemoryCard.href = '/memories/memory_details.html?id=' + encodeURIComponent(firstMemoryId);
                viewMemoryCard.className = 'bg-white rounded-2xl p-8 shadow-md hover:shadow-lg transition group flex flex-col items-center text-center';

                const iconWrap = document.createElement('div');
                iconWrap.className = 'w-16 h-16 rounded-xl flex items-center justify-center mb-6 bg-[#E6F1FB] group-hover:scale-110 transition-transform';
                const iconEl = document.createElement('i');
                iconEl.className = 'fas fa-book-open text-2xl text-[#8B7EC8]';
                iconWrap.appendChild(iconEl);

                const h3 = document.createElement('h3');
                h3.className = 'text-lg font-semibold mb-2 text-gray-700';
                h3.textContent = 'View Memories';

                const p = document.createElement('p');
                p.className = 'text-gray-500 text-sm mb-2 line-clamp-2';
                p.textContent = 'Feel nostalgic';

                const cta = document.createElement('span');
                cta.className = 'inline-block px-4 py-2 rounded-xl bg-[#A8C8EC] text-white text-sm font-medium shadow hover:bg-[#8B7EC8] transition';
                cta.textContent = 'Go to Memory';

                viewMemoryCard.appendChild(iconWrap);
                viewMemoryCard.appendChild(h3);
                viewMemoryCard.appendChild(p);
                viewMemoryCard.appendChild(cta);
                exploreGrid.insertBefore(viewMemoryCard, exploreGrid.firstChild);
            }

        } catch (err) {
            console.error(err);
        }
    });