// public/js/mobile-scroll-fix.js

// === FIX SCROLL MOBILE PER MODALE (Safari & Android) ===
document.addEventListener('touchmove', function(e) {
  const overlay = e.target.closest('.modal-overlay');
  if (overlay) {
    // Permetti scroll in modale, ma check se è al limite (per prevenire bubble)
    const scrollable = overlay.querySelector('.modal-content');  // Assumi .modal-content sia lo scrollable
    if (scrollable) {
      const dir = e.touches[0].clientY - (this.lastY || e.touches[0].clientY);  // Calcola direzione
      this.lastY = e.touches[0].clientY;
      if ((dir > 0 && scrollable.scrollTop === 0) || (dir < 0 && scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight)) {
        e.preventDefault();  // Blocca se al limite
      }
      return;
    }
  }
  // Blocca sfondo se modale aperta
  if (document.body.classList.contains('modal-open')) {
    e.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchend', function() {
  this.lastY = null;
});
