document.addEventListener('DOMContentLoaded', function() {
            const loginForm = document.getElementById('loginForm');
            const messageContainer = document.getElementById('message-container');
            const errorMessage = document.getElementById('error-message');
            const successMessage = document.getElementById('success-message');
            const loginSpinner = document.getElementById('loginSpinner');
            const loginText = document.getElementById('loginText');
            
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            const passwordToggle = document.querySelector('.password-toggle');
            const passwordIcon = document.getElementById('password-icon');

            // Password visibility toggle
            passwordToggle.addEventListener('click', function() {
                const type = passwordInput.type === 'password' ? 'text' : 'password';
                passwordInput.type = type;
                passwordIcon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
            });

            // Form validation
            function validateEmail(email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(email);
            }

            function showError(element, message) {
                const errorDiv = document.getElementById(element.id + '-error');
                errorDiv.textContent = message;
                errorDiv.classList.remove('hidden');
                element.classList.add('border-red-500');
            }

            function hideError(element) {
                const errorDiv = document.getElementById(element.id + '-error');
                errorDiv.classList.add('hidden');
                element.classList.remove('border-red-500');
            }

            emailInput.addEventListener('blur', function() {
                if (!this.value) {
                    showError(this, 'Email is required');
                } else if (!validateEmail(this.value)) {
                    showError(this, 'Please enter a valid email address');
                } else {
                    hideError(this);
                }
            });

            passwordInput.addEventListener('blur', function() {
                if (!this.value) {
                    showError(this, 'Password is required');
                } else if (this.value.length < 6) {
                    showError(this, 'Password must be at least 6 characters');
                } else {
                    hideError(this);
                }
            });

            function showMessage(type, message) {
                messageContainer.classList.remove('hidden');
                if (type === 'error') {
                    errorMessage.textContent = message;
                    errorMessage.classList.remove('hidden');
                    successMessage.classList.add('hidden');
                } else {
                    successMessage.textContent = message;
                    successMessage.classList.remove('hidden');
                    errorMessage.classList.add('hidden');
                }
            }

            loginForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;

                if (!email || !password) {
                    showMessage('error', 'Please enter both email and password.');
                    return;
                }

                loginSpinner.classList.add('active');
                loginText.textContent = 'Signing in...';

                try {
                    const response = await axios.post('/api/login', { email, password });
                    if (response.data.success) {
                        showMessage('success', 'Login successful! Redirecting...');
                        setTimeout(() => {
                            window.location.href = '/dashboard.html';
                        }, 1000);
                    }
                } catch (error) {
                    const msg = error.response?.data?.error || 'Login failed. Please try again.';
                    showMessage('error', msg);
                } finally {
                    loginSpinner.classList.remove('active');
                    loginText.textContent = 'Sign In';
                }
            });
        });