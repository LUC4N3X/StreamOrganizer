(function cyberNexusVioletVortex() {
    const canvas = document.getElementById('bgCanvas');

    // Controllo sicurezza: se  canvas non esiste o siamo su schermi molto piccoli (vecchi mobile), stop.
    if (!canvas || window.innerWidth <= 768) return;

    const ctx = canvas.getContext('2d', { alpha: false }); // alpha: false per performance migliori se lo sfondo è opaco
    let w, h;
    let t0 = performance.now();
    let lastTime = t0;
    let running = true;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    
    const mouse = { x: window.innerWidth/2, y: window.innerHeight/2, tx: window.innerWidth/2, ty: window.innerHeight/2 };

    // --- CONFIGURAZIONE ENTITÀ ---
    let bgCache = null;
    let atmosphereCache = null;
    let waveGrad = [];
    
    const layers = [
        { amp: 55, wave: 0.006, speed: 0.0014, hue: 260, alpha: 0.30, thick: 1.6 },
        { amp: 85, wave: 0.004, speed: 0.0009, hue: 280, alpha: 0.24, thick: 2.1 },
        { amp: 35, wave: 0.009, speed: 0.0017, hue: 300, alpha: 0.22, thick: 1.4 },
        { amp: 150, wave: 0.005, speed: 0.0004, hue: 240, alpha: 0.16, thick: 2.4 }
    ];
    
    let grid = [];
    let particles = [];
    let glows = [];
    
    const GRID_COUNT = 30;
    const PARTICLE_COUNT = 130;
    const GLOWS_COUNT = 5;
    const R = (a, b) => a + Math.random() * (b - a);

    function initEntities() {
        grid = Array.from({ length: GRID_COUNT }, () => ({
            x: R(0, w), y: R(0, h), len: R(130, 280),
            speed: R(0.35, 0.85), alpha: R(0.06, 0.12)
        }));
        particles = Array.from({ length: PARTICLE_COUNT }, () => ({
            x: R(0, w), y: R(0, h), r: R(0.4, 1.5),
            speed: R(0.12, 0.38), alpha: R(0.12, 0.32),
            z: R(0.6, 1.1)
        }));
        glows = Array.from({ length: GLOWS_COUNT }, () => ({
            x: R(0, w), y: R(0, h),
            r: R(200, 500),
            alpha: R(0.06, 0.12)
        }));
    }

    function buildCaches() {
        if (!w || !h) return;

        // 1. Cache Sfondo
        bgCache = document.createElement('canvas');
        bgCache.width = Math.ceil(w);
        bgCache.height = Math.ceil(h);
        const bgCtx = bgCache.getContext('2d');
        
        const g = bgCtx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(40,10,50,1)');
        g.addColorStop(0.5, 'rgba(25,15,45,1)');
        g.addColorStop(1, 'rgba(20,10,35,1)');
        bgCtx.fillStyle = g;
        bgCtx.fillRect(0, 0, w, h);
        
        // 2. Cache Atmosfera
        atmosphereCache = document.createElement('canvas');
        atmosphereCache.width = Math.ceil(w);
        atmosphereCache.height = Math.ceil(h);
        const atmCtx = atmosphereCache.getContext('2d');
        atmCtx.globalCompositeOperation = 'lighter';
        
        glows.forEach(g => {
            const grd = atmCtx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
            grd.addColorStop(0, `rgba(200,100,255,${g.alpha})`);
            grd.addColorStop(1, 'transparent');
            atmCtx.fillStyle = grd;
            atmCtx.fillRect(0, 0, w, h);
        });
        
        for (let i = 0; i < 3; i++) {
            const x = w * 0.5 + R(-0.12, 0.12) * w;
            const y = h * 0.5 + R(-0.12, 0.12) * h;
            const r = R(60, 160);
            const grd = atmCtx.createRadialGradient(x, y, 0, x, y, r);
            grd.addColorStop(0, 'rgba(160,80,255,0.025)');
            grd.addColorStop(1, 'transparent');
            atmCtx.fillStyle = grd;
            atmCtx.fillRect(0, 0, w, h);
        }

        // Cache Gradienti Onde
        waveGrad = layers.map(L => {
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, `hsla(${L.hue},100%,55%,${L.alpha})`);
            grad.addColorStop(1, `hsla(${(L.hue + 25) % 360},85%,50%,${L.alpha})`);
            return grad;
        });
    }

    function resize() {
        // --- FIX IMPORTANTE: Forza lo stile via JS per evitare il taglio ---
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
        canvas.style.zIndex = '-1';
        canvas.style.pointerEvents = 'none'; // Permette il click attraverso il canvas
        // -------------------------------------------------------------------

        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;

        initEntities();
        buildCaches();
        t0 = performance.now();
    }

    const drawBackground = () => {
        if (bgCache) ctx.drawImage(bgCache, 0, 0);
    };

    const drawPulse = time => {
        const s = 0.45 + Math.sin(time * 0.0012) * 0.18;
        const rg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.45 * s);
        rg.addColorStop(0, 'rgba(180,80,255,0.07)');
        rg.addColorStop(1, 'rgba(20,10,35,0.95)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, w, h);
    };

    const drawGrid = time => {
        ctx.lineWidth = 1.0; 
        const mouseDist = Math.hypot(mouse.x - w / 2, mouse.y - h / 2);
        const mouseEffect = Math.min(mouseDist / (w * 0.4), 1); 
        const gridHue = 200 + (mouseEffect * 60); 
        const gridAlpha = 0.06 + (mouseEffect * 0.04); 
        ctx.strokeStyle = `hsla(${gridHue}, 100%, 75%, ${gridAlpha})`;

        grid.forEach(l => {
            const xOffset = (l.x - mouse.x) * mouseEffect * 0.05; 
            ctx.beginPath();
            ctx.moveTo(l.x + xOffset, l.y);
            ctx.lineTo(l.x + Math.sin(time * 0.0012 + l.x / 110) * 20 + xOffset, l.y + l.len);
            ctx.stroke();
            l.y += l.speed;
            if (l.y > h) { l.y = -l.len; l.x = R(0, w); }
        });
    };

    const drawWaves = time => {
        const step = Math.max(3, Math.round(w / 250));
        const mx = (mouse.x - w / 2) / (w / 2);
        const my = (mouse.y - h / 2) / (h / 2);
        const mouseInfluence = 1 + Math.hypot(mx, my) * 0.55;

        for (let i = 0; i < layers.length; i++) {
            const L = layers[i];
            ctx.beginPath();
            ctx.strokeStyle = waveGrad[i];
            ctx.lineWidth = L.thick;
            const timeOffset = time * L.speed;
            
            for (let x = 0; x <= w; x += step) {
                const base = Math.sin((x / (L.wave * w)) * Math.PI * 2 + timeOffset) * L.amp;
                const jitter = Math.sin(x * 0.02 + timeOffset * 3.5) * (L.amp * 0.09);
                const heat = Math.sin(time * 0.0016 + x * 0.0012 + (mx + my) * 1.0) * 7;
                const y = h * 0.5 + (base + jitter + heat) * mouseInfluence;
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    };

    const drawParticles = () => {
        particles.forEach(p => {
            const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
            const a = p.alpha + (d < 110 ? (110 - d) / 280 : 0);
            const finalAlpha = Math.min(1, a * p.z);
            
            ctx.beginPath();
            ctx.fillStyle = `rgba(255,180,255,${finalAlpha})`;
            ctx.arc(p.x, p.y, p.r * p.z, 0, Math.PI * 2);
            ctx.fill();
            
            p.y -= p.speed * p.z;
            if (p.y < -5) { p.y = h + 5; p.x = R(0, w); }
        });
    };

    const drawAtmosphere = time => {
        if (atmosphereCache) {
            const pulse = 0.75 + Math.sin(time * 0.001) * 0.25;
            ctx.globalAlpha = pulse;
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(atmosphereCache, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }
    };

    const drawScanlines = time => {
        const scanlineY = (time * 0.016) % 3;
        ctx.fillStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.025})`;
        for (let y = scanlineY; y < h; y += 3) {
            ctx.fillRect(0, y, w, 1);
        }
    };

    function clickPulse(x, y) {
        let r = 0, alpha = 0.85;
        const maxR = Math.min(w, h) * 0.75;
        function step() {
            r += 38; alpha *= 0.84;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = `hsla(270,100%,70%,${alpha})`;
            ctx.lineWidth = 1.2 + (alpha * 3.5);
            for (let s = 0; s < 4; s++) {
                const start = Math.PI * (0.6 + s * 0.25);
                const end = start + Math.PI * 0.7;
                ctx.beginPath();
                ctx.arc(x, y, r, start, end);
                ctx.stroke();
            }
            ctx.restore();
            if (alpha > 0.015 && r < maxR) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function loop(now) {
        if (!running) return;
        requestAnimationFrame(loop);
        
        const time = now - t0;
        
        mouse.x += (mouse.tx - mouse.x) * 0.09;
        mouse.y += (mouse.ty - mouse.y) * 0.09;

        ctx.globalCompositeOperation = 'source-over';
        // Non serve clearRect se disegniamo il bgCache opaco sopra, 
        // ma per sicurezza lo lasciamo o usiamo fillRect nero
        // ctx.clearRect(0, 0, w, h); 
        
        drawBackground();
        drawPulse(time);
        
        ctx.globalCompositeOperation = 'lighter';
        drawAtmosphere(time);
        drawGrid(time);
        drawWaves(time);
        drawParticles();
        
        ctx.globalCompositeOperation = 'overlay';
        drawScanlines(time);
        ctx.globalCompositeOperation = 'source-over';
    }
    
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(resize, 200); 
    }, { passive: true });

    window.addEventListener('mousemove', (e) => {
        mouse.tx = e.clientX;
        mouse.ty = e.clientY;
    }, { passive: true });

    window.addEventListener('click', (e) => {
        clickPulse(e.clientX, e.clientY);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
        running = !document.hidden;
        if (running) {
            // Fix: ricalcoliamo t0 per evitare salti temporali nell'animazione
            t0 = performance.now() - (lastTime || 0);
            requestAnimationFrame(loop);
        } else {
            // Salviamo il tempo corrente dell'animazione
            lastTime = performance.now() - t0;
        }
    });

    // AVVIO
    resize();
    requestAnimationFrame(loop);

})();
