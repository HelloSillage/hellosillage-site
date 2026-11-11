(function () {
    "use strict";
    var cv = document.getElementById("bg");
    var ctx = cv && cv.getContext("2d");
    if (!ctx) return;

    // ---- Réglages ----
    var CYCLE = 120;          // durée de la boucle (s)
    var DISTRICT = 30;        // durée d'un quartier (s)
    var MAX = 70;             // nombre maximum de tracés simultanés
    var LINE = "#d2d3d8";     // couleur des traits
    var HOT = "#2ecc71";      // couleur des tracés « spéciaux »
    var HOT_CHANCE = 0.025;    // probabilité qu'un tracé soit spécial
    var DISTRICTS = [         // orientation de la grille + zone d'apparition (fractions de l'écran)
        { th: 0.12, fx: 0.30, fy: 0.35 },
        { th: -0.38, fx: 0.72, fy: 0.40 },
        { th: 0.62, fx: 0.62, fy: 0.72 },
        { th: -0.10, fx: 0.28, fy: 0.66 }
    ];

    var Q = Math.PI / 4, SQ2 = Math.SQRT2;
    var W = 0, H = 0, DPR = 1, U = 1, C = 70;
    var agents = [], T = 0;
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function rnd(a, b) { return a + Math.random() * (b - a); }

    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth; H = window.innerHeight;
        cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
        U = Math.max(0.6, Math.min(1.5, Math.min(W, H) / 800));
        C = 70 * U; // taille d'une « cellule » de la grille
        if (reduced) render();
    }

    function district() { return DISTRICTS[Math.floor((T % CYCLE) / DISTRICT)]; }

    // Cale un point sur la grille orientée d'un angle th
    function snap(x, y, th) {
        var c = Math.cos(th), s = Math.sin(th);
        var rx = Math.round((x * c + y * s) / C) * C;
        var ry = Math.round((-x * s + y * c) / C) * C;
        return { x: rx * c - ry * s, y: rx * s + ry * c };
    }

    // Longueur d'un tronçon : 1 à 4 cellules (diagonale : ×√2, pour retomber sur la grille)
    function seg(diag) { return (1 + Math.floor(Math.random() * 4)) * C * (diag ? SQ2 : 1); }

    function make(x, y, ang, diag, gen) {
        var hot = Math.random() < HOT_CHANCE;
        return {
            v: [{ x: x, y: y, s: 0 }],           // sommets déjà posés (s = distance parcourue)
            x: x, y: y, ang: ang, diag: diag, gen: gen,
            len: 0, tail: 0, alive: true, hot: hot,
            speed: rnd(70, 120) * U,
            trail: rnd(12, 22) * C / (1 + gen * 0.35) * (hot ? 1.5 : 1),   // longueur visible du tracé
            maxLen: rnd(26, 48) * C / (1 + gen * 0.45) * (hot ? 1.5 : 1),  // distance avant arrêt de la tête
            nextTurn: seg(diag),
            w: [1.5, 1.1, 0.8, 0.7][gen] * (hot ? 1.7 : 1),
            al: hot ? 0.85 : [0.5, 0.38, 0.28, 0.24][gen]
        };
    }

    function spawnRoot() {
        var d = district(), x, y;
        if (Math.random() < 0.75) {
            x = (d.fx + (Math.random() + Math.random() - 1) * 0.35) * W;
            y = (d.fy + (Math.random() + Math.random() - 1) * 0.35) * H;
        } else { x = Math.random() * W; y = Math.random() * H; }
        var p = snap(x, y, d.th);
        agents.push(make(p.x, p.y, d.th + Math.floor(Math.random() * 4) * Math.PI / 2, false, 0));
    }

    function pick(ang, diag) {
        var s = Math.random() < 0.5 ? 1 : -1;
        if (diag) return { ang: ang + s * Q, diag: false };                 // retour sur la grille
        if (Math.random() < 0.2) return { ang: ang + s * Q, diag: true };   // départ en diagonale
        return { ang: ang + s * 2 * Q, diag: false };                       // virage à 90°
    }

    function turn(a) {
        a.v.push({ x: a.x, y: a.y, s: a.len });
        var n = pick(a.ang, a.diag);
        if (a.gen < 3 && agents.length < MAX && Math.random() < 0.28) {   // embranchement
            var child = Math.random() < 0.3
                ? make(a.x, a.y, a.ang, a.diag, a.gen + 1)                    // tout droit
                : make(a.x, a.y, a.ang - (n.ang - a.ang), n.diag, a.gen + 1); // de l'autre côté
            agents.push(child);
        }
        a.ang = n.ang; a.diag = n.diag;
        a.nextTurn = a.len + seg(a.diag);
    }

    function step(a, dt) {
        var d = a.speed * dt;
        if (a.alive) {
            var rem = d;
            while (rem > 1e-6 && a.alive) {
                var ev = Math.min(a.nextTurn, a.maxLen);
                var m = Math.min(rem, Math.max(ev - a.len, 0));
                a.x += Math.cos(a.ang) * m; a.y += Math.sin(a.ang) * m;
                a.len += m; rem -= m;
                if (a.len >= ev - 1e-6) { if (ev >= a.maxLen) a.alive = false; else turn(a); }
            }
            if (a.x < -150 || a.x > W + 150 || a.y < -150 || a.y > H + 150) a.alive = false;
            var ex = a.len - a.trail;
            if (ex > a.tail) a.tail = ex;                 // la queue suit la tête
        } else {
            a.tail = Math.min(a.len, a.tail + d * 1.15);  // tête arrêtée : la queue la rattrape
        }
        while (a.v.length > 1 && a.v[1].s <= a.tail) a.v.shift();
    }

    function update(dt) {
        T += dt;
        var n = agents.length;
        for (var i = 0; i < n; i++) step(agents[i], dt);
        agents = agents.filter(function (a) { return a.alive || a.tail < a.len - 0.5; });
        var roots = 0;
        for (var j = 0; j < agents.length; j++) if (agents[j].alive && agents[j].gen === 0) roots++;
        var target = Math.max(5, Math.min(14, Math.round(W * H / 110000)));
        if (roots < target && agents.length < MAX && Math.random() < dt * 1.2) spawnRoot();
    }

    // Trace la portion du tracé comprise entre les distances s0 et s1
    function strokeRange(a, s0, s1, alpha) {
        if (s1 <= s0) return;
        var pts = a.v, n = pts.length, started = false;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (var i = 0; i < n; i++) {
            var p = pts[i], q = i + 1 < n ? pts[i + 1] : { x: a.x, y: a.y, s: a.len };
            if (q.s <= s0 || p.s >= s1) continue;
            var L = q.s - p.s; if (L <= 0) continue;
            var t0 = Math.max(s0, p.s), t1 = Math.min(s1, q.s);
            var x0 = p.x + (q.x - p.x) * (t0 - p.s) / L, y0 = p.y + (q.y - p.y) * (t0 - p.s) / L;
            var x1 = p.x + (q.x - p.x) * (t1 - p.s) / L, y1 = p.y + (q.y - p.y) * (t1 - p.s) / L;
            if (!started) { ctx.moveTo(x0, y0); started = true; } else ctx.lineTo(x0, y0);
            ctx.lineTo(x1, y1);
        }
        ctx.stroke();
    }

    function render() {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.lineCap = "butt"; ctx.lineJoin = "round";
        for (var i = 0; i < agents.length; i++) {
            var a = agents[i];
            ctx.lineWidth = a.w;
            ctx.strokeStyle = a.hot ? HOT : LINE;
            ctx.fillStyle = a.hot ? HOT : LINE;
            var F = Math.min(260 * U, a.len - a.tail), K = 10;       // zone de fondu de la queue
            for (var k = 0; k < K; k++) {
                strokeRange(a, a.tail + F * k / K, a.tail + F * (k + 1) / K, a.al * (k + 0.5) / K);
            }
            strokeRange(a, a.tail + F, a.len, a.al);
            if (a.alive) {                                            // la tête
                ctx.globalAlpha = 0.9;
                ctx.beginPath(); ctx.arc(a.x, a.y, a.w * 1.1 + 0.4, 0, 6.2832); ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    // ---- Démarrage ----
    resize();
    window.addEventListener("resize", resize);
    for (var i = 0; i < 300; i++) update(0.1); // préchauffage : l'écran n'est pas vide au chargement
    render();
    if (reduced) return;

    var last = performance.now();
    function frame(now) {
        var dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        update(dt); render();
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();