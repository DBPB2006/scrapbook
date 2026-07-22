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
            if (sentMemories.length === 0) {
                listContainer.innerHTML = '<div class="text-gray-400 text-center">No shared memories yet. Memories you share with friends will appear here.</div>';
            } else {
                let html = '<ul class="space-y-4">';
                sentMemories.forEach(mem => {
                    const toName = mem.to_username || mem.to;
                    const title = mem.memory_title || '(No Title)';
                    const date = mem.date || '';
                    let message = mem.message || '';
                    if (message.length > 60) message = message.substring(0, 60) + '...';

                    html += `
                    <li class="flex items-center gap-3 p-4 rounded-xl bg-white shadow hover:bg-gray-50 transition border border-[#e0e0f0]">
                        <div class="flex-1">
                            <a href="/memories/view_shared_memory.html?id=${encodeURIComponent(mem.memory_id || mem.id)}" class="font-semibold text-[#8B7EC8] hover:underline text-base">
                            ${toName}
                            </a>
                            <div class="text-sm text-gray-900 font-medium truncate">${title}</div>
                            <div class="text-xs text-gray-400 mb-1">${date}</div>
                            <div class="text-xs text-gray-600 line-clamp-2" style="max-width:220px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
                            ${message}
                            </div>
                        </div>
                    </li>`;
                });
                html += '</ul>';
                listContainer.innerHTML = html;
            }

            if (data.userMemories && data.userMemories.length > 0) {
                const exploreGrid = document.getElementById('exploreGrid');
                const firstMemoryId = data.userMemories[0].memory_id || data.userMemories[0].id;
                
                const viewMemoryCard = document.createElement('a');
                viewMemoryCard.href = '/memories/memory_details.html?id=' + encodeURIComponent(firstMemoryId);
                viewMemoryCard.className = "bg-white rounded-2xl p-8 shadow-md hover:shadow-lg transition group flex flex-col items-center text-center";
                viewMemoryCard.innerHTML = `
                  <div class="w-16 h-16 rounded-xl flex items-center justify-center mb-6 bg-[#E6F1FB] group-hover:scale-110 transition-transform">
                    <i class="fas fa-book-open text-2xl text-[#8B7EC8]"></i>
                  </div>
                  <h3 class="text-lg font-semibold mb-2 text-gray-700">View Memories</h3>
                  <p class="text-gray-500 text-sm mb-2 line-clamp-2">Feel nostalgic</p>
                  <span class="inline-block px-4 py-2 rounded-xl bg-[#A8C8EC] text-white text-sm font-medium shadow hover:bg-[#8B7EC8] transition">Go to Memory</span>
                `;
                exploreGrid.insertBefore(viewMemoryCard, exploreGrid.firstChild);
            }

        } catch (err) {
            console.error(err);
        }
    });