// Main application logic

async function loadNavbar() {
    try {
        const response = await fetch('/navbar.html');
        const navbarHtml = await response.text();
        document.getElementById('navbar-container').innerHTML = navbarHtml;

        // Fetch current user and set navbar info
        const userRes = await axios.get('/api/current_user');
        const user = userRes.data;

        document.getElementById('navUserEmail').textContent = user.email;
        const name = user.name || user.username || user.email;
        document.getElementById('navUserName').textContent = name;
        document.getElementById('navUserInitial').textContent = name.charAt(0).toUpperCase();

        // Highlight current page
        const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            if (link.getAttribute('data-page') === currentPage) {
                link.classList.remove('text-[#6B6B7D]');
                link.classList.add('font-medium', 'text-[#8B7EC8]');
            }
        });

        // Dropdown logic
        const userAvatar = document.getElementById('userAvatar');
        const userDropdown = document.getElementById('userDropdown');
        if (userAvatar && userDropdown) {
            userAvatar.addEventListener('click', (e) => {
                e.stopPropagation();
                userDropdown.classList.toggle('hidden');
            });
            document.addEventListener('click', (e) => {
                if (!userAvatar.contains(e.target) && !userDropdown.contains(e.target)) {
                    userDropdown.classList.add('hidden');
                }
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    userDropdown.classList.add('hidden');
                    userAvatar.focus();
                }
            });
        }
    } catch (err) {
        if (err.response && err.response.status === 401) {
            window.location.href = "/login.html";
        }
    }
}

async function logout() {
    try {
        await axios.post('/api/logout');
        window.location.href = "/login.html";
    } catch (e) {
        console.error('Logout failed', e);
    }
}
