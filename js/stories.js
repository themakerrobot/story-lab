/* 그림책 공방 — 이야기 카드와 조립 엔진
   주인공·해결 카드와 이야기 8종의 글감은 yjworks/kids-lab 의 "이야기 만들기"(apps/story)에서 가져와 넓혔다.
   고정 순서 대신 "상태 기반 조립": 카드마다 나오는 조건(req)과 바꾸는 상태가 있고,
   앞에서 고른 카드(장소, 친구, 가방 속 물건, 말썽꾼)에 따라 뒤에 나오는 카드와 결말이 달라진다.

   이야기 뼈대: [처음] 주인공 → 바람 → 물건 → 장소 → 친구
               [사건 i] (장소 옮기기) → (친구 합류) → (말썽꾼) → 무슨 일 → 기분 → 해결
               [끝] 바람의 결과 → 성장 → 마지막 장면 */
(function (SL) {
  'use strict';
  var fmt = SL.fmt, J = SL.J;

  /* ---------- 주인공 (kids-lab HEROES 12종) ---------- */
  var HEROES = [['rabbit', '🐰', '토끼'], ['bear', '🐻', '곰'], ['fox', '🦊', '여우'], ['frog', '🐸', '개구리'], ['robot', '🤖', '로봇'],
    ['girl', '👧', '소녀'], ['boy', '👦', '소년'], ['unicorn', '🦄', '유니콘'], ['dragon', '🐉', '아기 용'], ['penguin', '🐧', '펭귄'],
    ['cat', '🐱', '고양이'], ['dino', '🦖', '공룡']].map(function (a) { return { id: a[0], e: a[1], n: a[2] }; });

  /* ---------- 성격: 처음 소개와 끝의 "성장" 문장이 달라진다 ---------- */
  var TRAITS = [
    { id: 'brave', e: '💪', n: '씩씩한', adj: '씩씩한', t: '{H:은/는} 무엇이든 씩씩하게 해 보는 아이였어요.' },
    { id: 'shy', e: '😳', n: '겁 많은', adj: '겁 많은', t: '{H:은/는} 작은 소리에도 깜짝깜짝 놀라곤 했어요.' },
    { id: 'curious', e: '🧐', n: '궁금한 게 많은', adj: '궁금한 게 많은', t: '{H:은/는} 궁금한 게 생기면 꼭 알아봐야 직성이 풀렸어요.' },
    { id: 'playful', e: '😜', n: '장난꾸러기', adj: '장난꾸러기', t: '{H:은/는} 장난치는 걸 세상에서 제일 좋아했어요.' },
    { id: 'gentle', e: '🥰', n: '마음씨 고운', adj: '마음씨 고운', t: '{H:은/는} 친구를 잘 도와주는 마음 따뜻한 아이였어요.' }
  ];

  /* ---------- 가방 속 물건: 나중에 해결 카드로 다시 나온다 (원인 → 결과) ---------- */
  var ITEMS = [
    { id: 'flashlight', e: '🔦', n: '손전등', tags: ['light', 'find'], use: '딸깍! 불을 켜자 주위가 환해졌어요.' },
    { id: 'rope', e: '🪢', n: '밧줄', tags: ['rope'], use: '밧줄을 휙 던져 단단히 묶었어요.' },
    { id: 'umbrella', e: '🌂', n: '무지개 우산', tags: ['rain'], use: '우산을 활짝 펼쳤어요.' },
    { id: 'map', e: '🗺️', n: '보물 지도', tags: ['map'], use: '지도를 펼쳐 손가락으로 길을 따라가 봤어요.' },
    { id: 'cookie', e: '🍪', n: '쿠키', tags: ['food', 'kind'], use: '맛있는 쿠키를 꺼내 모두 사이좋게 나누어 먹었어요.' },
    { id: 'scarf', e: '🧣', n: '목도리', tags: ['warm'], use: '목도리를 꺼내 서로 포근하게 감싸 주었어요.' },
    { id: 'wand', e: '🪄', n: '마법 지팡이', tags: ['magic'], use: '지팡이를 빙글빙글 돌리며 "반짝반짝 얍!" 하고 주문을 외웠어요.' },
    { id: 'guitar', e: '🎸', n: '기타', tags: ['music'], use: '기타를 띠링띠링 신나게 연주했어요.' },
    { id: 'magnifier', e: '🔍', n: '돋보기', tags: ['find'], use: '돋보기를 대고 구석구석 꼼꼼히 살펴봤어요.' },
    { id: 'balloon', e: '🎈', n: '풍선', tags: ['fly'], use: '풍선 끈을 꼭 잡자 몸이 둥실 떠올랐어요.' },
    { id: 'toolbox', e: '🧰', n: '연장통', tags: ['fix'], use: '연장을 꺼내 뚝딱뚝딱 고쳤어요.' },
    { id: 'telescope', e: '🔭', n: '망원경', tags: ['map', 'find'], use: '망원경으로 멀리멀리 내다봤어요.' }
  ];

  /* ---------- 때: 장면 색이 바뀐다 ---------- */
  var TIMES = [
    { id: 'morning', e: '☀️', n: '맑은 아침', tm: 'day', t: '햇살이 반짝이는 아침,' },
    { id: 'afternoon', e: '🍃', n: '바람 부는 오후', tm: 'day', t: '산들바람이 부는 오후,' },
    { id: 'evening', e: '🌇', n: '노을 지는 저녁', tm: 'eve', t: '노을이 붉게 물든 저녁,' },
    { id: 'night', e: '🌙', n: '별이 뜬 밤', tm: 'night', t: '별이 총총 뜬 밤,' }
  ];

  /* ---------- 장소: 배경 그림(bg)과 성질(tags) ----------
     tags: out(바깥) land(땅) water(물가) sea(바닷속) space(우주) in(실내) building tree high cold hot */
  var PLACES = {
    meadow: { e: '🌷', n: '꽃밭', bg: 'meadow', tags: ['out', 'land'], go: '{W:은/는} 알록달록 꽃밭으로 갔어요. 나비가 팔랑팔랑 춤을 추었어요.' },
    forest: { e: '🌲', n: '숲', bg: 'forest', tags: ['out', 'land', 'tree'], go: '{W:은/는} 깊은 숲으로 들어갔어요. 나뭇잎이 바스락바스락 속삭였어요.' },
    treetop: { e: '🌳', n: '나무 위', bg: 'forest', tags: ['out', 'land', 'tree', 'high'], go: '{W:은/는} 커다란 나무 위로 영차영차 올라갔어요.' },
    beach: { e: '🏖️', n: '바닷가', bg: 'beach', tags: ['out', 'land', 'water'], go: '{W:은/는} 바닷가에 도착했어요. 파도가 철썩철썩 노래했어요.' },
    island: { e: '🏝️', n: '무인도', bg: 'island', tags: ['out', 'land', 'water'], go: '{W:은/는} 작은 배를 타고 무인도에 내렸어요. 야자나무가 살랑살랑 흔들렸어요.' },
    castle: { e: '🏰', n: '성', bg: 'castle', tags: ['land', 'building'], go: '{W:은/는} 높다란 성에 도착했어요. 깃발이 펄럭펄럭 날렸어요.' },
    mountain: { e: '🏔️', n: '산꼭대기', bg: 'mountain', tags: ['out', 'land', 'high', 'cold'], go: '{W:은/는} 헉헉 숨을 몰아쉬며 산꼭대기에 올랐어요.' },
    volcano: { e: '🌋', n: '화산 옆', bg: 'volcano', tags: ['out', 'land', 'hot'], go: '{W:은/는} 연기가 모락모락 나는 화산 옆에 다다랐어요.' },
    circus: { e: '🎪', n: '서커스', bg: 'circus', tags: ['land', 'building'], go: '{W:은/는} 서커스 천막에 들어갔어요. 둥둥 북소리가 울렸어요.' },
    kinder: { e: '🏫', n: '유치원', bg: 'room', tags: ['in', 'building'], go: '{W:은/는} 유치원에 갔어요. 친구들 웃음소리가 까르르 들렸어요.' },
    jungle: { e: '🌴', n: '정글', bg: 'jungle', tags: ['out', 'land', 'tree'], go: '{W:은/는} 덩굴이 얼기설기 얽힌 정글로 들어갔어요.' },
    /* 우주 */
    moon: { e: '🌙', n: '달', bg: 'moon', tags: ['space'], go: '{W:은/는} 달에 사뿐히 내려앉았어요. 몸이 둥실둥실 가벼웠어요.' },
    mars: { e: '🔴', n: '화성', bg: 'mars', tags: ['space'], go: '{W:은/는} 붉은 화성에 내렸어요. 모래바람이 휘이잉 불었어요.' },
    starland: { e: '⭐', n: '별나라', bg: 'starland', tags: ['space'], go: '{W:은/는} 별나라에 도착했어요. 별들이 반짝반짝 인사했어요.' },
    candy: { e: '🍭', n: '사탕 행성', bg: 'candy', tags: ['space'], go: '{W:은/는} 사탕 행성에 내렸어요. 땅에서 달콤한 냄새가 솔솔 났어요.' },
    ice: { e: '❄️', n: '얼음 행성', bg: 'ice', tags: ['space', 'cold'], go: '{W:은/는} 얼음 행성에 내렸어요. 발밑이 미끌미끌했어요.' },
    rainbowp: { e: '🌈', n: '무지개 행성', bg: 'rainbow', tags: ['space'], go: '{W:은/는} 무지개 행성에 도착했어요. 하늘이 알록달록 빛났어요.' },
    station: { e: '🛰️', n: '우주 정거장', bg: 'space', tags: ['space', 'building'], go: '{W:은/는} 우주 정거장에 도착했어요. 기계들이 삐빅삐빅 반겨 주었어요.' },
    /* 바닷속 */
    coral: { e: '🐠', n: '산호초', bg: 'sea', tags: ['sea'], go: '{W:은/는} 바닷속으로 풍덩 뛰어들어 알록달록 산호초에 닿았어요.' },
    kelp: { e: '🌿', n: '해초 숲', bg: 'sea', tags: ['sea'], go: '{W:은/는} 해초가 하늘하늘 춤추는 해초 숲으로 헤엄쳐 갔어요.' },
    palace: { e: '🏰', n: '인어 궁전', bg: 'sea', tags: ['sea', 'building'], go: '{W:은/는} 반짝반짝 빛나는 인어 궁전에 도착했어요.' },
    wreck: { e: '⚓', n: '보물선', bg: 'sea', tags: ['sea'], go: '{W:은/는} 바닷속에 가라앉은 낡은 보물선을 찾아냈어요.' },
    shells: { e: '🐚', n: '조개 마을', bg: 'sea', tags: ['sea'], go: '{W:은/는} 조개들이 옹기종기 모여 사는 조개 마을에 갔어요.' },
    /* 생일 파티 */
    partyhall: { e: '🎉', n: '파티장', bg: 'party', tags: ['in', 'building'], go: '{W:은/는} 풍선이 가득한 파티장에 도착했어요.' },
    kitchen: { e: '🍳', n: '부엌', bg: 'room', tags: ['in', 'building'], go: '{W:은/는} 부엌으로 갔어요. 오븐에서 고소한 냄새가 솔솔 났어요.' },
    home: { e: '🏠', n: '우리 집', bg: 'room', tags: ['in', 'building'], go: '{W:은/는} 우리 집 거실을 살금살금 둘러봤어요.' },
    /* 꼬마 탐정 (kids-lab 탐정 이야기의 장소) */
    bedunder: { e: '🛏️', n: '침대 밑', bg: 'room', tags: ['in', 'building'], go: '{W:은/는} 몸을 납작 엎드려 침대 밑을 들여다봤어요.' },
    box: { e: '📦', n: '상자 속', bg: 'room', tags: ['in', 'building'], go: '{W:은/는} 커다란 상자 속을 뒤적뒤적 살펴봤어요.' },
    bath: { e: '🛁', n: '욕실', bg: 'room', tags: ['in', 'building'], go: '{W:은/는} 욕실 문을 살며시 열어 보았어요.' },
    /* 마법 학교 */
    school: { e: '🪄', n: '마법 교실', bg: 'school', tags: ['in', 'building'], go: '{W:은/는} 마법 교실에 들어갔어요. 책들이 둥둥 떠다녔어요.' },
    library: { e: '📚', n: '마법 도서관', bg: 'school', tags: ['in', 'building'], go: '{W:은/는} 마법 도서관에 갔어요. 책장이 하늘 끝까지 닿아 있었어요.' },
    mforest: { e: '🍄', n: '마법의 숲', bg: 'forest', tags: ['out', 'land', 'tree'], go: '{W:은/는} 버섯이 반짝반짝 빛나는 마법의 숲으로 갔어요.' },
    tower: { e: '🗼', n: '마법사의 탑', bg: 'castle', tags: ['land', 'building', 'high'], go: '{W:은/는} 빙글빙글 계단을 올라 마법사의 탑 꼭대기에 닿았어요.' },
    /* 공룡 시대 */
    dbeach: { e: '🦴', n: '공룡 바닷가', bg: 'beach', tags: ['out', 'land', 'water'], go: '{W:은/는} 커다란 발자국이 찍힌 공룡 바닷가에 갔어요.' },
    rockhill: { e: '🪨', n: '바위산', bg: 'mountain', tags: ['out', 'land', 'high'], go: '{W:은/는} 울퉁불퉁 바위산을 성큼성큼 올랐어요.' },
    nest: { e: '🥚', n: '공룡 둥지', bg: 'jungle', tags: ['out', 'land', 'tree'], go: '{W:은/는} 커다란 알이 놓인 공룡 둥지를 찾아갔어요.' },
    /* 운동회 */
    fieldp: { e: '🏟️', n: '운동장', bg: 'field', tags: ['out', 'land'], go: '{W:은/는} 깃발이 펄럭이는 운동장에 들어섰어요.' },
    track: { e: '🌲', n: '숲속 달리기 길', bg: 'forest', tags: ['out', 'land', 'tree'], go: '{W:은/는} 숲속 달리기 길에 섰어요. 새들이 짹짹 응원했어요.' },
    lake: { e: '🏊', n: '호숫가', bg: 'beach', tags: ['out', 'land', 'water'], go: '{W:은/는} 수영 경기가 열리는 호숫가에 갔어요.' },
    hill: { e: '⛰️', n: '언덕', bg: 'meadow', tags: ['out', 'land'], go: '{W:은/는} 공 굴리기 경기가 열리는 언덕에 올랐어요.' }
  };

  /* ---------- 친구: 저마다 잘하는 것(skill)이 있어 해결 카드로 나온다 ---------- */
  var FRIENDS = {
    dog: { e: '🐶', n: '강아지', say: '멍멍! 나랑 같이 가자!', sk: ['find'] },
    cat: { e: '🐱', n: '고양이', say: '야옹! 나도 끼워 줘!', sk: ['high'] },
    squirrel: { e: '🐿️', n: '다람쥐', say: '쪼르르! 내가 도와줄게!', sk: ['high'] },
    bird: { e: '🐦', n: '작은 새', say: '짹짹! 같이 놀자!', sk: ['fly'] },
    butterfly: { e: '🦋', n: '나비', say: '팔랑팔랑, 안녕!', sk: ['fly'] },
    turtle: { e: '🐢', n: '거북이', say: '엉금엉금, 반가워!', sk: ['swim'] },
    bee: { e: '🐝', n: '꿀벌', say: '붕붕! 나는 꿀벌이야!', sk: ['fly'] },
    duck: { e: '🦆', n: '오리', say: '꽥꽥! 같이 가자!', sk: ['swim'] },
    chick: { e: '🐥', n: '병아리', say: '삐약삐약! 나도 갈래!', sk: ['music'] },
    elephant: { e: '🐘', n: '코끼리', say: '뿌우! 힘이라면 자신 있어!', sk: ['strong'] },
    lion: { e: '🦁', n: '사자', say: '어흥! 겁내지 마, 친구야!', sk: ['strong'] },
    panda: { e: '🐼', n: '판다', say: '안녕! 대나무 먹을래?', sk: ['strong'] },
    monkey: { e: '🐵', n: '원숭이', say: '끼끼! 나무 타기는 내가 최고야!', sk: ['high'] },
    fairy: { e: '🧚', n: '요정', say: '반짝반짝! 내가 도와줄게!', sk: ['magic', 'light'] },
    owl: { e: '🦉', n: '부엉이', say: '부엉부엉, 어두운 길은 내게 맡겨!', sk: ['light', 'find'] },
    frogf: { e: '🐸', n: '개구리', say: '개굴개굴! 같이 가자!', sk: ['swim'] },
    rabbitf: { e: '🐰', n: '토끼', say: '깡충깡충! 나랑 겨뤄 볼래?', sk: ['high'] },
    foxf: { e: '🦊', n: '여우', say: '안녕! 나는 꾀가 많은 여우야!', sk: ['find'] },
    bearf: { e: '🐻', n: '곰', say: '어흠! 힘센 곰이 도와줄게!', sk: ['strong'] },
    alien: { e: '👽', n: '외계인', say: '삐리삐리! 지구에서 왔니?', sk: ['fix', 'fly'] },
    robodog: { e: '🤖', n: '로봇 강아지', say: '삐빅! 친구 등록 완료!', sk: ['fix', 'light'] },
    moonrabbit: { e: '🐇', n: '달토끼', say: '깡충깡충! 달에 온 걸 환영해!', sk: ['high'] },
    sfairy: { e: '🧚', n: '별 요정', say: '반짝! 별빛을 나눠 줄게!', sk: ['light', 'magic'] },
    soctopus: { e: '🐙', n: '우주 문어', say: '꾸물꾸물, 반가워!', sk: ['strong'] },
    octopus: { e: '🐙', n: '문어', say: '꾸물꾸물! 다리가 여덟 개야!', sk: ['strong'] },
    crab: { e: '🦀', n: '꽃게', say: '집게로 딱딱! 반가워!', sk: ['fix'] },
    puffer: { e: '🐡', n: '복어', say: '뽀글뽀글, 안녕!', sk: ['swim'] },
    mermaid: { e: '🧜‍♀️', n: '인어', say: '바닷속에 온 걸 환영해!', sk: ['swim', 'music'] },
    dolphin: { e: '🐬', n: '돌고래', say: '삐익! 내 등에 타!', sk: ['swim'] },
    fish: { e: '🐠', n: '열대어', say: '살랑살랑, 같이 헤엄치자!', sk: ['swim', 'find'] },
    brachio: { e: '🦕', n: '목이 긴 공룡', say: '쿵쿵! 안녕, 꼬마 친구!', sk: ['high', 'strong'] },
    ptero: { e: '🦅', n: '프테라노돈', say: '휘익! 하늘은 내게 맡겨!', sk: ['fly'] },
    wizard: { e: '🧙', n: '마법사 할아버지', say: '허허, 천천히 또박또박 외워 보렴.', sk: ['magic'] },
    dragonf: { e: '🐉', n: '용 선생님', say: '어흠! 오늘은 무엇을 배워 볼까?', sk: ['fly', 'light'] }
  };
  var SKILL_T = {
    fly: '{F:이/가} 훨훨 날아올라 위에서 길을 알려 주었어요.',
    find: '{F:이/가} 두리번두리번 살피더니 "이쪽이야!" 하고 알려 주었어요.',
    strong: '{F:이/가} 영차! 힘센 몸으로 번쩍 들어 올렸어요.',
    swim: '{F:이/가} 친구들을 등에 태우고 첨벙첨벙 헤엄쳐 갔어요.',
    high: '{F:이/가} 높은 곳까지 쪼르르 올라가 도와주었어요.',
    light: '{F:이/가} 반짝반짝 빛을 내어 주위를 환하게 밝혀 주었어요.',
    magic: '{F:이/가} 요술을 부렸어요. 뾰로롱!',
    fix: '{F:이/가} 뚝딱뚝딱 솜씨 좋게 고쳐 주었어요.',
    music: '{F:이/가} 맑은 목소리로 노래를 불러 주었어요.'
  };
  var SKILL_N = { fly: '날아서 도와줘요', find: '찾아 줘요', strong: '힘을 써 줘요', swim: '헤엄쳐 줘요', high: '높이 올라가요', light: '빛을 비춰요', magic: '요술을 부려요', fix: '고쳐 줘요', music: '노래해 줘요' };

  /* ---------- 말썽꾼 ---------- */
  var VILLAINS = {
    wolf: { e: '🐺', n: '늑대', say: '"크르릉, 여기는 내 땅이야!"' },
    raccoon: { e: '🦝', n: '너구리', say: '"히히, 장난칠 친구다!"' },
    croc: { e: '🐊', n: '악어', say: '"쩝쩝, 심심하던 참이었는데!"' },
    ghost: { e: '👻', n: '꼬마 유령', say: '"우우우, 깜짝 놀랐지?"' },
    witch: { e: '🧙‍♀️', n: '심술쟁이 마녀', say: '"호호호, 내 마법 맛 좀 볼래?"' },
    squid: { e: '🦑', n: '먹물 오징어', say: '"찍! 먹물 맛 좀 봐라!"' },
    monster: { e: '👾', n: '우주 괴물', say: '"꾸에엑, 내 별에서 나가!"' },
    trex: { e: '🦖', n: '심술쟁이 티라노', say: '"크아앙, 내가 제일 세다!"' }
  };

  /* ---------- 이야기 세계 8종 (kids-lab EPS) ---------- */
  var WORLDS = [
    { id: 'adv', ic: '🗺️', t: '신나는 모험', d: '떠나서 친구를 만나요', bg: 'meadow',
      intro: '옛날 옛적, 작은 마을에 {HI} 살았어요.', title: '{H}의 신나는 모험',
      places: ['meadow', 'forest', 'treetop', 'beach', 'island', 'castle', 'mountain', 'volcano', 'circus', 'kinder'],
      friends: ['dog', 'bird', 'turtle', 'butterfly', 'bee', 'elephant', 'lion', 'fairy', 'squirrel', 'monkey'],
      villains: ['wolf', 'raccoon', 'croc', 'ghost'],
      helpers: ['지나가던 곰 아저씨', '친절한 부엉이', '마음씨 좋은 코끼리', '이웃집 할머니'],
      goals: [
        { id: 'treasure', e: '💎', n: '보물 찾기', t: '{H:은/는} 전설 속 보물을 꼭 찾고 싶었어요.', done: '반짝반짝 빛나는 보물 상자를 찾았어요', miss: '보물은 끝내 찾지 못했어요.' },
        { id: 'star', e: '⭐', n: '아기 별 데려다주기', t: '{H:은/는} 하늘에서 떨어진 아기 별을 집에 데려다주고 싶었어요.', done: '아기 별을 하늘 집에 데려다주었어요', miss: '아기 별의 집은 아직 찾지 못했어요.' },
        { id: 'rainbowend', e: '🌈', n: '무지개 끝 가 보기', t: '{H:은/는} 무지개가 끝나는 곳에 꼭 가 보고 싶었어요.', done: '무지개가 끝나는 곳에 도착했어요', miss: '무지개 끝에는 닿지 못했어요.' },
        { id: 'mflower', e: '🌸', n: '마법 꽃 찾기', t: '{H:은/는} 아픈 할머니께 드릴 마법 꽃을 찾고 싶었어요.', done: '반짝이는 마법 꽃을 찾아 할머니께 드렸어요', miss: '마법 꽃은 찾지 못했어요.' }
      ],
      ends: [{ id: 'adv-dinner', e: '🍽️', n: '맛있는 저녁', t: '그리고 모두 함께 맛있는 저녁을 먹었어요.' }] },
    { id: 'space', ic: '🚀', t: '우주 탐험', d: '별나라에 가요', bg: 'night',
      intro: '옛날 옛적, 밤마다 별을 올려다보는 {HI} 살았어요.', title: '{H}의 우주 탐험',
      launch: '{W:은/는} 로켓을 타고 슝! 우주로 날아올랐어요.', move: '그다음, 다시 로켓을 타고 날아갔어요.',
      places: ['moon', 'mars', 'starland', 'candy', 'ice', 'rainbowp', 'station'],
      friends: ['alien', 'robodog', 'moonrabbit', 'sfairy', 'soctopus'],
      villains: ['monster', 'ghost'],
      helpers: ['지나가던 우주 비행사', '친절한 우주 로봇', '반짝이는 별똥별'],
      goals: [
        { id: 'tour', e: '🪐', n: '행성 구경하기', t: '{H:은/는} 우주의 신기한 행성들을 구경하고 싶었어요.', done: '신기한 행성들을 실컷 구경했어요', miss: '모든 행성을 다 구경하지는 못했어요.' },
        { id: 'meetalien', e: '👽', n: '외계인 친구 만나기', t: '{H:은/는} 외계인 친구를 꼭 만나 보고 싶었어요.', done: '외계인 친구와 우주 하이파이브를 했어요', miss: '외계인 친구는 만나지 못했어요.' },
        { id: 'stars', e: '✨', n: '별 조각 모으기', t: '{H:은/는} 반짝이는 별 조각을 모으고 싶었어요.', done: '주머니 가득 별 조각을 모았어요', miss: '별 조각은 하나도 모으지 못했어요.' }
      ],
      ends: [{ id: 'space-earth', e: '🌏', n: '무사히 지구로', t: '{W:은/는} 무사히 지구로 돌아와 창밖의 별을 보며 잠이 들었어요.', bg: 'night' }] },
    { id: 'sea', ic: '🌊', t: '바닷속 여행', d: '깊은 바다를 구경해요', bg: 'beach',
      intro: '옛날 옛적, 바닷가 마을에 {HI} 살았어요.', title: '{H}의 바닷속 여행',
      places: ['coral', 'kelp', 'palace', 'wreck', 'shells', 'beach', 'island'],
      friends: ['octopus', 'crab', 'puffer', 'mermaid', 'dolphin', 'fish', 'turtle'],
      villains: ['squid', 'croc'],
      helpers: ['지나가던 고래 아저씨', '친절한 해파리', '마음씨 좋은 바다거북'],
      goals: [
        { id: 'pearl', e: '🦪', n: '무지개 진주 찾기', t: '{H:은/는} 바닷속 깊은 곳에 있다는 무지개 진주를 찾고 싶었어요.', done: '무지개 진주를 찾았어요', miss: '무지개 진주는 찾지 못했어요.' },
        { id: 'mpalace', e: '🧜‍♀️', n: '인어 공주 만나기', t: '{H:은/는} 인어 공주를 꼭 만나 보고 싶었어요.', done: '인어 공주와 함께 궁전을 구경했어요', miss: '인어 공주는 만나지 못했어요.' },
        { id: 'cleansea', e: '💙', n: '바다 지키기', t: '{H:은/는} 바다 친구들이 사는 바다를 깨끗하게 지키고 싶었어요.', done: '바다를 깨끗하게 지켜 냈어요', miss: '바다를 다 치우지는 못했어요.' }
      ],
      ends: [{ id: 'sea-shell', e: '🐚', n: '조개 선물', t: '바다 친구들이 고맙다며 예쁜 조개를 선물했어요.' },
        { id: 'sea-sunset', e: '🌅', n: '반짝이는 노을', t: '물 위로 올라오니 노을이 반짝반짝 빛났어요.', bg: 'beach', tm: 'eve' }] },
    { id: 'party', ic: '🎂', t: '생일 파티', d: '친구의 생일을 축하해요', bg: 'party',
      intro: '옛날 옛적, 숲속 마을에 {HI} 살았어요.', title: '{H}의 깜짝 생일 파티',
      places: ['partyhall', 'kitchen', 'home', 'meadow', 'forest'],
      friends: ['dog', 'panda', 'chick', 'elephant', 'lion', 'squirrel', 'cat', 'bee'],
      villains: ['raccoon', 'ghost'],
      helpers: ['이웃집 할머니', '빵집 아저씨', '친절한 요정'],
      goals: [
        { id: 'bday', e: '🎂', n: '생일 축하하기', t: '오늘은 단짝 친구의 생일! {H:은/는} 멋진 생일 파티를 열어 주고 싶었어요.', done: '세상에서 가장 멋진 생일 파티를 열었어요', miss: '생각했던 대로 파티를 열지는 못했어요.' },
        { id: 'surprise', e: '🎉', n: '깜짝 파티', t: '{H:은/는} 친구 몰래 깜짝 파티를 준비하고 싶었어요.', done: '깜짝 파티로 친구를 깜짝 놀라게 했어요', miss: '깜짝 파티는 그만 들키고 말았어요.' },
        { id: 'bake', e: '🍪', n: '쿠키 굽기', t: '{H:은/는} 파티에 낼 맛있는 쿠키를 굽고 싶었어요.', done: '노릇노릇 맛있는 쿠키를 구웠어요', miss: '쿠키는 조금 타 버렸어요.' }
      ],
      ends: [{ id: 'party-song', e: '🎶', n: '생일 축하 노래', t: '모두 함께 "생일 축하합니다" 노래를 불렀어요.', bg: 'party' }] },
    { id: 'detective', ic: '🔍', t: '꼬마 탐정', d: '사라진 물건을 찾아요', bg: 'room',
      intro: '옛날 옛적, 돋보기를 늘 들고 다니는 꼬마 탐정 {HI} 살았어요.', title: '꼬마 탐정 {H}의 사건 수첩',
      places: ['home', 'bedunder', 'box', 'bath', 'meadow', 'treetop', 'kinder'],
      friends: ['dog', 'cat', 'owl', 'foxf', 'bird', 'squirrel'],
      villains: ['raccoon', 'ghost'],
      helpers: ['옆집 할아버지', '친절한 경찰관 아저씨', '똑똑한 부엉이'],
      who: [['dogw', '🐶', '강아지'], ['catw', '🐱', '고양이'], ['squirrelw', '🐿️', '다람쥐'], ['baby', '👶', '아기 동생'], ['magpie', '🐦', '까치'], ['mouse', '🐭', '생쥐']],
      goals: [
        { id: 'bear', e: '🧸', n: '사라진 곰 인형', L: '곰 인형' }, { id: 'crown', e: '👑', n: '사라진 왕관', L: '반짝이 왕관' },
        { id: 'cookies', e: '🍪', n: '사라진 쿠키 통', L: '쿠키 통' }, { id: 'hat', e: '🎩', n: '사라진 마술 모자', L: '마술 모자' },
        { id: 'sock', e: '🧦', n: '사라진 양말', L: '양말 한 짝' }, { id: 'key', e: '🔑', n: '사라진 열쇠', L: '보물 상자 열쇠' }
      ].map(function (g) {
        g.t = '그런데 어느 날, 소중한 {L:이/가} 감쪽같이 사라졌어요! {H:은/는} 범인을 꼭 찾아내기로 했어요.';
        g.done = '사라졌던 {L:을/를} 되찾았어요'; g.miss = '{L:은/는} 아직 찾지 못했어요.';
        return g;
      }),
      ends: [{ id: 'det-note', e: '📒', n: '탐정 수첩', t: '{H:은/는} 오늘의 사건을 탐정 수첩에 꼼꼼히 적었어요.', bg: 'room' },
        { id: 'det-famous', e: '🏅', n: '유명한 탐정', t: '꼬마 탐정 {H}의 이름은 온 동네에 알려졌어요.' }] },
    { id: 'magic', ic: '🧙', t: '마법 학교', d: '마법 주문을 배워요', bg: 'meadow',
      intro: '옛날 옛적, 마법사가 되고 싶은 {HI} 살았어요.', title: '{H}의 마법 학교',
      places: ['school', 'library', 'mforest', 'tower', 'meadow'],
      friends: ['owl', 'wizard', 'fairy', 'dragonf', 'cat'],
      villains: ['witch', 'ghost'],
      helpers: ['마법 학교 교장 선생님', '말하는 빗자루', '친절한 요정'],
      goals: [
        { id: 'flyspell', e: '🕊️', n: '하늘을 나는 마법', t: '{H:은/는} 하늘을 나는 마법을 꼭 배우고 싶었어요.', done: '하늘을 나는 마법에 성공했어요', miss: '아직 하늘을 날지는 못했어요.' },
        { id: 'bloom', e: '🌸', n: '꽃 피우는 마법', t: '{H:은/는} 꽃을 피우는 마법을 꼭 배우고 싶었어요.', done: '꽃을 피우는 마법에 성공했어요', miss: '꽃은 아직 피우지 못했어요.' },
        { id: 'rainbowspell', e: '🌈', n: '무지개 마법', t: '{H:은/는} 하늘에 무지개를 띄우는 마법을 배우고 싶었어요.', done: '하늘에 커다란 무지개를 띄웠어요', miss: '무지개는 아직 띄우지 못했어요.' },
        { id: 'exam', e: '📜', n: '마법 시험', t: '{H:은/는} 마법 시험에 꼭 붙고 싶었어요.', done: '마법 시험에 당당히 붙었어요', miss: '마법 시험에는 떨어지고 말았어요.' }
      ],
      ends: [{ id: 'magic-wizard', e: '⭐', n: '멋진 마법사', t: '{H:은/는} 꼭 멋진 마법사가 되기로 다짐했어요.' },
        { id: 'magic-dream', e: '🌙', n: '꿈속 마법 연습', t: '그날 밤, {H:은/는} 꿈속에서도 마법 연습을 했어요.', bg: 'night' }] },
    { id: 'dino', ic: '🦕', t: '공룡 시대로', d: '아주 먼 옛날로 가요', bg: 'meadow',
      intro: '옛날 옛적, 공룡을 정말 좋아하는 {HI} 살았어요.', title: '{H}의 공룡 시대 여행',
      launch: '{H:은/는} 반짝이는 모래시계를 뒤집었어요. 빙글빙글… 눈을 떠 보니 아주 먼 옛날 공룡 시대였어요!', launchBg: 'jungle',
      places: ['jungle', 'volcano', 'dbeach', 'rockhill', 'nest'],
      friends: ['brachio', 'ptero', 'turtle', 'monkey', 'bird'],
      villains: ['trex', 'croc'],
      helpers: ['지나가던 엄마 공룡', '친절한 목이 긴 공룡', '하늘을 나는 공룡'],
      goals: [
        { id: 'egg', e: '🥚', n: '공룡 알 돌려주기', t: '{H:은/는} 길에서 주운 공룡 알을 엄마 공룡에게 돌려주고 싶었어요.', done: '공룡 알을 엄마 공룡에게 돌려주었어요', miss: '엄마 공룡은 아직 찾지 못했어요.' },
        { id: 'dfriend', e: '🦕', n: '공룡 친구 사귀기', t: '{H:은/는} 커다란 공룡과 친구가 되고 싶었어요.', done: '커다란 공룡과 친구가 되었어요', miss: '공룡과 친구가 되지는 못했어요.' },
        { id: 'fossil', e: '🦴', n: '공룡 화석 찾기', t: '{H:은/는} 멋진 공룡 화석을 찾고 싶었어요.', done: '멋진 공룡 화석을 찾았어요', miss: '공룡 화석은 찾지 못했어요.' }
      ],
      ends: [{ id: 'dino-stone', e: '💎', n: '반짝이는 돌', t: '{H:은/는} 공룡 시대에서 가져온 반짝이는 돌을 소중히 간직했어요.' },
        { id: 'dino-museum', e: '🦴', n: '박물관 구경', t: '{H:은/는} 박물관에서 공룡 뼈를 보며 그날의 모험을 떠올렸어요.', bg: 'room' }] },
    { id: 'sports', ic: '🏅', t: '숲속 운동회', d: '친구들과 겨뤄요', bg: 'meadow',
      intro: '옛날 옛적, 달리기를 좋아하는 {HI} 살았어요.', title: '{H}의 숲속 운동회',
      places: ['fieldp', 'track', 'lake', 'hill'],
      friends: ['turtle', 'rabbitf', 'foxf', 'bearf', 'squirrel', 'dog'],
      villains: ['raccoon', 'wolf'],
      helpers: ['심판 부엉이 선생님', '응원하던 곰 아저씨', '친절한 사슴'],
      goals: [
        { id: 'finish', e: '🏃', n: '끝까지 달리기', t: '{H:은/는} 운동회 달리기에서 끝까지 달리고 싶었어요.', done: '결승선까지 끝까지 달렸어요', miss: '결승선까지는 달리지 못했어요.' },
        { id: 'medal', e: '🏅', n: '메달 받기', t: '{H:은/는} 반짝이는 메달을 받고 싶었어요.', done: '반짝이는 메달을 받았어요', miss: '메달은 받지 못했어요.' },
        { id: 'cheer', e: '📣', n: '우리 팀 응원', t: '{H:은/는} 우리 팀을 힘껏 응원하고 싶었어요.', done: '목이 쉬도록 응원해서 우리 팀이 이겼어요', miss: '우리 팀이 이기지는 못했어요.' }
      ],
      ends: [{ id: 'sports-medal', e: '🥇', n: '다 함께 메달', t: '모두 함께 반짝이는 메달을 목에 걸었어요.' },
        { id: 'sports-hug', e: '🤗', n: '서로 꼭 안기', t: '경기가 끝나고 모두 서로 꼭 안아 주었어요.' }] }
  ];
  var WORLD = {}; WORLDS.forEach(function (w) { WORLD[w.id] = w; });

  /* ---------- 사건 ----------
     need: 이 사건을 풀 수 있는 해결 성질. pl: 이런 성질의 장소에서만(하나라도). nopl: 이런 장소에서는 안 나옴.
     w: 이 세계에서만. req: f(친구 필요), item(물건 필요). ok: 해결 뒤 결과(해결 성질별로 다르게 쓸 수 있음) */
  var EVENTS = [
    { id: 'dark', e: '🌑', n: '깜깜해졌어요', t: '갑자기 주위가 깜깜해져서 아무것도 보이지 않았어요.', need: ['light', 'brave', 'music', 'together', 'calm', 'magic'], ok: '어느새 무서운 어둠도 지나가고 길이 보였어요.' },
    { id: 'lost', e: '❓', n: '길을 잃었어요', t: '길을 잃어버리고 말았어요. 어디가 어디인지 모르겠어요.', need: ['map', 'find', 'ask', 'fly', 'high', 'clever'], pl: ['out', 'space', 'sea'], ok: '드디어 가야 할 길을 찾았어요!' },
    { id: 'rain', e: '🌧️', n: '비가 쏟아졌어요', t: '갑자기 하늘에서 비가 주룩주룩 쏟아졌어요.', need: ['rain', 'together', 'clever', 'music', 'magic'], pl: ['out'], ok: '비가 그치자 하늘에 커다란 무지개가 떴어요.' },
    { id: 'hungry', e: '🍽️', n: '배가 고팠어요', t: '배가 너무 고파서 꼬르륵꼬르륵 소리가 났어요.', need: ['food', 'find', 'ask', 'clever'],
      ok: { find: '나무에 열린 빨간 사과를 찾아 냠냠 맛있게 먹었어요.', clever: '근처 덤불에서 달콤한 산딸기를 따 먹었어요.', _: '배가 든든해지자 힘이 불끈 솟았어요.' } },
    { id: 'hole', e: '🕳️', n: '구멍에 빠졌어요', t: '발을 헛디뎌 커다란 구멍에 쿵 빠졌어요.', need: ['rope', 'together', 'strong', 'fly', 'clever', 'ask', 'climb'], pl: ['land'], ok: '드디어 구멍 밖으로 영차 빠져나왔어요!' },
    { id: 'cold', e: '🥶', n: '너무 추웠어요', t: '바람이 쌩쌩 불어서 몸이 덜덜 떨렸어요.', need: ['warm', 'cold', 'together', 'clever', 'magic', 'chase'], pl: ['out', 'space', 'cold'],
      ok: { chase: '달리고 나니 몸이 후끈후끈 따뜻해졌어요.', _: '몸이 금세 포근포근 따뜻해졌어요.' } },
    { id: 'wind', e: '👒', n: '모자가 날아갔어요', t: '휘잉! 세찬 바람이 불어 모자가 날아갔어요.', need: ['chase', 'fly', 'high', 'rope', 'together', 'clever'], pl: ['out'], ok: '드디어 모자를 되찾았어요!' },
    { id: 'cry', e: '😢', n: '친구가 울어요', req: { f: 1 }, t: '{F1:이/가} 넘어져서 엉엉 울기 시작했어요.', need: ['kind', 'music', 'food', 'magic'], ok: '{F1:이/가} 눈물을 닦고 방긋 웃었어요.' },
    { id: 'river', e: '🌊', n: '강이 가로막았어요', t: '넓은 강이 앞을 떡하니 가로막았어요.', need: ['rope', 'swim', 'fly', 'together', 'clever', 'ask', 'build'], pl: ['land'], nopl: ['in', 'building'], ok: '무사히 강을 건넜어요!' },
    { id: 'locked', e: '🔒', n: '문이 잠겼어요', t: '커다란 문이 꽁꽁 잠겨 있었어요.', need: ['find', 'clever', 'magic', 'ask', 'fix'], pl: ['building', 'in'], ok: '덜컥! 드디어 문이 열렸어요.' },
    { id: 'noise', e: '👂', n: '이상한 소리', t: '어디선가 쿵쿵, 이상한 소리가 들려왔어요.', need: ['brave', 'find', 'light', 'calm'], ok: '알고 보니 쿵쿵 소리는 아기 곰이 북을 치는 소리였어요!' },
    { id: 'kite', e: '🪁', n: '연이 걸렸어요', t: '날리던 연이 높은 나뭇가지에 걸리고 말았어요.', need: ['fly', 'high', 'rope', 'together', 'clever', 'climb', 'ask'], pl: ['tree', 'out'], nopl: ['space', 'sea'], w: ['adv', 'party', 'sports', 'magic'], ok: '연을 무사히 내렸어요. 연이 다시 하늘 높이 날았어요.' },
    { id: 'sleepy', e: '😴', n: '친구가 잠들었어요', req: { f: 1 }, t: '{F1:이/가} 쿨쿨 잠들어 버렸어요. 갈 길이 먼데 말이에요.', need: ['music', 'clever', 'calm'], ok: '{F1:이/가} 기지개를 쭉 켜며 일어났어요.' },
    { id: 'wheel', e: '🛞', n: '수레가 고장 났어요', t: '쾅! 타고 가던 수레바퀴가 빠져 버렸어요.', need: ['fix', 'together', 'strong', 'clever', 'ask'], pl: ['land'], nopl: ['in', 'building'], ok: '수레가 다시 데굴데굴 굴러갔어요.' },
    /* 우주 */
    { id: 'fuel', e: '⛽', n: '연료가 떨어졌어요', w: ['space'], t: '로켓 연료가 똑 떨어졌어요.', need: ['fix', 'clever', 'magic', 'ask', 'together'], ok: '로켓이 다시 부르릉 힘차게 움직였어요.' },
    { id: 'meteor', e: '☄️', n: '별똥별이 쏟아졌어요', w: ['space'], t: '별똥별이 우수수 쏟아지기 시작했어요!', need: ['brave', 'clever', 'calm', 'rain'], ok: '별똥별이 지나가고 하늘이 다시 고요해졌어요.' },
    { id: 'blackhole', e: '🌀', n: '블랙홀', w: ['space'], t: '커다란 블랙홀이 빙글빙글 로켓을 끌어당겼어요!', need: ['together', 'strong', 'brave', 'clever', 'magic', 'calm'], ok: '블랙홀에서 쏙 빠져나왔어요!' },
    { id: 'signal', e: '📡', n: '연락이 끊겼어요', w: ['space'], t: '지구와 연락이 뚝 끊겼어요.', need: ['fix', 'find', 'clever', 'map'], ok: '삐삐삐! 지구에서 반가운 목소리가 들려왔어요.' },
    /* 바다 */
    { id: 'whirl', e: '🌀', n: '소용돌이', pl: ['sea', 'water'], t: '커다란 소용돌이가 빙글빙글 몰려왔어요!', need: ['together', 'swim', 'strong', 'brave', 'clever', 'calm'], ok: '소용돌이를 무사히 빠져나왔어요!' },
    { id: 'trash', e: '🗑️', n: '쓰레기가 둥둥', pl: ['sea', 'water'], t: '바다에 쓰레기가 둥둥 떠다녀서 물고기들이 아파했어요.', need: ['clean', 'together', 'kind', 'magic', 'clever'], ok: '바다가 다시 맑고 깨끗해졌어요.' },
    { id: 'net', e: '🐟', n: '그물에 걸렸어요', pl: ['sea', 'water'], t: '작은 물고기가 그물에 걸려 버둥버둥했어요.', need: ['fix', 'kind', 'clever', 'together', 'strong', 'untie'], ok: '물고기가 그물에서 빠져나와 고맙다고 인사했어요.' },
    { id: 'shark', e: '🦈', n: '상어가 나타났어요', pl: ['sea'], t: '배고픈 상어가 슬금슬금 다가왔어요!', need: ['brave', 'kind', 'food', 'clever', 'calm'],
      ok: { kind: '상어는 "사실 나는 외로웠어" 하며 꼬리를 흔들었어요.', food: '배가 부른 상어는 꼬리를 흔들며 고맙다고 했어요.', _: '상어는 슬그머니 멀리 헤엄쳐 갔어요.' } },
    /* 생일 파티 */
    { id: 'cake', e: '🎂', n: '케이크를 떨어뜨렸어요', w: ['party'], t: '앗! 케이크를 바닥에 철퍼덕 떨어뜨렸어요.', need: ['make', 'together', 'magic', 'clever', 'ask'], ok: '세상에 하나뿐인 멋진 케이크가 완성됐어요!' },
    { id: 'balloons', e: '🎈', n: '풍선이 날아갔어요', w: ['party', 'adv'], t: '풍선이 모두 둥둥 날아가 버렸어요.', need: ['fly', 'high', 'chase', 'together', 'make', 'clever'], ok: '다시 알록달록 풍선이 가득해졌어요.' },
    { id: 'lightsout', e: '💡', n: '불이 꺼졌어요', pl: ['in', 'building'], t: '갑자기 불이 탁 꺼졌어요.', need: ['light', 'music', 'calm', 'brave', 'fix'], ok: '다시 환해지자 모두 "와!" 하고 웃었어요.' },
    { id: 'gift', e: '🎁', n: '선물을 두고 왔어요', w: ['party'], t: '준비한 선물을 집에 두고 온 거예요!', need: ['make', 'chase', 'fly', 'clever'], ok: '친구가 선물을 받고 활짝 웃었어요.' },
    /* 꼬마 탐정: 단서를 막는 일 */
    { id: 'footprint', e: '👣', n: '발자국이 끊겼어요', w: ['detective'], t: '따라가던 작은 발자국이 갑자기 뚝 끊겨 있었어요.', need: ['find', 'clever', 'fly', 'high', 'light', 'ask'], ok: '발자국은 위쪽으로 이어져 있었어요. 단서를 하나 더 찾았어요!' },
    { id: 'honey', e: '🍯', n: '끈적끈적 꿀 자국', w: ['detective'], t: '바닥에 끈적끈적한 꿀 자국이 나 있었어요. 하지만 어디로 이어지는지 알 수 없었어요.', need: ['find', 'clever', 'light', 'ask'], ok: '꿀 자국을 따라가니 작은 구멍이 나왔어요!' },
    { id: 'tinydoor', e: '🚪', n: '아주 작은 문', w: ['detective'], pl: ['in', 'building', 'tree'], t: '벽 아래에 아주 작은 문이 있었어요. 너무 작아서 들어갈 수가 없었어요.', need: ['magic', 'find', 'clever', 'ask'], ok: '작은 문 안에서 반짝이는 단서를 찾았어요!' },
    { id: 'messroom', e: '🧸', n: '어질러진 방', w: ['detective'], pl: ['in'], t: '방이 장난감으로 온통 어질러져 있어서 단서를 찾을 수가 없었어요.', need: ['clean', 'together', 'find', 'clever'], ok: '깨끗해진 바닥에서 반짝이는 단서를 찾았어요!' },
    /* 마법 학교 */
    { id: 'bubbles', e: '🧼', n: '거품투성이', w: ['magic'], t: '주문을 거꾸로 외워서 {P:이/가} 온통 거품투성이가 되었어요!', need: ['clean', 'magic', 'clever', 'together'], ok: '뽀드득! {P:이/가} 다시 반짝반짝해졌어요.' },
    { id: 'broom', e: '🧹', n: '빗자루가 날아다녀요', w: ['magic'], t: '빗자루가 제멋대로 휙휙 날아다녔어요!', need: ['chase', 'rope', 'magic', 'together', 'calm', 'clever'], ok: '빗자루가 얌전히 제자리로 돌아왔어요.' },
    { id: 'tfrog', e: '🐸', n: '선생님이 개구리로', w: ['magic'], t: '펑! 마법 선생님이 개구리로 변해 버렸어요!', need: ['magic', 'sorry', 'clever'], ok: '펑! 선생님이 다시 원래 모습으로 돌아와 "잘했구나!" 하고 웃었어요.' },
    /* 공룡 시대 */
    { id: 'eggroll', e: '🥚', n: '알이 굴러가요', w: ['dino'], t: '공룡 알이 데굴데굴 굴러가기 시작했어요!', need: ['chase', 'rope', 'together', 'strong', 'clever', 'ask'], ok: '알을 무사히 둥지에 돌려놓았어요.' },
    { id: 'lava', e: '🌋', n: '화산이 부글부글', w: ['dino'], t: '화산이 부글부글 끓어오르더니 쿠르릉 소리가 났어요!', need: ['chase', 'fly', 'together', 'brave', 'clever'], ok: '모두 높은 언덕 위로 무사히 피했어요.' },
    { id: 'lostmom', e: '🦕', n: '엄마를 잃은 아기 공룡', w: ['dino'], t: '아기 공룡이 엄마를 잃어버려 엉엉 울고 있었어요.', need: ['find', 'kind', 'map', 'together', 'ask'], ok: '"엄마!" 아기 공룡이 엄마 품에 쏙 안겼어요.' },
    /* 운동회 */
    { id: 'fall', e: '🤕', n: '넘어졌어요', w: ['sports'], t: '{H:은/는} 달리다가 그만 꽈당 넘어지고 말았어요.', need: ['brave', 'calm', 'together'], ok: '{H:은/는} 다시 일어나 끝까지 달렸어요!' },
    { id: 'shoe', e: '👟', n: '신발이 벗겨졌어요', w: ['sports'], t: '신발이 훌러덩 벗겨져서 저 멀리 날아갔어요.', need: ['chase', 'clever', 'together', 'fix', 'brave'], ok: '신발 끈을 꽉 묶고 다시 출발했어요!' },
    { id: 'nervous', e: '😰', n: '너무 떨려요', w: ['sports', 'party', 'magic'], t: '{H:은/는} 너무 떨려서 다리가 후들후들했어요.', need: ['calm', 'brave', 'music', 'together'], ok: '떨리던 마음이 사르르 녹았어요.' }
  ];
  /* 말썽꾼이 일으키는 사건 (말썽꾼을 켜면 마지막 사건이 이것) */
  var VEVENTS = [
    { id: 'steal', e: '💨', n: '물건을 빼앗아 갔어요', req: { item: 1 }, t: '{V:이/가} 쌩 하고 나타나 {H}의 {I:을/를} 휙 빼앗아 갔어요!', need: ['chase', 'kind', 'clever', 'brave', 'together', 'ask'] },
    { id: 'block', e: '🚧', n: '길을 막았어요', t: '{V:이/가} 길을 딱 막고 "여기는 못 지나가!" 하고 소리쳤어요.', need: ['brave', 'kind', 'clever', 'together', 'magic'] },
    { id: 'tease', e: '😝', n: '메롱 놀렸어요', t: '{V:이/가} "{YOU}{YOUJ} 절대 못 할걸!" 하고 메롱 놀렸어요.', need: ['brave', 'kind', 'calm', 'together'] },
    { id: 'vmess', e: '💥', n: '엉망으로 만들었어요', t: '{V:이/가} 장난을 쳐서 {P:이/가} 엉망진창이 되었어요.', need: ['clean', 'together', 'kind', 'magic', 'clever'] }
  ];
  var EVENT = {}; EVENTS.concat(VEVENTS).forEach(function (e) { EVENT[e.id] = e; });

  /* ---------- 기분 (마음 낱말) ---------- */
  var FEELS = [
    { id: 'scared', e: '😨', n: '무서웠어요', t: '{H:은/는} 가슴이 콩닥콩닥 뛸 만큼 무서웠어요.', pre: '무서웠지만 ' },
    { id: 'sad', e: '😢', n: '슬펐어요', t: '{H:은/는} 눈물이 글썽글썽 맺힐 만큼 슬펐어요.', pre: '눈물을 꾹 참고 ' },
    { id: 'surprised', e: '😲', n: '깜짝 놀랐어요', t: '{H:은/는} 눈이 휘둥그레질 만큼 깜짝 놀랐어요.', pre: '놀란 가슴을 진정시키고 ' },
    { id: 'worried', e: '😟', n: '걱정됐어요', t: '{H:은/는} 발을 동동 구를 만큼 걱정이 됐어요.', pre: '걱정을 꾹 누르고 ' },
    { id: 'angry', e: '😠', n: '화가 났어요', t: '{H:은/는} 얼굴이 빨개질 만큼 화가 났어요.', pre: '화를 꾹 참고 ' },
    { id: 'flustered', e: '😵', n: '당황했어요', t: '{H:은/는} 어쩔 줄 몰라 허둥지둥했어요.', pre: '마음을 가다듬고 ' }
  ];

  /* ---------- 해결 (kids-lab SOLVE 를 넓힘) ----------
     fix: 이 해결이 다룰 수 있는 성질. cat: 해결 방식(성장 문장에 씀): together 함께, clever 지혜, brave 용기, kind 친절, tool 물건, magic 마법 */
  var SOLVES = [
    { id: 'idea', e: '💡', n: '좋은 생각', fix: ['clever'], cat: 'clever', t: '{H:은/는} {PRE}곰곰이 생각했어요. 그러다 반짝, 좋은 생각이 떠올랐어요!' },
    { id: 'look', e: '👀', n: '차근차근 살펴보기', fix: ['find', 'map'], cat: 'clever', t: '{W:은/는} {PRE}주위를 차근차근 살펴봤어요.' },
    { id: 'brave', e: '💪', n: '용기 내기', fix: ['brave'], cat: 'brave', t: '{H:은/는} {PRE}두 주먹을 꼭 쥐고 "나는 할 수 있어!" 하고 외쳤어요.' },
    { id: 'forward', e: '🚶', n: '씩씩하게 나아가기', fix: ['brave', 'chase'], cat: 'brave', t: '{W:은/는} {PRE}씩씩하게 한 걸음씩 앞으로 나아갔어요.' },
    { id: 'run', e: '🏃', n: '힘껏 달리기', fix: ['chase'], cat: 'brave', t: '{W:은/는} {PRE}다다다 힘껏 달려갔어요.' },
    { id: 'hug', e: '🤗', n: '꼭 안아 주기', fix: ['kind'], cat: 'kind', t: '{H:은/는} {PRE}따뜻하게 꼭 안아 주며 "괜찮아" 하고 말해 주었어요.' },
    { id: 'talk', e: '💬', n: '다정하게 묻기', fix: ['kind'], cat: 'kind', t: '{H:은/는} {PRE}다정하게 "무슨 일이야?" 하고 물어보았어요.' },
    { id: 'sing', e: '🎵', n: '노래 부르기', fix: ['music', 'calm'], cat: 'kind', t: '{W:은/는} {PRE}랄랄라 노래를 불렀어요.' },
    { id: 'breathe', e: '😌', n: '숨 크게 쉬기', fix: ['calm'], cat: 'brave', t: '{H:은/는} {PRE}숨을 크게 후우 쉬고 마음을 가라앉혔어요.' },
    { id: 'ask', e: '🙋', n: '도와 달라고 하기', fix: ['ask'], cat: 'together', t: '{H:은/는} {PRE}용기를 내어 "도와주세요!" 하고 외쳤어요. 그러자 {X:이/가} 달려와 도와주었어요.' },
    { id: 'climb', e: '🧗', n: '조심조심 오르기', fix: ['climb'], cat: 'brave', t: '{H:은/는} {PRE}한 발 한 발 조심조심 기어올랐어요.' },
    { id: 'build', e: '🪨', n: '징검다리 놓기', fix: ['build'], cat: 'clever', t: '{W:은/는} {PRE}커다란 돌을 하나하나 날라 징검다리를 놓았어요.' },
    { id: 'untie', e: '✋', n: '그물 풀어 주기', fix: ['untie'], cat: 'kind', t: '{H:은/는} {PRE}엉킨 그물을 한 올 한 올 조심조심 풀었어요.' },
    { id: 'make', e: '✂️', n: '직접 만들기', fix: ['make'], cat: 'clever', t: '{W:은/는} {PRE}가진 것으로 뚝딱뚝딱 새로 만들었어요.' },
    { id: 'fixit', e: '🔧', n: '고쳐 보기', fix: ['fix'], cat: 'clever', t: '{H:은/는} {PRE}이리저리 살펴보며 차근차근 고쳐 보았어요.' },
    { id: 'sorry', e: '🙏', n: '솔직하게 말하기', fix: ['sorry'], cat: 'kind', t: '{H:은/는} {PRE}"제가 주문을 잘못 외웠어요" 하고 솔직하게 말했어요.' },
    { id: 'clean', e: '🧹', n: '깨끗이 치우기', fix: ['clean'], cat: 'kind', t: '{W:은/는} {PRE}소매를 걷어붙이고 하나하나 깨끗이 치웠어요.' },
    { id: 'shelter', e: '⛱️', n: '비 피하기', fix: ['rain'], cat: 'clever', t: '{W:은/는} {PRE}비를 피할 곳을 찾아 쏙 들어갔어요.' },
    { id: 'jump', e: '🤸', n: '폴짝폴짝 뛰기', fix: ['cold'], cat: 'brave', t: '{H:은/는} {PRE}폴짝폴짝 뛰며 몸을 데웠어요.' },
    { id: 'together', e: '🤝', n: '힘을 모으기', fix: ['together', 'strong', 'rope'], cat: 'together', req: { f: 1 }, t: '{W:은/는} {PRE}서로 손을 꼭 잡고 "영차, 영차!" 힘을 모았어요.' },
    { id: 'plan', e: '🗣️', n: '함께 의논하기', fix: ['together', 'clever'], cat: 'together', req: { f: 1 }, t: '{W:은/는} {PRE}머리를 맞대고 함께 좋은 방법을 찾았어요.' },
    { id: 'spell', e: '✨', n: '배운 주문 외우기', fix: ['magic'], cat: 'magic', req: { w: 'magic' }, t: '{H:은/는} {PRE}학교에서 배운 주문을 또박또박 외웠어요. "수리수리 얍!"' }
  ];
  var SOLVE = {}; SOLVES.forEach(function (s) { SOLVE[s.id] = s; });

  /* ---------- 바람의 결과 ---------- */
  var OUTCOMES = [
    { id: 'done', e: '🎉', n: '이루었어요' },
    { id: 'gain', e: '💖', n: '더 소중한 걸 얻었어요' },
    { id: 'next', e: '🔜', n: '다음에 다시 해요' }
  ];

  /* ---------- 마지막 장면 (bg: 이 장면의 배경. 없으면 앞 쪽 배경) ---------- */
  var ENDS = [
    { id: 'feast', e: '🍽️', n: '다 함께 잔치', t: '그날 저녁, 모두 모여 맛있는 잔치를 열었어요.', req: { f: 1 }, tm: 'eve' },
    { id: 'sleep', e: '🌙', n: '별 보며 잠들기', t: '그날 밤, {H:은/는} 반짝이는 별을 보며 쿨쿨 잠이 들었어요.', bg: 'night' },
    { id: 'home', e: '🏠', n: '집에 돌아와 이야기', t: '{H:은/는} 집에 돌아와 오늘 있었던 일을 신나게 이야기했어요.', bg: 'room' },
    { id: 'sunset', e: '🌇', n: '노을 보며 웃기', t: '{W:은/는} 노을 지는 하늘을 바라보며 활짝 웃었어요.', bg: 'beach', tm: 'eve' },
    { id: 'best', e: '💕', n: '가장 친한 친구', t: '{H:과/와} {F1:은/는} 가장 친한 친구가 되었어요.', req: { f: 1 } },
    { id: 'promise', e: '👋', n: '다음 모험 약속', t: '{W:은/는} 다음 모험을 약속하며 손을 흔들었어요.', req: { f: 1 } },
    { id: 'dreamitem', e: '💭', n: '모두 꿈이었어요', t: '그런데 눈을 떠 보니… 모두 꿈이었어요! 하지만 {H}의 손에는 {I:이/가} 꼭 쥐어져 있었어요.', req: { item: 1 }, bg: 'room' },
    { id: 'dream', e: '💭', n: '모두 꿈이었어요', t: '그런데 눈을 떠 보니… 모두 꿈이었어요! 정말 신기한 꿈이었어요.', req: { noitem: 1 }, bg: 'room' },
    { id: 'photo', e: '📸', n: '기념사진 찰칵', t: '모두 모여 "김치!" 하고 찰칵, 기념사진을 찍었어요.', req: { f: 1 } },
    { id: 'diary', e: '📒', n: '그림일기 쓰기', t: '{H:은/는} 그림일기에 오늘의 모험을 꼼꼼히 그렸어요.', bg: 'room' },
    { id: 'vdance', e: '🎊', n: '말썽꾼과 춤을', t: '말썽꾼이던 {V}도 함께 모두 신나게 춤을 추었어요.', req: { vfriend: 1 } }
  ];
  var ENDING = {}; ENDS.forEach(function (e) { ENDING[e.id] = e; });
  WORLDS.forEach(function (w) { (w.ends || []).forEach(function (e) { e.world = w.id; ENDING[e.id] = e; }); });

  /* ---------- 단계 짜기 ----------
     cfg: { cast 1~4(주인공 포함), places 1~3, events 1~3, villain, detail:{trait,item,time,feel,outcome} } */
  var PRESETS = [
    { id: 'baby', e: '🌱', t: '아기 작가', age: '5~6세', cast: 2, places: 1, events: 1, villain: false, detail: {} },
    { id: 'kid', e: '🌿', t: '꼬마 작가', age: '7세', cast: 3, places: 2, events: 2, villain: false, detail: { trait: 1, item: 1, feel: 1, outcome: 1 } },
    { id: 'big', e: '🌳', t: '큰 작가', age: '8~9세', cast: 4, places: 3, events: 3, villain: true, detail: { trait: 1, item: 1, time: 1, feel: 1, outcome: 1 } }
  ];
  var FULL_DETAIL = { trait: 1, item: 1, time: 1, feel: 1, outcome: 1 };
  function normCfg(c) {
    c = c || {};
    var cfg = {
      cast: clamp(c.cast, 1, 4, 2), events: clamp(c.events, 1, 3, 1), places: 1,
      villain: !!c.villain, detail: {}
    };
    cfg.places = Math.min(clamp(c.places, 1, 3, 1), cfg.events);
    var d = c.detail || {};
    ['trait', 'item', 'time', 'feel', 'outcome'].forEach(function (k) { if (d[k]) cfg.detail[k] = 1; });
    return cfg;
  }
  function clamp(v, lo, hi, def) { v = Math.round(Number(v)); if (!isFinite(v)) v = def; return Math.max(lo, Math.min(hi, v)); }

  function plan(cfg, worldId) {
    cfg = normCfg(cfg);
    var d = cfg.detail, s = [];
    var add = function (key, kind, i, part) { s.push({ key: key, kind: kind, i: i, part: part }); };
    add('hero', 'hero', 0, 'start');
    if (d.trait) add('trait', 'trait', 0, 'start');
    add('goal', 'goal', 0, 'start');
    if (d.item) add('item', 'item', 0, 'start');
    if (d.time) add('time', 'time', 0, 'start');
    add('place', 'place', 0, 'start');
    var F = cfg.cast - 1, E = cfg.events, P = cfg.places;
    /* 친구 k: 0번은 처음에, k번은 k번째 사건 앞에서 만난다(사건이 모자라면 처음에) */
    var meetAt = []; for (var k = 0; k < F; k++) meetAt.push(k === 0 ? 0 : (k <= E - 1 ? k : 0));
    meetAt.forEach(function (at, k) { if (at === 0) add('meet' + k, 'meet', k, 'start'); });
    for (var i = 0; i < E; i++) {
      if (i > 0 && i < P) add('move' + i, 'move', i, 'event');
      if (i > 0) meetAt.forEach(function (at, k) { if (at === i) add('meet' + k, 'meet', k, 'event'); });
      var vil = cfg.villain && i === E - 1;
      if (vil) add('vil', 'vil', i, 'event');
      add('ev' + i, vil ? 'vev' : 'ev', i, 'event');
      if (d.feel) add('feel' + i, 'feel', i, 'event');
      add('sol' + i, 'sol', i, 'solve');
    }
    if (worldId === 'detective' && !cfg.villain) add('who', 'who', 0, 'solve');
    if (d.outcome && worldId !== 'detective') add('outcome', 'outcome', 0, 'end');
    add('ending', 'ending', 0, 'end');
    return s;
  }

  /* ---------- 상태 ---------- */
  function heroOf(id) { for (var i = 0; i < HEROES.length; i++) if (HEROES[i].id === id) return HEROES[i]; return null; }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function place(id) { var p = PLACES[id]; return p ? { id: id, e: p.e, n: p.n, bg: p.bg, tags: p.tags, go: p.go } : null; }
  function friend(id) { var f = FRIENDS[id]; return f ? { id: id, e: f.e, n: f.n, say: f.say, sk: f.sk } : null; }
  function villain(id) { var v = VILLAINS[id]; return v ? { id: id, e: v.e, n: v.n, say: v.say } : null; }

  function newState(book) {
    var w = WORLD[book.ep];
    return {
      w: w, cfg: normCfg(book.cfg), name: book.name || '', hero: null, trait: null, goal: null, items: [], time: null,
      place: null, bg: w.bg, tm: 'day', friends: [], vil: null, vstate: 'none', usedEv: {}, usedPl: {}, cats: {},
      feel: null, ev: null, culprit: null, rnd: SL.rng((book.seed >>> 0) || 1), toolUsed: false
    };
  }
  function H(st) { return st.name || (st.hero ? st.hero.n : '주인공'); }
  function vars(st, extra) {
    var h = H(st), f = st.friends;
    var v = {
      H: h, P: st.place ? st.place.n : '', F1: f[0] ? f[0].n : '', I: st.items[0] ? st.items[0].n : '',
      V: st.vil ? st.vil.n : '', L: st.goal && st.goal.L ? st.goal.L : '',
      W: f.length === 0 ? h : f.length === 1 ? J(h, '과/와') + ' ' + f[0].n : J(h, '과/와') + ' 친구들',
      YOU: f.length ? '너희' : '너', YOUJ: '는', PRE: st.feel ? st.feel.pre : ' '
    };
    if (v.PRE === ' ') v.PRE = '​'; /* 빈자리 표시(뒤에서 지움) */
    for (var k in extra) v[k] = extra[k];
    return v;
  }
  function T(st, str, extra) {
    return fmt(str, vars(st, extra || {})).replace(/​/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  function reqOk(req, st) {
    if (!req) return true;
    if (req.f && st.friends.length < req.f) return false;
    if (req.item && !st.items.length) return false;
    if (req.noitem && st.items.length) return false;
    if (req.w && st.w.id !== req.w) return false;
    if (req.vfriend && st.vstate !== 'friend') return false;
    return true;
  }
  function placeOk(ev, st) {
    var tags = st.place ? st.place.tags : [];
    if (ev.w && ev.w.indexOf(st.w.id) < 0) return false;
    if (ev.pl && !ev.pl.some(function (t) { return tags.indexOf(t) >= 0; })) return false;
    if (ev.nopl && ev.nopl.some(function (t) { return tags.indexOf(t) >= 0; })) return false;
    return true;
  }
  function inter(a, b) { for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) return a[i]; return null; }

  /* 해결 후보: 가방 속 물건과 친구의 재주를 먼저 보여 준다 */
  function solveCandidates(st) {
    var ev = st.ev, need = ev.need, out = [];
    st.items.forEach(function (it) { if (inter(it.tags, need)) out.push({ id: 'i:' + it.id, e: it.e, n: it.n + ' 쓰기', kind: 'item', item: it }); });
    st.friends.forEach(function (fr) {
      if (fr.villain) return;
      var sk = inter(fr.sk || [], need);
      if (sk) out.push({ id: 'f:' + fr.id + ':' + sk, e: fr.e, n: J(fr.n, '이/가') + ' ' + SKILL_N[sk], kind: 'friend', fr: fr, sk: sk });
    });
    SOLVES.forEach(function (s) { if (inter(s.fix, need) && reqOk(s.req, st)) out.push({ id: 'g:' + s.id, e: s.e, n: s.n, kind: 'gen', s: s }); });
    return out;
  }
  function findSolve(st, id) {
    var all = solveCandidates(st);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* 단계별 고를 카드 목록 (전부). 화면에서는 그중 몇 장만 보여 준다 */
  function allOptions(step, st) {
    var w = st.w;
    switch (step.kind) {
      case 'hero': return HEROES.slice();
      case 'trait': return TRAITS.slice();
      case 'goal': return w.goals.slice();
      case 'item': return ITEMS.slice();
      case 'time': return TIMES.slice();
      case 'place': case 'move':
        return w.places.filter(function (id) { return !st.usedPl[id]; }).map(place);
      case 'meet':
        return w.friends.map(friend).filter(function (f) {
          if (st.hero && f.e === st.hero.e) return false;
          return !st.friends.some(function (x) { return x.id === f.id || x.e === f.e; });
        });
      case 'vil': return w.villains.map(villain).filter(function (v) { return !st.friends.some(function (x) { return x.e === v.e; }) && !(st.hero && st.hero.e === v.e); });
      case 'ev': return EVENTS.filter(function (e) { return !st.usedEv[e.id] && reqOk(e.req, st) && placeOk(e, st); });
      case 'vev': return VEVENTS.filter(function (e) { return !st.usedEv[e.id] && reqOk(e.req, st); });
      case 'feel': return FEELS.slice();
      case 'sol': return solveCandidates(st);
      case 'who': return w.who.map(function (a) { return { id: a[0], e: a[1], n: a[2] }; }).filter(function (c) { return !st.friends.some(function (x) { return x.e === c.e; }) && !(st.hero && st.hero.e === c.e); });
      case 'outcome': return OUTCOMES.slice();
      case 'ending':
        return (w.ends || []).concat(ENDS).filter(function (e) { return reqOk(e.req, st); });
    }
    return [];
  }

  /* 화면에 보여 줄 카드 고르기: 너무 많으면 줄인다. 해결은 물건·친구 재주 카드를 1장씩 꼭 넣는다 */
  var SHOW = { hero: 12, trait: 5, goal: 6, item: 12, time: 4, place: 9, move: 9, meet: 6, vil: 6, ev: 4, vev: 4, feel: 6, sol: 4, who: 6, outcome: 3, ending: 4 };
  function showOptions(step, st, r) {
    var all = allOptions(step, st), max = SHOW[step.kind] || 6;
    r = r || Math.random;
    if (step.kind === 'sol') {
      var items = SL.shuffle(all.filter(function (c) { return c.kind === 'item'; }), r);
      var frs = SL.shuffle(all.filter(function (c) { return c.kind === 'friend'; }), r);
      var gens = SL.shuffle(all.filter(function (c) { return c.kind === 'gen'; }), r);
      var pick = [].concat(items.slice(0, 1), frs.slice(0, 1));
      gens.forEach(function (g) { if (pick.length < max) pick.push(g); });
      items.slice(1).concat(frs.slice(1)).forEach(function (c) { if (pick.length < max) pick.push(c); });
      return SL.shuffle(pick, r);
    }
    if (step.kind === 'ending') {
      var own = all.filter(function (e) { return e.world; }), rest = SL.shuffle(all.filter(function (e) { return !e.world; }), r);
      var vd = rest.filter(function (e) { return e.id === 'vdance'; });
      return SL.shuffle(own.slice(0, 1).concat(vd, rest.filter(function (e) { return e.id !== 'vdance'; })).slice(0, max), r);
    }
    if (all.length <= max) return all;
    return SL.shuffle(all, r).slice(0, max);
  }

  /* ---------- 질문 ---------- */
  var Q = {
    hero: '주인공을 골라요', trait: '{H:은/는} 어떤 아이일까요?', goal: '{H:은/는} 무엇을 하고 싶을까요?',
    item: '가방에 무엇을 챙길까요?', time: '언제 떠날까요?', place: '{H:은/는} 어디로 갈까요?', move: '다음에는 어디로 갈까요?',
    meet: '누구를 만날까요?', vil: '말썽꾼은 누구일까요?', ev: '어떤 일이 생겼을까요?', vev: '말썽꾼이 무슨 일을 벌였을까요?',
    feel: '{H:은/는} 어떤 기분이었을까요?', sol: '어떻게 해결했을까요?', who: '범인은 누구였을까요?',
    outcome: '{H}의 바람은 어떻게 되었을까요?', ending: '마지막 장면을 골라요'
  };
  var PART = { start: '처음', event: '사건', solve: '해결', end: '끝' };

  /* ---------- 조립: 고른 카드를 차례로 적용하며 쪽을 만든다 ----------
     upto: 이 단계 앞까지만 적용(카드 고르는 중에 상태를 알 때). emit=false면 쪽은 만들지 않는다 */
  function run(book, upto, emit) {
    var st = newState(book), steps = plan(book.cfg, book.ep), pages = [];
    if (upto == null) upto = steps.length;
    var picks = book.picks || {};
    function scene(o) {
      o = o || {};
      return {
        bg: o.bg || st.bg, tm: o.tm || st.tm,
        cast: [st.hero ? st.hero.e : '🙂'].concat(st.friends.map(function (f) { return f.e; })),
        vil: o.vil === undefined ? (st.vstate === 'here' ? st.vil.e : null) : o.vil,
        obj: (o.obj || []).filter(Boolean).slice(0, 2), mood: o.mood || 'calm', guest: o.guest || null
      };
    }
    function page(text, part, sc) { if (emit) pages.push({ t: text, part: part, sc: sc }); }
    for (var si = 0; si < upto && si < steps.length; si++) {
      var step = steps[si], id = picks[step.key];
      if (id == null) throw new Error('고르지 않은 단계: ' + step.key);
      var nextPick = function (key) { return picks[key]; };
      switch (step.kind) {
        case 'hero': st.hero = heroOf(id); if (!st.hero) throw new Error('없는 주인공 ' + id); break;
        case 'trait': st.trait = byId(TRAITS, id); if (!st.trait) throw new Error('없는 성격 ' + id); break;
        case 'goal': {
          st.goal = byId(st.w.goals, id); if (!st.goal) throw new Error('없는 바람 ' + id);
          var hn = st.hero.n + (st.name ? ' ' + st.name : '');
          var HI = (st.trait ? st.trait.adj + ' ' : '') + J(hn, '이/가');
          page(T(st, st.w.intro, { HI: HI }) + (st.trait ? ' ' + T(st, st.trait.t) : ''), 'start', scene({ obj: [] }));
          var itemId = st.cfg.detail.item ? nextPick('item') : null, it = itemId ? byId(ITEMS, itemId) : null;
          page(T(st, st.goal.t) + (it ? ' ' + T(st, '그래서 가방에 {I:을/를} 챙겼어요.', { I: it.n }) : ''), 'start', scene({ obj: [st.goal.e, it && it.e] }));
          break;
        }
        case 'item': { var item = byId(ITEMS, id); if (!item) throw new Error('없는 물건 ' + id); st.items.push(item); break; }
        case 'time': st.time = byId(TIMES, id); if (!st.time) throw new Error('없는 때 ' + id); break;
        case 'place': case 'move': {
          var pl = place(id);
          if (!pl || st.w.places.indexOf(id) < 0 || st.usedPl[id]) throw new Error('고를 수 없는 장소 ' + id);
          var first = step.kind === 'place';
          if (first && st.w.launch) {
            page(T(st, st.w.launch), 'start', scene({ bg: st.w.launchBg || 'space', tm: 'day', obj: [st.w.ic] }));
          }
          st.place = pl; st.usedPl[id] = 1; st.bg = pl.bg;
          if (first && st.time) st.tm = st.time.tm;
          var lead = first ? (st.time ? st.time.t + ' ' : '어느 날, ') : (st.w.move ? st.w.move + ' ' : '그다음, ');
          page(lead + T(st, pl.go), first ? 'start' : 'event', scene({ obj: [pl.e] }));
          break;
        }
        case 'meet': {
          var fr = friend(id);
          if (!fr || st.w.friends.indexOf(id) < 0 || st.friends.some(function (x) { return x.id === id; })) throw new Error('고를 수 없는 친구 ' + id);
          var txt = step.part === 'start' ? T(st, '{P}에서 {F:을/를} 만났어요.', { F: fr.n }) : T(st, '그때 {F:이/가} 다가와 말했어요.', { F: fr.n });
          st.friends.push(fr);
          page(txt + ' "' + fr.say + '"', step.part, scene({ obj: [] }));
          break;
        }
        case 'vil': {
          st.vil = villain(id); if (!st.vil || st.w.villains.indexOf(id) < 0) throw new Error('없는 말썽꾼 ' + id);
          st.vstate = 'here';
          page(T(st, '그때, 말썽꾼 {V:이/가} 나타났어요!') + ' ' + st.vil.say, 'event', scene({ mood: 'tense' }));
          break;
        }
        case 'ev': case 'vev': {
          var ev = EVENT[id];
          var okList = allOptions(step, st);
          if (!ev || !okList.some(function (e) { return e.id === id; })) throw new Error('고를 수 없는 사건 ' + id);
          st.ev = ev; st.usedEv[id] = 1; st.feel = null;
          var E = st.cfg.events;
          var lead2 = step.kind === 'vev' ? '그러더니 ' : step.i === 0 ? '그런데 ' : (step.i === E - 1 && E >= 3 ? '그때, 가장 큰 일이 벌어졌어요! ' : '그런데 이번에는 ');
          var et = lead2 + T(st, ev.t);
          var feelId = st.cfg.detail.feel ? nextPick('feel' + step.i) : null, fe = feelId ? byId(FEELS, feelId) : null;
          if (fe) et += ' ' + T(st, fe.t);
          page(et, 'event', scene({ obj: [ev.e, fe && fe.e], mood: 'tense' }));
          break;
        }
        case 'feel': st.feel = byId(FEELS, id); if (!st.feel) throw new Error('없는 기분 ' + id); break;
        case 'sol': {
          var c = findSolve(st, id);
          if (!c) throw new Error('고를 수 없는 해결 ' + id + ' (사건 ' + st.ev.id + ')');
          var tag, stxt, cat, guest = null;
          if (c.kind === 'item') {
            tag = inter(c.item.tags, st.ev.need); cat = 'tool';
            stxt = T(st, '{H:은/는} {PRE}가방에서 {I:을/를} 꺼냈어요.', { I: c.item.n }) + ' ' + c.item.use;
          } else if (c.kind === 'friend') {
            tag = c.sk; cat = 'together';
            stxt = T(st, SKILL_T[c.sk], { F: c.fr.n });
          } else {
            tag = inter(c.s.fix, st.ev.need); cat = c.s.cat;
            var X = c.s.id === 'ask' ? SL.pick(st.w.helpers, st.rnd) : null;
            if (X) guest = '🙋';
            stxt = T(st, c.s.t, X ? { X: X } : null);
          }
          st.cats[cat] = (st.cats[cat] || 0) + 1;
          var res;
          if (st.vstate === 'here') {
            var friendly = cat === 'kind' || (c.kind === 'item' && c.item.tags.indexOf('kind') >= 0);
            var stole = st.ev.id === 'steal';
            if (friendly) {
              res = stole ? T(st, '{V:은/는} {I:을/를} 돌려주며 머리를 긁적였어요. "미안해. 사실은 나도 같이 놀고 싶었어." 그래서 모두 친구가 되었어요.')
                : T(st, '{V:은/는} 머리를 긁적이며 말했어요. "미안해. 사실은 나도 같이 놀고 싶었어." 그래서 모두 친구가 되었어요.');
              st.vstate = 'friend';
              st.friends.push({ id: 'v:' + st.vil.id, e: st.vil.e, n: st.vil.n, sk: [], villain: true });
            } else {
              res = stole ? T(st, '깜짝 놀란 {V:은/는} {I:을/를} 떨어뜨리고 허둥지둥 달아났어요.')
                : T(st, '{V:은/는} "흥, 다음엔 지지 않을 테다!" 하고 쌩 달아났어요.');
              st.vstate = 'gone';
            }
          } else {
            var ok = st.ev.ok;
            res = T(st, typeof ok === 'string' ? ok : (ok[tag] || ok._));
          }
          var callback = c.kind === 'item' ? ' ' + T(st, '처음에 챙긴 {I:이/가} 큰 도움이 되었어요!', { I: c.item.n }) : '';
          if (c.kind === 'item') st.toolUsed = true;
          page(stxt + ' ' + res + callback, 'solve', scene({ obj: [c.e, c.kind === 'item' ? null : st.ev.e], mood: 'happy', vil: null, guest: guest }));
          st.feel = null;
          break;
        }
        case 'who': {
          var who = byId(allOptions(step, st), id); if (!who) throw new Error('없는 범인 ' + id);
          st.culprit = who;
          page(T(st, '알고 보니 범인은 바로 {WHO:이었어요/였어요}! {WHO:이/가} {L:을/를} 몰래 가지고 놀고 있었던 거예요.', { WHO: who.n }), 'solve', scene({ obj: [who.e, st.goal.e], mood: 'happy', guest: who.e }));
          break;
        }
        case 'outcome': st.outcome = byId(OUTCOMES, id); if (!st.outcome) throw new Error('없는 결과 ' + id); if (emit) endPage(); break;
        case 'ending': {
          var en = byId(allOptions(step, st), id); if (!en) throw new Error('고를 수 없는 마지막 장면 ' + id);
          if (!st.outcome) { st.outcome = OUTCOMES[0]; if (emit) endPage(); }
          st.ending = en;
          if (en.bg) st.bg = en.bg;
          page(T(st, en.t), 'end', scene({ bg: en.bg || st.bg, tm: en.tm || (en.bg ? 'day' : st.tm), obj: [en.e], mood: 'happy', vil: null }));
          break;
        }
      }
    }
    /* 바람의 결과 + 성장 문장 (한 쪽) */
    function endPage() {
      var g = st.goal, o = st.outcome.id, t;
      if (o === 'done') t = T(st, '{W:은/는} 드디어 ' + g.done + '!');
      else if (o === 'gain') t = T(st, g.miss) + ' ' + T(st, '하지만 괜찮아요. 그보다 더 소중한 {G:을/를} 얻었으니까요.', { G: st.friends.length ? '친구' : '용기' });
      else t = T(st, g.miss) + ' ' + T(st, '그래서 {W:은/는} 다음에 꼭 다시 해 보기로 약속했어요.');
      var gr = growth(st);
      page(t + (gr ? ' ' + gr : ''), 'end', scene({ obj: [o === 'done' ? g.e : st.outcome.e, gr ? '🌱' : null], mood: 'happy', vil: null }));
    }
    return { st: st, steps: steps, pages: pages };
  }

  /* 성격 × 해결 방식 → 성장 문장 (인물이 변한다는 것을 보여 준다) */
  function growth(st) {
    if (!st.trait) return '';
    var c = st.cats, has = function (k) { return !!c[k]; };
    switch (st.trait.id) {
      case 'shy': return has('brave') ? T(st, '겁 많던 {H:은/는} 이제 조금 더 용감해졌어요.') : has('together') ? T(st, '겁 많던 {H:은/는} 친구와 함께라면 무섭지 않다는 걸 알았어요.') : T(st, '겁 많던 {H:은/는} 한 걸음씩 하면 해낼 수 있다는 걸 알았어요.');
      case 'brave': return has('together') ? T(st, '씩씩한 {H:은/는} 혼자보다 함께일 때 더 힘이 세다는 걸 알았어요.') : has('kind') ? T(st, '씩씩한 {H:은/는} 따뜻한 마음도 큰 용기라는 걸 알았어요.') : T(st, '씩씩한 {H:은/는} 오늘도 끝까지 해냈어요.');
      case 'curious': return has('clever') || has('tool') ? T(st, '궁금한 게 많은 {H:은/는} 차근차근 생각하면 답을 찾을 수 있다는 걸 알았어요.') : T(st, '궁금한 게 많은 {H:은/는} 세상에는 신기한 일이 가득하다는 걸 알았어요.');
      case 'playful': return has('kind') || has('together') ? T(st, '장난꾸러기 {H:은/는} 친구를 돕는 것이 장난보다 더 즐겁다는 걸 알았어요.') : T(st, '장난꾸러기 {H:은/는} 오늘 일을 떠올리며 키득키득 웃었어요.');
      case 'gentle': return T(st, '마음씨 고운 {H} 덕분에 모두의 얼굴에 웃음꽃이 피었어요.');
    }
    return '';
  }

  /* ---------- 바깥에서 쓰는 함수 ---------- */
  function newBook(ep, cfg) {
    return { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: Date.now(), ep: ep, cfg: normCfg(cfg), picks: {}, seed: (Math.random() * 4294967296) >>> 0, name: '', title: '', author: '' };
  }
  function stateAt(book, i) { return run(book, i, false).st; }
  function optionsAt(book, i, r) { var steps = plan(book.cfg, book.ep); return showOptions(steps[i], stateAt(book, i), r); }
  function allOptionsAt(book, i) { var steps = plan(book.cfg, book.ep); return allOptions(steps[i], stateAt(book, i)); }
  function question(book, i) { var steps = plan(book.cfg, book.ep); var st = stateAt(book, i); return T(st, Q[steps[i].kind]); }
  function compose(book) { return run(book, null, true).pages; }
  /* 남은 단계를 무작위로 채운다 (테스트, 쪽 수 어림, "골라 줘") */
  function randomFill(book, r, from) {
    var steps = plan(book.cfg, book.ep);
    for (var i = from || 0; i < steps.length; i++) {
      var opts = optionsAt(book, i, r);
      if (!opts.length) throw new Error('고를 카드가 없음: ' + steps[i].key + ' @' + book.ep);
      book.picks[steps[i].key] = SL.pick(opts, r).id;
    }
    return book;
  }
  function autoTitle(book) {
    var st = stateAt(book, 1);
    var t = fmt(WORLD[book.ep].title, { H: book.name || (st.hero ? st.hero.n : '주인공') });
    return Array.from(t).slice(0, 24).join('');
  }
  function estimate(cfg, ep) {
    var b = newBook(ep || 'adv', cfg); randomFill(b, SL.rng(7));
    return { picks: plan(b.cfg, b.ep).length, pages: compose(b).length + 2 };
  }
  /* 화면 위 점에 보여 줄 그림 */
  function pickEmoji(book, i) {
    var steps = plan(book.cfg, book.ep), id = book.picks[steps[i].key];
    if (id == null) return '';
    var st = stateAt(book, i), all = allOptions(steps[i], st);
    for (var k = 0; k < all.length; k++) if (all[k].id === id) return all[k].e;
    return '•';
  }

  SL.data = { HEROES: HEROES, TRAITS: TRAITS, ITEMS: ITEMS, TIMES: TIMES, PLACES: PLACES, FRIENDS: FRIENDS, VILLAINS: VILLAINS, WORLDS: WORLDS, WORLD: WORLD, EVENTS: EVENTS, VEVENTS: VEVENTS, FEELS: FEELS, SOLVES: SOLVES, ENDS: ENDS, OUTCOMES: OUTCOMES, PRESETS: PRESETS, FULL_DETAIL: FULL_DETAIL, PART: PART };
  SL.story = { plan: plan, normCfg: normCfg, newBook: newBook, stateAt: stateAt, optionsAt: optionsAt, allOptionsAt: allOptionsAt, question: question, compose: compose, randomFill: randomFill, autoTitle: autoTitle, estimate: estimate, pickEmoji: pickEmoji };
})(window.SL);
