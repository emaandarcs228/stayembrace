
    window.addEventListener('load', function() {
        const splash = document.getElementById('splash-screen');
        const hero = document.querySelector('.hero');
        
        // Start hero animation EARLY (while splash is still visible)
        setTimeout(function() {
            if (hero) {
                // Reset animation
                hero.style.animation = 'none';
                hero.style.backgroundSize = '110%';
                
                // Force reflow
                void hero.offsetHeight;
                
                // Apply zoom animation - this starts playing NOW
                hero.style.animation = 'heroZoom 1.5s ease-out forwards';
            }
        }, 1800); // Start animation after 1.8 seconds (while splash still visible)
        
        // Hide splash after 3 seconds
        setTimeout(function() {
            splash.classList.add('hide');
            
            // Remove splash from DOM after transition
            setTimeout(function() {
                splash.style.display = 'none';
            }, 900);
            
        }, 3000);
    });

    // Fallback: Minimum display time
    let splashStartTime = Date.now();
    window.addEventListener('load', function() {
        const elapsed = Date.now() - splashStartTime;
        const minDisplayTime = 2000;
        
        if (elapsed < minDisplayTime) {
            const splash = document.getElementById('splash-screen');
            setTimeout(function() {
                splash.classList.add('hide');
            }, minDisplayTime - elapsed);
        }
    });
