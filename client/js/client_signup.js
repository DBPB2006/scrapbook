document.addEventListener('DOMContentLoaded', function() {
            const form = document.getElementById('signupForm');
            const messageContainer = document.getElementById('message-container');
            const errorMessage = document.getElementById('error-message');
            const successMessage = document.getElementById('success-message');
            const signupBtn = document.getElementById('signupBtn');

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

            form.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const formData = new FormData(form);
                
                const profilePicInput = document.getElementById('profilePic');
                if (profilePicInput && profilePicInput.files.length === 0) {
                    formData.delete('profilePic');
                }
                
                // Validate fields manually as simple version
                if (formData.get('password') !== formData.get('confirmPassword')) {
                    showMessage('error', 'Passwords do not match');
                    return;
                }

                signupBtn.textContent = 'Creating Account...';
                signupBtn.disabled = true;

                try {
                    // Send as FormData since it includes file upload
                    const response = await axios.post('/api/signup', formData, {
                        headers: {
                            'Content-Type': 'multipart/form-data'
                        }
                    });
                    
                    if (response.data.success) {
                        showMessage('success', 'Account created successfully! Redirecting...');
                        setTimeout(() => {
                            window.location.href="/login.html";
                        }, 1500);
                    }
                } catch (error) {
                    const msg = error.response?.data?.error || 'Signup failed. Please try again.';
                    showMessage('error', msg);
                    signupBtn.textContent = 'Create Account';
                    signupBtn.disabled = false;
                }
            });

            // Password Toggle & Strength
            const passwordInput = document.getElementById('password');
            const passwordToggle = document.querySelector('.password-toggle');
            const passwordIcon = document.getElementById('password-icon');
            const strengthBar = document.getElementById('strength-bar');
            const strengthText = document.getElementById('strength-text');
            
            passwordToggle.addEventListener('click', function() {
                const type = passwordInput.type === 'password' ? 'text' : 'password';
                passwordInput.type = type;
                passwordIcon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
            });
            function checkPasswordStrength(password) {
                let strength = 0;
                if (password.length >= 8) strength += 1;
                if (/[a-z]/.test(password)) strength += 1;
                if (/[A-Z]/.test(password)) strength += 1;
                if (/[0-9]/.test(password)) strength += 1;
                if (/[^A-Za-z0-9]/.test(password)) strength += 1;
                return strength;
            }
            function updatePasswordStrength(password) {
                const strength = checkPasswordStrength(password);
                const strengthClasses = ['', 'strength-weak', 'strength-fair', 'strength-good', 'strength-strong'];
                const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
                strengthBar.className = `password-strength flex-1 ${strengthClasses[strength] || ''}`;
                strengthText.textContent = strength > 0 ? strengthLabels[strength] : 'Password strength';
            }
            passwordInput.addEventListener('input', function() {
                updatePasswordStrength(this.value);
            });

            // Profile Picture Preview logic
            const profilePicInput = document.getElementById('profilePic');
            const imagePreview = document.getElementById('imagePreview');
            const userIcon = document.getElementById('userIcon');
            const removePhotoButton = document.getElementById('removePhoto');

            profilePicInput.addEventListener('change', function() {
                const file = this.files[0];
                if (file) {
                    if (file.size > 2 * 1024 * 1024) {
                        alert('File is too large. Max size is 2MB.');
                        this.value = '';
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        imagePreview.src = e.target.result;
                        imagePreview.classList.remove('hidden');
                        imagePreview.style.display = 'block';
                        userIcon.classList.add('hidden');
                        userIcon.style.display = 'none';
                        removePhotoButton.classList.remove('hidden');
                        removePhotoButton.classList.add('flex');
                        removePhotoButton.style.display = 'flex';
                    }
                    reader.readAsDataURL(file);
                }
            });

            removePhotoButton.addEventListener('click', function(e) {
                e.preventDefault();
                profilePicInput.value = '';
                imagePreview.src = '';
                imagePreview.classList.add('hidden');
                imagePreview.style.display = 'none';
                userIcon.classList.remove('hidden');
                userIcon.style.display = 'inline-block';
                removePhotoButton.classList.add('hidden');
                removePhotoButton.classList.remove('flex');
                removePhotoButton.style.display = '';
            });
        });