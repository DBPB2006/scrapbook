document.addEventListener('DOMContentLoaded', async function() {
    await loadNavbar();

    const friendName = document.getElementById('friendName');
    const userSearchInput = document.getElementById('userSearchInput');
    const userSuggestions = document.getElementById('userSuggestions');
    
    // Quick user search logic
    let allUsers = [];
    try {
        const res = await axios.get('/api/users');
        allUsers = res.data;
    } catch(e) { console.error(e); }

    userSearchInput.addEventListener('input', function() {
        document.getElementById('friendName').value = this.value;
        const query = this.value.trim().toLowerCase();
        userSuggestions.innerHTML = '';
        if (query.length < 1) {
            userSuggestions.classList.add('hidden');
            return;
        }

        const matches = allUsers.filter(u => {
            const nameMatch = u.name ? u.name.toLowerCase().includes(query) : false;
            const emailMatch = u.email ? u.email.toLowerCase().includes(query) : false;
            return nameMatch || emailMatch;
        });

        if (matches.length > 0) {
            userSuggestions.classList.remove('hidden');
        } else {
            userSuggestions.classList.add('hidden');
        }

        matches.forEach(user => {
            const div = document.createElement('div');
            div.className = 'px-4 py-2 hover:bg-[#F5F3FB] cursor-pointer text-sm text-[#2D2A3D] border-b border-[#E8E3F5] last:border-0';
            div.textContent = `${user.name} (${user.email})`;
            div.onclick = () => {
                document.getElementById('friendName').value = user.name || user.email;
                document.getElementById('friendEmail').value = user.email;
                userSearchInput.value = user.name;
                userSuggestions.innerHTML = '';
                userSuggestions.classList.add('hidden');
            };
            userSuggestions.appendChild(div);
        });
    });

    document.addEventListener('click', function(e) {
        if (!userSearchInput.contains(e.target) && !userSuggestions.contains(e.target)) {
            userSuggestions.innerHTML = '';
            userSuggestions.classList.add('hidden');
        }
    });

    const imgPrev = document.getElementById('imagePreview');
    const imgInput = document.getElementById('profileImage');
    const img = document.getElementById('selectedImage');
    const ph = document.getElementById('placeholderContent');
    const rmBtn = document.getElementById('removeImageBtn');
    
    imgPrev.addEventListener('click', () => imgInput.click());
    
    imgInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            const r = new FileReader();
            r.onload = ev => { 
                img.src = ev.target.result; 
                img.classList.remove('hidden'); 
                ph.classList.add('hidden'); 
                rmBtn.classList.remove('hidden'); 
            };
            r.readAsDataURL(file);
        }
    });
    
    rmBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        imgInput.value = '';
        img.classList.add('hidden');
        ph.classList.remove('hidden');
        rmBtn.classList.add('hidden');
    });

    document.querySelectorAll('.relationship-tag').forEach(tag => {
        tag.addEventListener('click', function() {
            document.querySelectorAll('.relationship-tag').forEach(t => t.classList.remove('border-[#8B7EC8]', 'bg-[#F5F3FB]', 'text-[#8B7EC8]'));
            this.classList.add('border-[#8B7EC8]', 'bg-[#F5F3FB]', 'text-[#8B7EC8]');
            document.getElementById('selectedTag').value = this.dataset.tag;
            document.getElementById('customTag').value = '';
        });
    });

    document.getElementById('customTag').addEventListener('input', function() {
        if (this.value) {
            document.querySelectorAll('.relationship-tag').forEach(t => t.classList.remove('border-[#8B7EC8]', 'bg-[#F5F3FB]', 'text-[#8B7EC8]'));
            document.getElementById('selectedTag').value = this.value;
        }
    });

    document.getElementById('howYouMet').addEventListener('input', function() {
        document.getElementById('charCount').textContent = this.value.length;
    });

    document.getElementById('resetFormBtn').addEventListener('click', () => {
        document.getElementById('addFriendForm').reset();
        rmBtn.click();
        document.querySelectorAll('.relationship-tag').forEach(t => t.classList.remove('border-[#8B7EC8]', 'bg-[#F5F3FB]', 'text-[#8B7EC8]'));
        document.getElementById('charCount').textContent = '0';
        document.getElementById('errorMsg').classList.add('hidden');
    });

    document.getElementById('addFriendForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const err = document.getElementById('errorMsg');
        err.classList.add('hidden');
        
        if (!friendName.value) {
            friendName.value = userSearchInput.value;
        }

        const formData = new FormData();
        formData.append('friendName', document.getElementById('friendName').value);
        formData.append('friendEmail', document.getElementById('friendEmail').value);
        formData.append('relationshipTag', document.getElementById('selectedTag').value || document.getElementById('customTag').value);
        formData.append('howYouMet', document.getElementById('howYouMet').value);
        
        if (imgInput.files[0]) {
            formData.append('profileImage', imgInput.files[0]);
        }

        try {
            const res = await axios.post('/api/friends', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            window.location.href="/friends/view_friends.html";
        } catch (error) {
            err.textContent = error.response?.data?.error || 'Failed to add friend';
            err.classList.remove('hidden');
        }
    });
});