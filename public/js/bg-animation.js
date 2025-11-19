(function cyberNexusVioletVortex_improved() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas || innerWidth <= 960) return;
    const ctx = canvas.getContext('2d', { alpha: true });

    // Sizes & DPR
    let w = 0, h = 0;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    // Time & loop
    let t0 = performance.now();
    let running = true;
    let last = 0;
    const TARGET_FPS = 60;
    const MIN_DELTA = 1000 / TARGET_FPS;

    // Input / mouse
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // Caches & data
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

    // ---------------------------
    // Entities init (single source)
    // ---------------------------
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
            x: R(0, w), y: R(0, h), r: R(200, 500), alpha: R(0.06, 0.12)
        }));
        // center mouse initially
        mouse.x = mouse.tx = w / 2;
        mouse.y = mouse.ty = h / 2;
    }

    // ---------------------------
    // Build caches (bg, atmosphere, gradients)
    // ---------------------------
    function createCanvasCache(widthPx, heightPx) {
        // Prefer OffscreenCanvas when available
        if (typeof OffscreenCanvas !== 'undefined') {
            return new OffscreenCanvas(widthPx, heightPx);
        }
        const c = document.createElement('canvas');
        c.width = widthPx;
        c.height = heightPx;
        return c;
    }

    function buildCaches() {
        // background cache
        const bgWpx = Math.round(w * DPR);
        const bgHpx = Math.round(h * DPR);
        bgCache = createCanvasCache(bgWpx, bgHpx);
        const bgCtx = bgCache.getContext('2d');
        bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0); // scale once
        const g = bgCtx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(40,10,50,1)');
        g.addColorStop(0.5, 'rgba(25,15,45,1)');
        g.addColorStop(1, 'rgba(20,10,35,1)');
        bgCtx.fillStyle = g;
        bgCtx.fillRect(0, 0, w, h);

        // atmosphere / glows cache
        atmosphereCache = createCanvasCache(bgWpx, bgHpx);
        const atmCtx = atmosphereCache.getContext('2d');
        atmCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        atmCtx.globalCompositeOperation = 'lighter';

        glows.forEach(glo => {
            const grd = atmCtx.createRadialGradient(glo.x, glo.y, 0, glo.x, glo.y, glo.r);
            grd.addColorStop(0, `rgba(200,100,255,${glo.alpha})`);
            grd.addColorStop(1, 'transparent');
            atmCtx.fillStyle = grd;
            // fill a bounding rect rather than full fillRect for a tiny perf win
            atmCtx.fillRect(glo.x - glo.r, glo.y - glo.r, glo.r * 2, glo.r * 2);
        });

        // subtle vapore layers
        for (let i = 0; i < 3; i++) {
            const x = w * 0.5 + R(-0.12, 0.12) * w;
            const y = h * 0.5 + R(-0.12, 0.12) * h;
            const r = R(60, 160);
            const grd = atmCtx.createRadialGradient(x, y, 0, x, y, r);
            grd.addColorStop(0, 'rgba(160,80,255,0.025)');
            grd.addColorStop(1, 'transparent');
            atmCtx.fillStyle = grd;
            atmCtx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        atmCtx.globalCompositeOperation = 'source-over';

        // Precreate wave gradients ONCE (use main ctx to create compatible gradients)
        waveGrad = layers.map(L => {
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, `hsla(${L.hue},100%,55%,${L.alpha})`);
            grad.addColorStop(1, `hsla(${(L.hue + 25) % 360},85%,50%,${L.alpha})`);
            return grad;
        });
    }

    // Resize handler (single place to reinit)
    function resize() {
        w = canvas.width = Math.round(innerWidth * DPR) / DPR;
        h = canvas.height = Math.round(innerHeight * DPR) / DPR;
        // set CSS size in device pixels to be sharp on hi-dpi
        canvas.style.width = innerWidth + 'px';
        canvas.style.height = innerHeight + 'px';

        // Recreate entities & caches
        initEntities();
        buildCaches();
        t0 = performance.now();
        last = t0;
    }

    // ---------------------------
    // Drawing helpers
    // ---------------------------
    const drawBackground = () => {
        if (!bgCache) return;
        // drawImage accepts OffscreenCanvas too
        ctx.drawImage(bgCache, 0, 0, w, h);
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

        // local vars pulled out for speed
        const mX = mouse.x, mY = mouse.y;
        const timeFactor = time * 0.0012;
        for (let i = 0; i < grid.length; i++) {
            const l = grid[i];
            const xOffset = (l.x - mX) * mouseEffect * 0.05;
            ctx.beginPath();
            ctx.moveTo(l.x + xOffset, l.y);
            ctx.lineTo(l.x + Math.sin(timeFactor + l.x / 110) * 20 + xOffset, l.y + l.len);
            ctx.stroke();
            l.y += l.speed;
            if (l.y > h) { l.y = -l.len; l.x = R(0, w); }
        }
    };

    const drawWaves = time => {
        const step = Math.max(3, Math.round(w / 250));
        const mx = (mouse.x - w / 2) / (w / 2);
        const my = (mouse.y - h / 2) / (h / 2);
        const mouseVecLen = Math.hypot(mx, my);
        const mouseInfluenceBase = 1 + mouseVecLen * 0.55;
        for (let i = 0; i < layers.length; i++) {
            const L = layers[i];
            ctx.beginPath();
            ctx.strokeStyle = waveGrad[i];
            ctx.lineWidth = L.thick;
            const timeOffset = time * L.speed;
            let first = true;
            for (let x = 0; x <= w; x += step) {
                const base = Math.sin((x / (L.wave * w)) * Math.PI * 2 + timeOffset) * L.amp;
                const jitter = Math.sin(x * 0.02 + timeOffset * 3.5) * (L.amp * 0.09);
                const heat = Math.sin(time * 0.0016 + x * 0.0012 + (mx + my) * 1.0) * 7;
                const y = h * 0.5 + (base + jitter + heat) * (mouseInfluenceBase);
                if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    };

    const drawParticles = () => {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const dx = p.x - mouse.x;
            const dy = p.y - mouse.y;
            const d = Math.hypot(dx, dy);
            const a = p.alpha + (d < 110 ? (110 - d) / 280 : 0);
            const r = p.r * p.z;
            const finalAlpha = Math.min(1, a * p.z);
            ctx.beginPath();
            ctx.fillStyle = `rgba(255,180,255,${finalAlpha})`;
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            p.y -= p.speed * p.z;
            if (p.y < -5) { p.y = h + 5; p.x = R(0, w); }
        }
    };

    const drawAtmosphere = time => {
        if (!atmosphereCache) return;
        const pulse = 0.75 + Math.sin(time * 0.001) * 0.25;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(atmosphereCache, 0, 0, w, h);
        ctx.restore();
    };

    const drawScanlines = time => {
        const scanlineY = (time * 0.016) % 3;
        ctx.globalAlpha = 1;
        // small randomized alpha flicker for subtlety (cheap)
        const alphaBase = 0.025 + (Math.random() * 0.025);
        ctx.fillStyle = `rgba(255,255,255,${alphaBase})`;
        for (let y = scanlineY; y < h; y += 3) {
            ctx.fillRect(0, y, w, 1);
        }
    };

    // Click pulse (keeps same signature)
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

    // ---------------------------
    // Main loop (throttled to TARGET_FPS)
    // ---------------------------
    function loop(now) {
        if (!running) return;
        requestAnimationFrame(loop);
        const dt = now - last;
        if (dt < MIN_DELTA) return;
        // align last to a multiple to avoid micro-drift
        last = now - (dt % MIN_DELTA);

        const time = now - t0;

        // smooth mouse interpolation
        mouse.x += (mouse.tx - mouse.x) * 0.09;
        mouse.y += (mouse.ty - mouse.y) * 0.09;
        mouse.x = clamp(mouse.x, 0, w);
        mouse.y = clamp(mouse.y, 0, h);

        // draw sequence
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, w, h);

        drawBackground();
        drawPulse(time);

        // additive elements
        drawAtmosphere(time);

        // grid + waves + particles are additive visually
        ctx.globalCompositeOperation = 'lighter';
        drawGrid(time);
        drawWaves(time);
        drawParticles();

        // overlay scanlines
        ctx.globalCompositeOperation = 'overlay';
        drawScanlines(time);

        // ensure default composite restored
        ctx.globalCompositeOperation = 'source-over';
    }

    // ---------------------------
    // Events (mouse + touch + visibility)
    // ---------------------------
    function onPointerMove(clientX, clientY) {
        mouse.tx = clamp(clientX, 0, w);
        mouse.ty = clamp(clientY, 0, h);
    }

    window.addEventListener('resize', () => {
        // throttle small resizes with requestAnimationFrame
        requestAnimationFrame(resize);
    }, { passive: true });

    window.addEventListener('mousemove', (e) => {
        onPointerMove(e.clientX, e.clientY);
    }, { passive: true });

    // touch support (maps first touch to mouse)
    window.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        if (t) onPointerMove(t.clientX, t.clientY);
    }, { passive: true });
    window.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        if (t) onPointerMove(t.clientX, t.clientY);
    }, { passive: true });

    window.addEventListener('click', (e) => {
        clickPulse(e.clientX, e.clientY);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
        running = !document.hidden;
        if (running) {
            t0 = performance.now() - (last || 0);
            requestAnimationFrame(loop);
        }
    });

    // ---------------------------
    // Start
    // ---------------------------
    // single proper startup flow
    resize();
    requestAnimationFrame(loop);
})();
