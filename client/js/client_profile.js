document.addEventListener('DOMContentLoaded', async () => {
            await loadNavbar();
            
            const messageContainer = document.getElementById('message-container');
            function showMessage(type, message) {
                messageContainer.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'border-green-200', 'bg-red-100', 'text-red-700', 'border-red-200');
                if (type === 'error') {
                    messageContainer.classList.add('bg-red-100', 'text-red-700', 'border-red-200');
                    messageContainer.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i> ${message}`;
                } else {
                    messageContainer.classList.add('bg-green-100', 'text-green-700', 'border-green-200');
                    messageContainer.innerHTML = `<i class="fas fa-check-circle mr-2"></i> ${message}`;
                }
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
                    const res = await axios.get('/api/profile_data');
                    const user = res.data;
                    document.getElementById('first_name').value = user.first_name || '';
                    document.getElementById('last_name').value = user.last_name || '';
                    document.getElementById('username').value = user.username || '';
                    document.getElementById('email').value = user.email || '';
                    
                    document.getElementById('displayFullName').textContent = `${user.first_name || ''} ${user.last_name || ''}`;
                    document.getElementById('displayUsername').textContent = `@${user.username || ''}`;

                    let imgUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.first_name + ' ' + user.last_name)}&background=A8C8EC&color=fff&size=200`;
                    if (user.profile_pic && user.profile_pic.startsWith('uploads/')) {
                        imgUrl = '/' + user.profile_pic;
                    }
                    document.getElementById('avatarImg').src = imgUrl;

                    // Load Friends
                    const friendsList = document.getElementById('friendsList');
                    const friends = user.friends || [];
                    if (friends.length === 0) {
                        friendsList.innerHTML = `<div class="text-[#6B6B7D] text-center py-4 bg-[#F5F3FB] rounded-xl flex flex-col items-center justify-center gap-2"><span>No friends added yet.</span><a href="/friends/add_friend.html" class="text-[#8B7EC8] font-medium hover:underline inline-flex items-center text-sm"><i class="fas fa-user-plus mr-2"></i>Add your first friend</a></div>`;
                    } else {
                        let html = '';
                        friends.forEach(friend => {
                            let fImg = `https://ui-avatars.com/api/?name=${encodeURIComponent(friend.name || 'U')}&background=random`;
                            if (friend.image_url && friend.image_url.startsWith('uploads/')) {
                                fImg = '/' + friend.image_url;
                            }
                            html += `
                            <div class="flex items-center space-x-4 p-3 hover:bg-[#F5F3FB] rounded-xl transition border border-transparent hover:border-[#E8E3F5]">
                                <div class="w-12 h-12 bg-[#E8E3F5] rounded-full flex items-center justify-center overflow-hidden">
                                    <img src="${fImg}" alt="${friend.name}" class="w-full h-full object-cover" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <h4 class="font-medium text-[#2D2A3D] truncate">${friend.name}</h4>
                                    <p class="text-sm text-[#6B6B7D] truncate">${friend.relationship_type || 'Friend'}</p>
                                </div>
                                <div>
                                    <button class="remove-friend-btn w-8 h-8 rounded-full flex justify-center items-center text-red-400 hover:bg-red-50 hover:text-red-600 transition" data-id="${friend.friend_id || friend.email}">
                                        <i class="fas fa-user-times"></i>
                                    </button>
                                </div>
                            </div>`;
                        });
                        friendsList.innerHTML = html;

                        document.querySelectorAll('.remove-friend-btn').forEach(btn => {
                            btn.addEventListener('click', async (e) => {
                                if (confirm('Remove this friend?')) {
                                    const fid = e.currentTarget.getAttribute('data-id');
                                    try {
                                        await axios.post('/api/profile/remove_friend', { remove_friend_id: fid });
                                        showMessage('success', 'Friend removed successfully');
                                        loadProfile();
                                    } catch (err) {
                                        showMessage('error', 'Failed to remove friend');
                                    }
                                }
                            });
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
                    const res = await axios.post('/api/profile/update', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
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
                    const res = await axios.post('/api/profile/password', { old_password, new_password, confirm_password });
                    showMessage('success', res.data.message);
                    document.getElementById('passwordForm').reset();
                } catch (err) {
                    showMessage('error', err.response?.data?.error || 'Password update failed');
                }
            });

            document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
                if (confirm('Are you sure you want to delete your account? This action cannot be undone and you will lose all your memories.')) {
                    try {
                        await axios.post('/api/profile/delete_account');
                        window.location.href="/signup.html?deleted=1";
                    } catch (err) {
                        showMessage('error', 'Failed to delete account');
                    }
                }
            });
        });