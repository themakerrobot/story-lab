/* 그림책 공방 — 펜 선 그림 (ai-lab icons.js 와 같은 문법: .ln 검은 펜, .ac 메뉴 색 펜, .fl 옅은 칠)
   미리 정해 둔 그림만 innerHTML 로 넣는다(아이 입력 없음) */
(function (SL) {
  'use strict';
  var I = {
    book: '<path class="fl" d="M40 12 C30 8 18 8 10 11 V48 C18 45 30 45 40 49Z"/><path class="ln" d="M40 12 C30 8 18 8 10 11 V48 C18 45 30 45 40 49 C50 45 62 45 70 48 V11 C62 8 50 8 40 12Z M40 12 V49"/><path class="ac" d="M17 20 h15 M17 27 h12 M48 20 h15 M48 27 h10"/><path class="ac" d="M56 36 l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1z"/>',
    shelf: '<path class="ln" d="M8 50 H72 M8 28 H72"/><rect class="ln" x="12" y="8" width="8" height="20"/><rect class="ln" x="21" y="11" width="7" height="17"/><path class="ac" d="M31 27 l6-17 6 2-6 17z"/><rect class="ln" x="48" y="10" width="9" height="18"/><rect class="ln" x="14" y="32" width="10" height="18"/><rect class="ac" x="26" y="35" width="8" height="15"/><rect class="ln" x="52" y="31" width="8" height="19"/>',
    echo: '<path class="ln" d="M14 18 a10 10 0 0 1 20 0 c0 7-6 9-6 15 0 4-3 7-7 7"/><path class="ln" d="M22 18 a3 3 0 0 1 6 0"/><path class="ac" d="M42 14 q6 8 0 16 M50 9 q11 13 0 26"/><path class="ac dash" d="M36 46 h30"/><path class="ln" d="M62 41 l5 5-5 5"/>',
    words: '<text class="t-ink" x="6" y="30">바</text><text class="t-acc" x="30" y="30">스</text><text class="t-ink" x="54" y="30">락</text><path class="ac" d="M6 40 q6-6 12 0 t12 0 t12 0 t12 0 t12 0"/><path class="ln dash" d="M6 50 h66"/>',
    map: '<rect class="ln" x="4" y="14" width="15" height="24" rx="2"/><rect class="ac" x="23" y="14" width="15" height="24" rx="2"/><rect class="ln" x="42" y="14" width="15" height="24" rx="2"/><rect class="ln" x="61" y="14" width="15" height="24" rx="2"/><path class="ln" d="M8 22 h7 M8 28 h5 M27 22 h7 M46 22 h7 M65 22 h7 M65 28 h4"/><path class="ac dash" d="M11 46 H69"/>',
    quiz: '<rect class="ln" x="10" y="8" width="60" height="42" rx="4"/><path class="ac" d="M33 22 a7 7 0 1 1 9 6 c-2 1-2 3-2 5"/><circle class="dot" cx="40" cy="40" r="2"/><path class="ln" d="M18 18 h8 M54 18 h8"/>',
    flow: '<rect class="ln" x="26" y="2" width="28" height="12" rx="6"/><path class="ln" d="M40 14 v6"/><path class="ac" d="M40 20 l12 8-12 8-12-8z"/><path class="ln" d="M28 28 H14 v14 M52 28 h14 v14"/><rect class="ln" x="6" y="42" width="16" height="10" rx="2"/><rect class="ln" x="58" y="42" width="16" height="10" rx="2"/>',
    video: '<rect class="ln" x="8" y="12" width="48" height="34" rx="3"/><path class="ac" d="M28 22 l12 7-12 7z"/><path class="ln" d="M56 24 l14-8 v26 l-14-8"/><path class="ln dash" d="M8 52 h48"/>'
  };
  SL.icon = function (name, cls) {
    var wrap = document.createElement('span');
    wrap.innerHTML = '<svg class="ill ' + (cls || '') + '" viewBox="0 0 80 58" aria-hidden="true">' + (I[name] || '') + '</svg>';
    return wrap.firstChild;
  };
  /* 빨간 펜 동그라미 (첫 화면 "여기서 시작!") */
  SL.ring = function () {
    var wrap = document.createElement('span');
    wrap.innerHTML = '<svg class="ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M52 6 C80 4 97 22 95 50 C93 80 72 96 46 95 C18 94 4 74 6 48 C8 24 24 9 50 7 C60 6 70 9 76 13"/></svg>';
    return wrap.firstChild;
  };
})(window.SL);
