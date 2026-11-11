document.addEventListener('DOMContentLoaded', async () => {
            await loadNavbar();
            
            const messageContainer = document.getElementById('message-container');
            function showMessage(type, message) {
                messageContainer.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'border-green-200', 'bg-red-100', 'text-red-700', 'border-red-200');
                messageContainer.textContent = '';
                const icon = document.createElement('i');
                if (type === 'error') {
                    messageContainer.classList.add('bg-red-100', 'text-red-700', 'border-red-200');
                    icon.className = 'fas fa-exclamation-circle mr-2';
                } else {
                    messageContainer.classList.add('bg-green-100', 'text-green-700', 'border-green-200');
                    icon.className = 'fas fa-check-circle mr-2';
                }
                messageContainer.appendChild(icon);
                messageContainer.appendChild(document.createTextNode(' ' + (message || '')));
            }

            let profileFile = null;
            document.getElementById('profilePic').addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    profileFile = e.target.files[0];
                    const reader = new FileReader();
                    reader.onload = function(evt) {
                        document.getElementById('avatarImg').src = evt.target.result;
                    }
                    reader.readAsDataURL(profileFile);
                }
            });

            async function loadProfile() {
                try {
                    const res = await axios.get('/api/users/profile_data');
                    const user = res.data;
                    document.getElementById('first_name').value = user.first_name || '';
                    document.getElementById('last_name').value = user.last_name || '';
                    document.getElementById('username').value = user.username || '';
                    document.getElementById('email').value = user.email || '';
                    
                    document.getElementById('displayFullName').textContent = `${user.first_name || ''} ${user.last_name || ''}`;
                    document.getElementById('displayUsername').textContent = `@${user.username || ''}`;

                    let imgUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.first_name + ' ' + user.last_name)}&background=A8C8EC&color=fff&size=200`;
                    if (user.profile_pic) {
                        const resolved = window.ScrapbookConfig.resolveMediaUrl(user.profile_pic);
                        if (resolved) imgUrl = resolved;
                    }
                    document.getElementById('avatarImg').src = imgUrl;

                    // Load Friends
                    const friendsList = document.getElementById('friendsList');
                    const friends = user.friends || [];
                    friendsList.textContent = '';
                    if (friends.length === 0) {
                        const emptyWrap = document.createElement('div');
                        emptyWrap.className = 'text-[#6B6B7D] text-center py-4 bg-[#F5F3FB] rounded-xl flex flex-col items-center justify-center gap-2';
                        const emptyText = document.createElement('span');
                        emptyText.textContent = 'No friends added yet.';
                        const addLink = document.createElement('a');
                        addLink.href = '/friends/add_friend.html';
                        addLink.className = 'text-[#8B7EC8] font-medium hover:underline inline-flex items-center text-sm';
                        const addIcon = document.createElement('i');
                        addIcon.className = 'fas fa-user-plus mr-2';
                        addLink.appendChild(addIcon);
                        addLink.appendChild(document.createTextNode('Add your first friend'));
                        emptyWrap.appendChild(emptyText);
                        emptyWrap.appendChild(addLink);
                        friendsList.appendChild(emptyWrap);
                    } else {
                        friends.forEach(friend => {
                            const fName = friend.name || friend.email || 'Friend';
                            let fImg = `https://ui-avatars.com/api/?name=${encodeURIComponent(friend.name || 'U')}&background=random`;
                            if (friend.image_url) {
                                const resolved = window.ScrapbookConfig.resolveMediaUrl(friend.image_url);
                                if (resolved) fImg = resolved;
                            }

                            const row = document.createElement('div');
                            row.className = 'flex items-center space-x-4 p-3 hover:bg-[#F5F3FB] rounded-xl transition border border-transparent hover:border-[#E8E3F5]';

                            const avatarWrap = document.createElement('div');
                            avatarWrap.className = 'w-12 h-12 bg-[#E8E3F5] rounded-full flex items-center justify-center overflow-hidden';
                            const img = document.createElement('img');
                            img.src = fImg;
                            img.alt = fName;
                            img.className = 'w-full h-full object-cover';
                            avatarWrap.appendChild(img);

                            const info = document.createElement('div');
                            info.className = 'flex-1 min-w-0';
                            const h4 = document.createElement('h4');
                            h4.className = 'font-medium text-[#2D2A3D] truncate';
                            h4.textContent = fName;
                            const p = document.createElement('p');
                            p.className = 'text-sm text-[#6B6B7D] truncate';
                            p.textContent = friend.relationship_type || 'Friend';
                            info.appendChild(h4);
                            info.appendChild(p);

                            const btnWrap = document.createElement('div');
                            const btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = 'remove-friend-btn w-8 h-8 rounded-full flex justify-center items-center text-red-400 hover:bg-red-50 hover:text-red-600 transition';
                            const fid = friend.friend_id || friend.email || '';
                            btn.setAttribute('data-id', fid);
                            const rmIcon = document.createElement('i');
                            rmIcon.className = 'fas fa-user-times';
                            btn.appendChild(rmIcon);
                            btn.addEventListener('click', async () => {
                                if (confirm('Remove this friend?')) {
                                    try {
                                        await axios.post('/api/users/profile/remove_friend', { remove_friend_id: fid });
                                        showMessage('success', 'Friend removed successfully');
                                        loadProfile();
                                    } catch (err) {
                                        showMessage('error', 'Failed to remove friend');
                                    }
                                }
                            });
                            btnWrap.appendChild(btn);

                            row.appendChild(avatarWrap);
                            row.appendChild(info);
                            row.appendChild(btnWrap);
                            friendsList.appendChild(row);
                        });
                    }
                } catch (e) {
                    console.error('Failed to load profile', e);
                }
            }

            loadProfile();

            document.getElementById('profileForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData();
                formData.append('first_name', document.getElementById('first_name').value);
                formData.append('last_name', document.getElementById('last_name').value);
                formData.append('username', document.getElementById('username').value);
                formData.append('email', document.getElementById('email').value);
                if (profileFile) {
                    formData.append('profile_pic', profileFile);
                }

                try {
                    const res = await axios.post('/api/users/profile/update', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    if (res.data && res.data.token) {
                        sessionStorage.setItem('scrapbook_access_token', res.data.token);
                    }
                    showMessage('success', res.data.message);
                    loadProfile();
                } catch (err) {
                    showMessage('error', err.response?.data?.error || 'Update failed');
                }
            });

            document.getElementById('passwordForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const old_password = document.getElementById('old_password').value;
                const new_password = document.getElementById('new_password').value;
                const confirm_password = document.getElementById('confirm_password').value;
                
                try {
                    const res = await axios.post('/api/users/profile/password', { old_password, new_password, confirm_password });
                    showMessage('success', res.data.message);
                    document.getElementById('passwordForm').reset();
                } catch (err) {
                    showMessage('error', err.response?.data?.error || 'Password update failed');
                }
            });

            document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
                if (confirm('Are you sure you want to delete your account? This action cannot be undone and you will lose all your memories.')) {
                    try {
                        await axios.post('/api/users/profile/delete_account');
                        sessionStorage.removeItem('scrapbook_access_token');
                        window.location.href="/signup.html?deleted=1";
                    } catch (err) {
                        showMessage('error', 'Failed to delete account');
                    }
                }
            });
        });