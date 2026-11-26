/* 그림책 공방 — 자동 장면 그림
   배경: 인라인 SVG(400×300, xMidYMid slice). 인물·물건: 이모지 글자를 겹쳐 놓는다.
   주인공은 왼쪽 아래, 친구는 오른쪽 아래, 말썽꾼은 오른쪽 위, 물건은 위 가운데(최대 2개, 둥실).
   크기는 cqh 단위(container-type: size)로 장면 높이에 맞춘다.
   ※ 이모지 그림은 기기(iPad·안드로이드·윈도우)마다 다르게 보인다. 그림체를 고정하려면 SVG 그림 세트로 바꿔야 한다. */
(function (SL) {
  'use strict';
  var uid = 0;

  /* 배경 그림. g(id) 는 이 그림 안에서만 쓰는 그라데이션 이름 (같은 이름이 화면에 여러 번 있으면 숨은 쪽 것을 써서 안 보이는 일이 있다) */
  function sky(g, a, b) { return '<defs><linearGradient id="' + g + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="400" height="300" fill="url(#' + g + ')"/>'; }
  function cloud(x, y, s, c) { s = s || 1; c = c || '#fff'; return '<g fill="' + c + '" opacity=".92" transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><ellipse cx="0" cy="0" rx="26" ry="14"/><ellipse cx="22" cy="-8" rx="20" ry="16"/><ellipse cx="44" cy="0" rx="24" ry="13"/></g>'; }
  function stars(n, seed, color, h) {
    var r = SL.rng(seed), s = '';
    for (var i = 0; i < n; i++) s += '<circle cx="' + Math.round(r() * 400) + '" cy="' + Math.round(r() * (h || 200)) + '" r="' + (0.8 + r() * 1.8).toFixed(1) + '" fill="' + (color || '#fff') + '" opacity="' + (0.5 + r() * 0.5).toFixed(2) + '"/>';
    return s;
  }
  function flowers(seed, y0) {
    var r = SL.rng(seed), s = '', cols = ['#ff7aa8', '#ffd23f', '#ffffff', '#b98cff', '#ff9f43'];
    for (var i = 0; i < 26; i++) {
      var x = Math.round(r() * 400), y = Math.round(y0 + r() * (300 - y0));
      s += '<circle cx="' + x + '" cy="' + y + '" r="3.2" fill="' + cols[i % cols.length] + '"/><circle cx="' + x + '" cy="' + y + '" r="1.2" fill="#fff6c2"/>';
    }
    return s;
  }
  function tree(x, y, s, c) { s = s || 1; return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><rect x="-5" y="0" width="10" height="34" fill="#8a5a3b"/><polygon points="0,-62 -30,0 30,0" fill="' + (c || '#2f9e57') + '"/><polygon points="0,-82 -24,-30 24,-30" fill="' + (c || '#38b263') + '"/></g>'; }
  function house(x, y, c, roof) { return '<g transform="translate(' + x + ' ' + y + ')"><rect x="0" y="0" width="46" height="36" fill="' + c + '"/><polygon points="-6,0 23,-24 52,0" fill="' + roof + '"/><rect x="8" y="10" width="11" height="10" fill="#ffe27a"/><rect x="27" y="10" width="11" height="10" fill="#ffe27a"/></g>'; }

  var BG = {
    meadow: function (g) {
      return sky(g, '#8fd3ff', '#dff4ff') + '<circle cx="335" cy="58" r="30" fill="#ffd84d"/>' + cloud(60, 60) + cloud(220, 40, .8) +
        '<path d="M0 190 Q100 150 200 185 T400 175 V300 H0Z" fill="#8fd66b"/><path d="M0 225 Q120 195 240 225 T400 215 V300 H0Z" fill="#6cc24a"/>' + flowers(3, 230);
    },
    night: function (g) {
      return sky(g, '#0f1e4a', '#3b4f9b') + stars(60, 9, '#fff', 180) + '<circle cx="320" cy="62" r="26" fill="#fff6c9"/><circle cx="332" cy="54" r="24" fill="#22336e"/>' +
        '<rect y="236" width="400" height="64" fill="#1c2a5a"/>' + house(30, 200, '#3d4f8f', '#2a3a73') + house(130, 206, '#46599c', '#2a3a73') + house(250, 198, '#3d4f8f', '#2a3a73') + house(340, 208, '#46599c', '#2a3a73');
    },
    forest: function (g) {
      return sky(g, '#b6ecc9', '#e9fbef') + '<path d="M0 210 Q200 180 400 210 V300 H0Z" fill="#5fae5a"/>' +
        tree(30, 200, 1.1, '#2a8c4d') + tree(95, 190, .9) + tree(170, 205, 1.2, '#2a8c4d') + tree(250, 192, .95) + tree(330, 202, 1.15, '#2a8c4d') + tree(390, 190, .9) +
        '<rect y="250" width="400" height="50" fill="#4e9a4a"/>';
    },
    beach: function (g) {
      return sky(g, '#7fd0ff', '#d8f3ff') + '<circle cx="80" cy="60" r="28" fill="#ffd84d"/>' + cloud(240, 50, .9) +
        '<rect y="150" width="400" height="70" fill="#2fa3e0"/><path d="M0 160 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#bfe9ff" stroke-width="3" fill="none"/>' +
        '<path d="M0 210 Q200 190 400 212 V300 H0Z" fill="#f6dc9b"/><circle cx="300" cy="260" r="5" fill="#ff9ec4"/><circle cx="90" cy="270" r="4" fill="#fff"/>';
    },
    island: function (g) {
      return sky(g, '#7fd0ff', '#e6f7ff') + cloud(70, 55) + '<rect y="160" width="400" height="140" fill="#2196d8"/>' +
        '<ellipse cx="200" cy="232" rx="150" ry="34" fill="#f2d48f"/><path d="M196 230 Q204 170 222 132" stroke="#8a5a3b" stroke-width="9" fill="none"/>' +
        '<g fill="#2fa35a"><path d="M222 132 q-40 -6 -58 18 q30 -14 58 -18"/><path d="M222 132 q40 -8 60 14 q-30 -10 -60 -14"/><path d="M222 132 q-14 -34 -42 -38 q22 16 42 38"/><path d="M222 132 q16 -32 44 -34 q-24 14 -44 34"/></g>' +
        '<path d="M0 270 q25 -8 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0" stroke="#9bdcff" stroke-width="3" fill="none"/>';
    },
    space: function (g) {
      return sky(g, '#0b0b2b', '#2a1460') + stars(90, 4, '#fff', 300) + '<circle cx="300" cy="90" r="34" fill="#ff9f6b"/><ellipse cx="300" cy="90" rx="58" ry="12" fill="none" stroke="#ffd2a8" stroke-width="5" transform="rotate(-18 300 90)"/>' +
        '<circle cx="70" cy="230" r="18" fill="#7bd3ff"/><circle cx="64" cy="224" r="5" fill="#bdeaff"/>';
    },
    moon: function (g) {
      return sky(g, '#050822', '#1b1f4f') + stars(70, 5, '#fff', 200) + '<circle cx="320" cy="70" r="24" fill="#4aa3ff"/><path d="M308 62 q10 -8 20 4 q-6 8 -20 -4" fill="#4fbf6b"/>' +
        '<path d="M0 205 Q200 175 400 205 V300 H0Z" fill="#c9c9d6"/><ellipse cx="90" cy="245" rx="34" ry="10" fill="#a9a9ba"/><ellipse cx="260" cy="262" rx="44" ry="12" fill="#a9a9ba"/><ellipse cx="340" cy="228" rx="18" ry="6" fill="#a9a9ba"/>';
    },
    mars: function (g) {
      return sky(g, '#3a1630', '#c2563a') + stars(30, 6, '#ffd', 120) + '<circle cx="80" cy="70" r="14" fill="#ffe0b0"/>' +
        '<path d="M0 200 Q100 170 200 198 T400 190 V300 H0Z" fill="#c4502f"/><path d="M0 240 Q160 220 400 245 V300 H0Z" fill="#a63e24"/><circle cx="300" cy="230" r="14" fill="#8e331d"/><circle cx="120" cy="262" r="10" fill="#8e331d"/>';
    },
    starland: function (g) {
      var s = '', r = SL.rng(11);
      for (var i = 0; i < 14; i++) { var x = r() * 400, y = r() * 230, k = 4 + r() * 7; s += '<path transform="translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ') scale(' + (k / 10).toFixed(2) + ')" d="M0 -10 L3 -3 L10 -3 L4 2 L6 10 L0 5 L-6 10 L-4 2 L-10 -3 L-3 -3Z" fill="#ffe066"/>'; }
      return sky(g, '#3b1f7a', '#a86ee0') + stars(50, 12, '#fff', 300) + s + '<path d="M0 230 Q200 200 400 230 V300 H0Z" fill="#7d4fc7"/><path d="M0 262 Q200 240 400 262 V300 H0Z" fill="#6a3fb4"/>';
    },
    candy: function (g) {
      return sky(g, '#ffc7e6', '#fff0f7') + cloud(60, 60, 1, '#fff') + cloud(260, 46, .8, '#fff') +
        '<path d="M0 200 Q100 160 200 196 T400 186 V300 H0Z" fill="#ff9acb"/><path d="M0 236 Q140 210 260 236 T400 228 V300 H0Z" fill="#8fe3cf"/>' +
        '<g><rect x="78" y="150" width="6" height="70" fill="#fff"/><circle cx="81" cy="146" r="22" fill="#ff6fa8"/><path d="M81 146 m-14 0 a14 14 0 1 1 14 14" stroke="#fff" stroke-width="5" fill="none"/></g>' +
        '<g><rect x="318" y="160" width="6" height="64" fill="#fff"/><circle cx="321" cy="156" r="18" fill="#ffd23f"/><path d="M321 156 m-10 0 a10 10 0 1 1 10 10" stroke="#fff" stroke-width="4" fill="none"/></g>';
    },
    ice: function (g) {
      return sky(g, '#bfe6ff', '#f2fbff') + stars(20, 13, '#fff', 120) +
        '<polygon points="20,230 90,110 160,230" fill="#e6f7ff"/><polygon points="90,110 110,150 70,150" fill="#fff"/><polygon points="180,230 270,90 360,230" fill="#d4f0ff"/><polygon points="270,90 295,140 245,140" fill="#fff"/>' +
        '<rect y="225" width="400" height="75" fill="#a8dcf5"/><path d="M40 260 h80 M200 275 h110" stroke="#e8f8ff" stroke-width="4" stroke-linecap="round"/>';
    },
    rainbow: function (g) {
      var c = ['#ff5a5a', '#ff9f43', '#ffd23f', '#5ad16b', '#4aa3ff', '#8a6cff'], s = '';
      c.forEach(function (col, i) { s += '<path d="M40 240 A160 160 0 0 1 360 240" stroke="' + col + '" stroke-width="12" fill="none" transform="translate(0 ' + (i * 12) + ') scale(1 1)"/>'; });
      return sky(g, '#9fd8ff', '#fff4fb') + '<g transform="translate(0 -40)">' + s + '</g>' + cloud(30, 210, 1.2) + cloud(310, 205, 1.1) + '<path d="M0 250 Q200 230 400 250 V300 H0Z" fill="#c9f2c1"/>';
    },
    sea: function (g) {
      var bub = '', r = SL.rng(21);
      for (var i = 0; i < 16; i++) bub += '<circle cx="' + Math.round(r() * 400) + '" cy="' + Math.round(40 + r() * 200) + '" r="' + (2 + r() * 5).toFixed(1) + '" fill="none" stroke="#d8f4ff" stroke-width="1.5" opacity=".7"/>';
      return sky(g, '#1aa6d9', '#0b4f8a') + '<g fill="#fff" opacity=".12"><polygon points="60,0 100,0 40,300 0,300"/><polygon points="200,0 240,0 200,300 150,300"/><polygon points="330,0 370,0 400,200 400,300 360,300"/></g>' + bub +
        '<path d="M0 255 Q200 235 400 255 V300 H0Z" fill="#e8cf8f"/>' +
        '<g stroke="#2bb36b" stroke-width="7" fill="none" stroke-linecap="round"><path d="M40 262 q-12 -30 4 -60 q12 -24 -2 -50"/><path d="M360 262 q12 -26 -2 -54 q-10 -22 4 -44"/><path d="M330 266 q-8 -18 4 -36"/></g>' +
        '<circle cx="250" cy="262" r="9" fill="#ff7a8a"/><circle cx="268" cy="266" r="7" fill="#ffb347"/>';
    },
    castle: function (g) {
      return sky(g, '#a9dcff', '#eef8ff') + cloud(40, 50, .9) + cloud(300, 40) + '<path d="M0 240 Q200 220 400 240 V300 H0Z" fill="#7ccf5e"/>' +
        '<g fill="#c9c3d9"><rect x="120" y="120" width="160" height="120"/><rect x="100" y="90" width="44" height="150"/><rect x="256" y="90" width="44" height="150"/></g>' +
        '<g fill="#8f7fb3"><polygon points="96,90 122,46 148,90"/><polygon points="252,90 278,46 304,90"/><polygon points="170,120 200,80 230,120"/></g>' +
        '<path d="M200 80 V60 l18 6 -18 6" fill="#ff5a7a" stroke="#6b5a8f" stroke-width="2"/><path d="M180 240 v-36 a20 20 0 0 1 40 0 v36z" fill="#6b4f3a"/>' +
        '<rect x="114" y="130" width="14" height="20" fill="#ffe27a"/><rect x="272" y="130" width="14" height="20" fill="#ffe27a"/>';
    },
    room: function (g) {
      return sky(g, '#ffe9c9', '#fff6e6') + '<rect y="210" width="400" height="90" fill="#d7a66d"/><path d="M0 210 H400" stroke="#b9854d" stroke-width="4"/>' +
        '<rect x="250" y="40" width="100" height="80" rx="6" fill="#bfe7ff" stroke="#fff" stroke-width="8"/><path d="M300 40 V120 M250 80 H350" stroke="#fff" stroke-width="5"/>' +
        '<rect x="40" y="70" width="110" height="10" fill="#b9854d"/><rect x="50" y="48" width="14" height="22" fill="#ff7a8a"/><rect x="68" y="44" width="12" height="26" fill="#4aa3ff"/><rect x="84" y="50" width="16" height="20" fill="#5ad16b"/>' +
        '<ellipse cx="200" cy="262" rx="130" ry="22" fill="#ff9e9e" opacity=".55"/>';
    },
    party: function (g) {
      var flags = '', cols = ['#ff5a7a', '#ffd23f', '#4aa3ff', '#5ad16b', '#b98cff'];
      for (var i = 0; i < 10; i++) flags += '<polygon points="' + (i * 42 + 4) + ',' + (24 + Math.abs(5 - i) * 2) + ' ' + (i * 42 + 40) + ',' + (24 + Math.abs(5 - i) * 2) + ' ' + (i * 42 + 22) + ',' + (54 + Math.abs(5 - i) * 2) + '" fill="' + cols[i % 5] + '"/>';
      var balloons = [[40, 120, '#ff5a7a'], [76, 104, '#ffd23f'], [330, 112, '#4aa3ff'], [364, 128, '#5ad16b']].map(function (b) { return '<path d="M' + b[0] + ' ' + (b[1] + 26) + ' q6 30 -4 60" stroke="#888" fill="none"/><ellipse cx="' + b[0] + '" cy="' + b[1] + '" rx="18" ry="23" fill="' + b[2] + '"/>'; }).join('');
      return BG.room(g) + '<path d="M0 24 Q200 52 400 24" stroke="#c98a4b" stroke-width="2" fill="none"/>' + flags + balloons;
    },
    school: function (g) {
      return sky(g, '#5b3f9e', '#8a6cd1') + stars(26, 31, '#ffe9a8', 110) + '<rect y="215" width="400" height="85" fill="#4a3277"/>' +
        '<rect x="110" y="60" width="180" height="100" rx="6" fill="#2f5a46" stroke="#a7783f" stroke-width="8"/><path d="M140 100 l14 -14 l14 14 m20 0 h30 m-90 30 h60" stroke="#fff" stroke-width="3" fill="none" opacity=".8"/>' +
        '<g transform="translate(330 150)"><polygon points="0,-46 -22,0 22,0" fill="#3b2a6b"/><ellipse cx="0" cy="0" rx="30" ry="6" fill="#3b2a6b"/><path d="M-4 -30 l4 -6 l4 6" fill="#ffd23f"/></g>' +
        '<g transform="translate(40 190)"><rect width="18" height="26" fill="#ff7a8a"/><rect x="20" y="4" width="16" height="22" fill="#4aa3ff"/><rect x="38" y="-2" width="14" height="28" fill="#ffd23f"/></g>';
    },
    mountain: function (g) {
      return sky(g, '#9fd4ff', '#eaf6ff') + cloud(300, 60, .8) + '<polygon points="-20,250 110,80 240,250" fill="#7b8fa8"/><polygon points="110,80 140,120 80,120" fill="#fff"/>' +
        '<polygon points="150,250 290,60 430,250" fill="#5f7591"/><polygon points="290,60 324,108 256,108" fill="#fff"/><path d="M0 240 Q200 220 400 240 V300 H0Z" fill="#7ccf5e"/>';
    },
    volcano: function (g) {
      var smoke = '<g fill="#9a8f8f" opacity=".8"><circle cx="200" cy="60" r="20"/><circle cx="222" cy="40" r="16"/><circle cx="186" cy="34" r="13"/></g>';
      return sky(g, '#ffb067', '#ffe2b8') + smoke + '<polygon points="60,250 170,90 230,90 340,250" fill="#7a4b3a"/><path d="M170 90 h60 l-6 10 q-8 40 -20 70 q-8 -40 -28 -70z" fill="#ff5a1f"/>' +
        '<path d="M188 100 q-6 50 -24 90 M212 100 q8 46 30 82" stroke="#ff8a2a" stroke-width="7" fill="none"/><path d="M0 240 Q200 225 400 240 V300 H0Z" fill="#6b8f3f"/>';
    },
    jungle: function (g) {
      var leaf = function (x, y, rot, c) { return '<path transform="translate(' + x + ' ' + y + ') rotate(' + rot + ')" d="M0 0 q40 -30 90 0 q-40 22 -90 0z" fill="' + c + '"/>'; };
      return sky(g, '#bfeab0', '#effbe8') + '<path d="M0 220 Q200 200 400 220 V300 H0Z" fill="#4f9a3d"/>' +
        leaf(-10, 40, 20, '#2e8b3c') + leaf(-10, 120, -10, '#3aa047') + leaf(410, 50, 160, '#2e8b3c') + leaf(410, 140, 190, '#3aa047') + leaf(60, 240, -40, '#2e8b3c') + leaf(340, 250, -140, '#2e8b3c') +
        '<path d="M120 0 q10 60 -6 120 M290 0 q-12 50 6 110" stroke="#3a7a2a" stroke-width="4" fill="none"/>';
    },
    field: function (g) {
      var flags = '', cols = ['#ff5a7a', '#ffd23f', '#4aa3ff', '#5ad16b'];
      for (var i = 0; i < 9; i++) flags += '<polygon points="' + (i * 46 + 8) + ',30 ' + (i * 46 + 38) + ',30 ' + (i * 46 + 23) + ',52" fill="' + cols[i % 4] + '"/>';
      return sky(g, '#8fd3ff', '#e9f7ff') + '<path d="M0 30 Q200 44 400 30" stroke="#999" fill="none"/>' + flags +
        '<rect y="170" width="400" height="130" fill="#6cc24a"/><ellipse cx="200" cy="250" rx="230" ry="62" fill="#e4874b"/><ellipse cx="200" cy="250" rx="180" ry="38" fill="#6cc24a"/>' +
        '<ellipse cx="200" cy="250" rx="205" ry="50" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="8 6"/>';
    },
    circus: function (g) {
      var stripes = '';
      for (var i = 0; i < 8; i++) stripes += '<polygon points="200,40 ' + (60 + i * 35) + ',200 ' + (77 + i * 35) + ',200" fill="' + (i % 2 ? '#fff' : '#ff4d5e') + '"/>';
      return sky(g, '#ffd6a5', '#fff1dc') + stars(18, 41, '#fff', 120) + '<path d="M0 230 Q200 214 400 230 V300 H0Z" fill="#8fd66b"/>' +
        '<g>' + stripes + '<rect x="60" y="198" width="280" height="44" fill="#ff4d5e"/><path d="M60 198 h280" stroke="#ffd23f" stroke-width="6"/><path d="M200 40 v-22 l20 8 -20 8" fill="#ffd23f" stroke="#c33" stroke-width="2"/></g>' +
        '<path d="M178 242 v-30 a22 22 0 0 1 44 0 v30z" fill="#5a1f2b"/>';
    }
  };
  SL.BG = BG;

  function bgSVG(name) {
    var f = BG[name] || BG.meadow;
    var g = 'g' + (++uid);
    return '<svg class="bgsvg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + f(g) + '</svg>';
  }
  SL.bgSVG = bgSVG;

  function span(cls, text, style) {
    var s = document.createElement('span');
    s.className = cls; s.textContent = text;
    if (style) s.setAttribute('style', style);
    return s;
  }

  /* 장면 DOM 만들기. sc = { bg, tm, cast:[주인공, 친구…], vil, obj:[…], mood, guest }
     opts.cover: 표지(주인공을 크게) */
  function renderScene(sc, opts) {
    opts = opts || {};
    var root = document.createElement('div');
    root.className = 'scene tm-' + (sc.tm || 'day') + ' mood-' + (sc.mood || 'calm') + (opts.cover ? ' cover' : '');
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', '장면 그림');
    root.dataset.bg = sc.bg;
    var bg = document.createElement('div');
    bg.className = 'bg';
    bg.innerHTML = bgSVG(sc.bg); /* 미리 정해 둔 그림만 넣는다(아이 입력 없음) */
    root.appendChild(bg);
    root.appendChild(Object.assign(document.createElement('div'), { className: 'tint' }));
    var cast = sc.cast || [];
    if (opts.cover) {
      root.appendChild(span('ch hero big', cast[0] || '🙂'));
      cast.slice(1, 4).forEach(function (e, i) { root.appendChild(span('ch mini', e, 'right:' + (6 + i * 15) + '%')); });
    } else {
      var n = cast.length, size = n <= 2 ? 32 : n === 3 ? 28 : n === 4 ? 25 : 22;
      root.appendChild(span('ch hero', cast[0] || '🙂', 'font-size:' + size + 'cqh;left:14%'));
      var others = cast.slice(1);
      others.forEach(function (e, i) {
        /* 오른쪽 끝부터 왼쪽으로 차례로 */
        var right = 86 - i * (n <= 3 ? 22 : 17);
        root.appendChild(span('ch friend', e, 'font-size:' + size + 'cqh;left:' + right + '%;animation-delay:' + (i * 0.3) + 's'));
      });
      if (sc.guest) root.appendChild(span('ch guest', sc.guest, 'font-size:' + Math.round(size * 0.8) + 'cqh'));
      if (sc.vil) root.appendChild(span('ch vil', sc.vil));
      (sc.obj || []).slice(0, 2).forEach(function (e, i, arr) {
        var left = arr.length === 1 ? 50 : (i === 0 ? 40 : 60);
        root.appendChild(span('ob', e, 'left:' + left + '%;animation-delay:' + (i * 0.6) + 's'));
      });
    }
    if (sc.mood === 'happy') {
      var sp = document.createElement('div');
      sp.className = 'spark';
      ['12%,18%', '82%,14%', '30%,8%', '68%,30%', '50%,4%'].forEach(function (p, i) {
        var xy = p.split(',');
        sp.appendChild(span('sp', '✨', 'left:' + xy[0] + ';top:' + xy[1] + ';animation-delay:' + (i * 0.35) + 's'));
      });
      root.appendChild(sp);
    }
    return root;
  }
  SL.renderScene = renderScene;

  /* 책 한 권의 쪽 목록: [표지, 문장 쪽…, 마지막 장면, 끝] (마지막 장면은 문장 쪽의 마지막) */
  function buildBook(book) {
    var pages = Array.isArray(book.pages) && book.pages.length ? book.pages : SL.story.compose(book);
    var first = pages[0] && pages[0].sc ? pages[0].sc : { bg: 'meadow', cast: ['🙂'] };
    var coverBg = (pages[2] && pages[2].sc && pages[2].sc.bg) || first.bg;
    var lastSc = pages[pages.length - 1] ? pages[pages.length - 1].sc : first;
    var list = [{ kind: 'cover', sc: { bg: coverBg, tm: 'day', cast: lastSc.cast, obj: [], mood: 'happy' } }];
    pages.forEach(function (p) {
      var se = SL.splitEmoji(p.t);
      list.push({ kind: 'text', t: se.text, part: p.part, sc: p.sc });
    });
    list.push({ kind: 'end', sc: { bg: lastSc.bg, tm: lastSc.tm, cast: lastSc.cast, obj: [], mood: 'happy' } });
    return list;
  }
  SL.buildBook = buildBook;
})(window.SL);
