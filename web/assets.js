export const STEP_META = [
  { id: "step1", number: 1, title: "아침 먹기", cheer: "냠냠 맛있는 아침을 다 먹었어요!" },
  { id: "step2", number: 2, title: "세수·양치", cheer: "치카치카 반짝반짝 깨끗해졌어요!" },
  { id: "step3", number: 3, title: "옷 입기", cheer: "예쁜 옷으로 멋지게 갈아입었어요!" },
  { id: "step4", number: 4, title: "가방 챙기기", cheer: "가방까지 척! 이제 신나게 출발하자!" },
];

export const LOCATIONS = [
  { id: "seoul", name: "서울 중구", lat: 37.5665, lon: 126.978 },
  { id: "gangnam", name: "서울 강남구", lat: 37.5172, lon: 127.0473 },
  { id: "mapo", name: "서울 마포구", lat: 37.5663, lon: 126.9019 },
  { id: "bundang", name: "성남 분당구", lat: 37.3827, lon: 127.1189 },
  { id: "suwon", name: "수원 영통구", lat: 37.2596, lon: 127.0465 },
  { id: "incheon", name: "인천 연수구", lat: 37.4102, lon: 126.6783 },
  { id: "busan", name: "부산 해운대구", lat: 35.1631, lon: 129.1636 },
  { id: "daegu", name: "대구 수성구", lat: 35.8581, lon: 128.6306 },
  { id: "daejeon", name: "대전 유성구", lat: 36.3622, lon: 127.3561 },
  { id: "gwangju", name: "광주 서구", lat: 35.152, lon: 126.8895 },
  { id: "jeju", name: "제주 제주시", lat: 33.4996, lon: 126.5312 },
];

export const DAYCARE_SVG = `
<svg viewBox="0 0 100 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="50" cy="83" rx="42" ry="5" fill="#d7e8d0"/>
  <rect x="16" y="38" width="68" height="42" rx="6" fill="#fff7e6" stroke="#8d6e63" stroke-width="3"/>
  <path d="M10 42 L50 14 L90 42 Z" fill="#ff7043" stroke="#8d6e63" stroke-width="3" stroke-linejoin="round"/>
  <rect x="44" y="5" width="4" height="14" fill="#8d6e63"/>
  <path d="M48 6 L66 11 L48 16 Z" fill="#ffd54f" stroke="#8d6e63" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="50" cy="29" r="7" fill="#fff" stroke="#8d6e63" stroke-width="2.5"/>
  <path d="M50 25 V29 L53 31" stroke="#5d4037" stroke-width="2" stroke-linecap="round" fill="none"/>
  <rect x="23" y="48" width="14" height="14" rx="3" fill="#81d4fa" stroke="#8d6e63" stroke-width="2.5"/>
  <rect x="63" y="48" width="14" height="14" rx="3" fill="#81d4fa" stroke="#8d6e63" stroke-width="2.5"/>
  <path d="M42 80 V56 A8 8 0 0 1 58 56 V80 Z" fill="#ffb74d" stroke="#8d6e63" stroke-width="2.5"/>
  <circle cx="54" cy="68" r="2" fill="#5d4037"/>
</svg>`;

export const STEP_ILLUSTRATIONS = {
  step1: `
  <svg viewBox="0 0 220 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="110" cy="96" r="82" fill="#fff8e1"/>
    <!-- Hair back -->
    <ellipse cx="110" cy="64" rx="37" ry="34" fill="#5d4037"/>
    <!-- Ponytail puffs -->
    <circle cx="72" cy="54" r="12" fill="#5d4037"/>
    <circle cx="148" cy="54" r="12" fill="#5d4037"/>
    <circle cx="79" cy="50" r="4.5" fill="#ff7043"/>
    <circle cx="141" cy="50" r="4.5" fill="#ff7043"/>
    <!-- Body / Yellow shirt -->
    <path d="M82 104 Q110 96 138 104 L145 138 H75 Z" fill="#ffd54f" stroke="#5d4037" stroke-width="3" stroke-linejoin="round"/>
    <!-- Face -->
    <circle cx="110" cy="69" r="29" fill="#ffe0bd" stroke="#5d4037" stroke-width="3"/>
    <!-- Bangs -->
    <path d="M81 62 Q94 45 110 47 Q126 45 139 62 Q125 53 110 56 Q95 53 81 62 Z" fill="#5d4037"/>
    <!-- Eyes & blush -->
    <circle cx="98" cy="70" r="3.5" fill="#3e2723"/>
    <circle cx="122" cy="70" r="3.5" fill="#3e2723"/>
    <circle cx="97" cy="68.8" r="1.2" fill="#fff"/>
    <circle cx="121" cy="68.8" r="1.2" fill="#fff"/>
    <ellipse cx="90" cy="77" rx="5.5" ry="3.2" fill="#ff8a80" opacity="0.7"/>
    <ellipse cx="130" cy="77" rx="5.5" ry="3.2" fill="#ff8a80" opacity="0.7"/>
    <!-- Happy open mouth -->
    <path d="M104 80 Q110 88 116 80 Z" fill="#ff7043" stroke="#5d4037" stroke-width="2" stroke-linejoin="round"/>
    <!-- Arms holding spoon -->
    <path d="M83 112 Q74 124 89 128" fill="none" stroke="#ffe0bd" stroke-width="9" stroke-linecap="round"/>
    <path d="M137 112 Q146 124 130 124" fill="none" stroke="#ffe0bd" stroke-width="9" stroke-linecap="round"/>
    <path d="M132 103 L123 124" stroke="#b0bec5" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="133" cy="100" rx="6" ry="4" fill="#cfd8dc" stroke="#5d4037" stroke-width="2"/>
    <!-- Table -->
    <rect x="28" y="132" width="164" height="14" rx="5" fill="#d7a86e" stroke="#5d4037" stroke-width="3"/>
    <rect x="44" y="146" width="10" height="34" rx="3" fill="#b8844c" stroke="#5d4037" stroke-width="2.5"/>
    <rect x="166" y="146" width="10" height="34" rx="3" fill="#b8844c" stroke="#5d4037" stroke-width="2.5"/>
    <!-- Rice & soup bowls -->
    <path d="M68 122 H102 A17 15 0 0 1 68 122 Z" fill="#ffffff" stroke="#5d4037" stroke-width="2.5"/>
    <path d="M72 122 Q85 110 98 122 Z" fill="#fffde7" stroke="#5d4037" stroke-width="2"/>
    <path d="M114 123 H150 A18 14 0 0 1 114 123 Z" fill="#ffcc80" stroke="#5d4037" stroke-width="2.5"/>
    <ellipse cx="132" cy="123" rx="15" ry="3.5" fill="#ff8a65"/>
    <!-- Cup -->
    <rect x="158" y="114" width="16" height="18" rx="3" fill="#81d4fa" stroke="#5d4037" stroke-width="2.5"/>
    <!-- Steam -->
    <path d="M126 108 Q123 101 127 96" stroke="#ffab91" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    <path d="M138 108 Q141 101 137 96" stroke="#ffab91" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  </svg>`,

  step2: `
  <svg viewBox="0 0 220 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="110" cy="96" r="82" fill="#e1f5fe"/>
    <!-- Sparkles & bubbles -->
    <circle cx="48" cy="70" r="7" fill="#fff" stroke="#4fc3f7" stroke-width="2.5"/>
    <circle cx="62" cy="54" r="4.5" fill="#fff" stroke="#4fc3f7" stroke-width="2"/>
    <circle cx="168" cy="64" r="8" fill="#fff" stroke="#4fc3f7" stroke-width="2.5"/>
    <path d="M164 95 L167 87 L170 95 L178 98 L170 101 L167 109 L164 101 L156 98 Z" fill="#ffd54f"/>
    <!-- Hair & head -->
    <ellipse cx="110" cy="64" rx="37" ry="34" fill="#5d4037"/>
    <circle cx="72" cy="54" r="12" fill="#5d4037"/>
    <circle cx="148" cy="54" r="12" fill="#5d4037"/>
    <circle cx="79" cy="50" r="4.5" fill="#4fc3f7"/>
    <circle cx="141" cy="50" r="4.5" fill="#4fc3f7"/>
    <path d="M84 102 Q110 95 136 102 L141 136 H79 Z" fill="#fff59d" stroke="#5d4037" stroke-width="3"/>
    <circle cx="110" cy="69" r="29" fill="#ffe0bd" stroke="#5d4037" stroke-width="3"/>
    <path d="M81 62 Q94 45 110 47 Q126 45 139 62 Q125 53 110 56 Q95 53 81 62 Z" fill="#5d4037"/>
    <!-- Happy squinting eyes -->
    <path d="M93 69 Q98 63 103 69" stroke="#3e2723" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M117 69 Q122 63 127 69" stroke="#3e2723" stroke-width="3" stroke-linecap="round" fill="none"/>
    <ellipse cx="90" cy="77" rx="5.5" ry="3.2" fill="#ff8a80" opacity="0.7"/>
    <ellipse cx="130" cy="77" rx="5.5" ry="3.2" fill="#ff8a80" opacity="0.7"/>
    <!-- Toothpaste foam smile -->
    <ellipse cx="110" cy="83" rx="11" ry="6" fill="#ffffff" stroke="#5d4037" stroke-width="2"/>
    <!-- Toothbrush -->
    <path d="M112 84 L145 96" stroke="#29b6f6" stroke-width="6" stroke-linecap="round"/>
    <rect x="103" y="79" width="13" height="6" rx="2" fill="#ffffff" stroke="#5d4037" stroke-width="1.8"/>
    <path d="M136 108 Q148 102 142 96" fill="none" stroke="#ffe0bd" stroke-width="9" stroke-linecap="round"/>
    <!-- Washbasin -->
    <path d="M55 132 H165 A55 40 0 0 1 55 132 Z" fill="#ffffff" stroke="#5d4037" stroke-width="3"/>
    <ellipse cx="110" cy="132" rx="55" ry="9" fill="#b3e5fc" stroke="#5d4037" stroke-width="3"/>
    <!-- Cup on rim -->
    <rect x="148" y="114" width="18" height="20" rx="4" fill="#4fc3f7" stroke="#5d4037" stroke-width="2.5"/>
    <rect x="98" y="168" width="24" height="16" fill="#e1f5fe" stroke="#5d4037" stroke-width="3"/>
  </svg>`,

  step3: `
  <svg viewBox="0 0 220 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="110" cy="96" r="82" fill="#f3e5f5"/>
    <!-- Neat folded clothes on floor -->
    <rect x="42" y="148" width="46" height="16" rx="6" fill="#81d4fa" stroke="#5d4037" stroke-width="2.5"/>
    <rect x="46" y="138" width="40" height="13" rx="5" fill="#ffab91" stroke="#5d4037" stroke-width="2.5"/>
    <rect x="136" y="146" width="46" height="18" rx="6" fill="#a5d6a7" stroke="#5d4037" stroke-width="2.5"/>
    <!-- Girl -->
    <ellipse cx="110" cy="54" rx="35" ry="31" fill="#5d4037"/>
    <circle cx="74" cy="46" r="11" fill="#5d4037"/>
    <circle cx="146" cy="46" r="11" fill="#5d4037"/>
    <circle cx="80" cy="42" r="4" fill="#ab47bc"/>
    <circle cx="140" cy="42" r="4" fill="#ab47bc"/>
    <!-- Skirt / legs -->
    <path d="M95 140 V168 M125 140 V168" stroke="#ffe0bd" stroke-width="10" stroke-linecap="round"/>
    <path d="M84 128 H136 L142 146 H78 Z" fill="#3f51b5" stroke="#5d4037" stroke-width="3" stroke-linejoin="round"/>
    <!-- Putting on bright yellow top -->
    <path d="M72 98 L85 88 H135 L154 102 L145 116 L134 108 V130 H86 V108 L76 116 Z" fill="#ffd54f" stroke="#5d4037" stroke-width="3" stroke-linejoin="round"/>
    <!-- Raised arms -->
    <path d="M76 105 Q64 94 74 86" fill="none" stroke="#ffe0bd" stroke-width="9" stroke-linecap="round"/>
    <path d="M145 105 Q158 94 148 86" fill="none" stroke="#ffe0bd" stroke-width="9" stroke-linecap="round"/>
    <!-- Face -->
    <circle cx="110" cy="60" r="27" fill="#ffe0bd" stroke="#5d4037" stroke-width="3"/>
    <path d="M83 54 Q95 39 110 41 Q125 39 137 54 Q124 46 110 48 Q96 46 83 54 Z" fill="#5d4037"/>
    <circle cx="99" cy="62" r="3.3" fill="#3e2723"/>
    <circle cx="121" cy="62" r="3.3" fill="#3e2723"/>
    <ellipse cx="92" cy="68" rx="5" ry="3" fill="#ff8a80" opacity="0.7"/>
    <ellipse cx="128" cy="68" rx="5" ry="3" fill="#ff8a80" opacity="0.7"/>
    <path d="M104 72 Q110 78 116 72" stroke="#5d4037" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    <!-- Sparkles -->
    <path d="M162 62 L165 56 L168 62 L174 65 L168 68 L165 74 L162 68 L156 65 Z" fill="#ffd54f"/>
  </svg>`,

  step4: `
  <svg viewBox="0 0 220 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="110" cy="96" r="82" fill="#e8f5e9"/>
    <!-- Backpack straps & bag behind -->
    <rect x="76" y="92" width="68" height="46" rx="16" fill="#ffca28" stroke="#5d4037" stroke-width="3"/>
    <rect x="88" y="108" width="44" height="22" rx="8" fill="#ffb300" stroke="#5d4037" stroke-width="2.5"/>
    <!-- Legs & shoes -->
    <path d="M98 142 V168 M122 142 V168" stroke="#ffe0bd" stroke-width="10" stroke-linecap="round"/>
    <ellipse cx="95" cy="172" rx="10" ry="5.5" fill="#ff7043" stroke="#5d4037" stroke-width="2.5"/>
    <ellipse cx="125" cy="172" rx="10" ry="5.5" fill="#ff7043" stroke="#5d4037" stroke-width="2.5"/>
    <!-- Hair -->
    <ellipse cx="110" cy="56" rx="35" ry="32" fill="#5d4037"/>
    <circle cx="74" cy="48" r="11" fill="#5d4037"/>
    <circle cx="146" cy="48" r="11" fill="#5d4037"/>
    <circle cx="80" cy="44" r="4" fill="#66bb6a"/>
    <circle cx="140" cy="44" r="4" fill="#66bb6a"/>
    <!-- Outfit -->
    <path d="M88 92 H132 L138 130 H82 Z" fill="#fff176" stroke="#5d4037" stroke-width="3"/>
    <path d="M83 128 H137 L142 145 H78 Z" fill="#42a5f5" stroke="#5d4037" stroke-width="3" stroke-linejoin="round"/>
    <!-- Backpack straps over shoulders -->
    <path d="M94 92 V126 M126 92 V126" stroke="#ff9800" stroke-width="6" stroke-linecap="round"/>
    <!-- Waving arm -->
    <path d="M133 98 Q154 84 156 64" fill="none" stroke="#ffe0bd" stroke-width="10" stroke-linecap="round"/>
    <circle cx="157" cy="62" r="6" fill="#ffe0bd" stroke="#5d4037" stroke-width="2.5"/>
    <path d="M87 98 Q74 114 78 124" fill="none" stroke="#ffe0bd" stroke-width="10" stroke-linecap="round"/>
    <!-- Face -->
    <circle cx="110" cy="61" r="28" fill="#ffe0bd" stroke="#5d4037" stroke-width="3"/>
    <path d="M82 55 Q95 40 110 42 Q125 40 138 55 Q124 47 110 49 Q96 47 82 55 Z" fill="#5d4037"/>
    <circle cx="99" cy="63" r="3.4" fill="#3e2723"/>
    <circle cx="121" cy="63" r="3.4" fill="#3e2723"/>
    <circle cx="98" cy="61.8" r="1.1" fill="#fff"/>
    <circle cx="120" cy="61.8" r="1.1" fill="#fff"/>
    <ellipse cx="91" cy="70" rx="5" ry="3" fill="#ff8a80" opacity="0.7"/>
    <ellipse cx="129" cy="70" rx="5" ry="3" fill="#ff8a80" opacity="0.7"/>
    <path d="M103 73 Q110 81 117 73 Z" fill="#ff7043" stroke="#5d4037" stroke-width="2"/>
    <!-- Cheer lines -->
    <path d="M167 52 L175 46 M170 62 L179 62" stroke="#66bb6a" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
};

const BABYSHARK_MASCOT_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Dorsal & side fins -->
  <path d="M52 24 Q60 4 74 26 Z" fill="#fdd835" stroke="#5d4037" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M16 66 Q4 56 14 82 Z" fill="#fdd835" stroke="#5d4037" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M104 66 Q116 56 106 82 Z" fill="#fdd835" stroke="#5d4037" stroke-width="3.5" stroke-linejoin="round"/>
  <!-- Round shark body -->
  <ellipse cx="60" cy="66" rx="44" ry="38" fill="#ffeb3b" stroke="#5d4037" stroke-width="3.5"/>
  <!-- White belly -->
  <path d="M24 72 Q60 58 96 72 Q92 98 60 100 Q28 98 24 72 Z" fill="#ffffff" stroke="#5d4037" stroke-width="2.5"/>
  <!-- Big sparkly eyes -->
  <circle cx="43" cy="54" r="8" fill="#ffffff" stroke="#5d4037" stroke-width="2.5"/>
  <circle cx="77" cy="54" r="8" fill="#ffffff" stroke="#5d4037" stroke-width="2.5"/>
  <circle cx="44" cy="54" r="4.5" fill="#263238"/>
  <circle cx="76" cy="54" r="4.5" fill="#263238"/>
  <circle cx="42.5" cy="52" r="1.8" fill="#ffffff"/>
  <circle cx="74.5" cy="52" r="1.8" fill="#ffffff"/>
  <!-- Rosy cheeks -->
  <ellipse cx="30" cy="64" rx="6" ry="3.5" fill="#ff8a80" opacity="0.75"/>
  <ellipse cx="90" cy="64" rx="6" ry="3.5" fill="#ff8a80" opacity="0.75"/>
  <!-- Cute smiling mouth with tiny triangle teeth -->
  <path d="M40 72 Q60 90 80 72 Q60 76 40 72 Z" fill="#ff7043" stroke="#5d4037" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M47 74 L51 79 L55 75 L60 80 L65 75 L69 79 L73 74" fill="#ffffff"/>
</svg>`;

const BABYSHARK_STAMP_SVG = `
<svg viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="90" cy="90" r="82" fill="#fff9c4" stroke="#00acc1" stroke-width="7"/>
  <circle cx="90" cy="90" r="71" fill="none" stroke="#ff7043" stroke-width="3.5" stroke-dasharray="9 6"/>
  <g transform="translate(36, 16) scale(0.9)">
    ${BABYSHARK_MASCOT_SVG}
  </g>
  <rect x="20" y="118" width="140" height="34" rx="17" fill="#00acc1" stroke="#ffffff" stroke-width="3"/>
  <text x="90" y="140" text-anchor="middle" font-size="20" font-weight="900" fill="#ffffff" font-family="Pretendard, Noto Sans KR, sans-serif">참 잘했어요! 쾅!</text>
</svg>`;

const PORORO_MASCOT_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Little blue penguin ears/hat flaps -->
  <path d="M22 50 Q12 64 20 82 L30 74 Z" fill="#c67c2c" stroke="#4e342e" stroke-width="3"/>
  <path d="M98 50 Q108 64 100 82 L90 74 Z" fill="#c67c2c" stroke="#4e342e" stroke-width="3"/>
  <!-- Head base -->
  <ellipse cx="60" cy="66" rx="41" ry="38" fill="#1e88e5" stroke="#37474f" stroke-width="3.5"/>
  <!-- White penguin face patch -->
  <path d="M27 64 Q36 44 60 50 Q84 44 93 64 Q95 95 60 98 Q25 95 27 64 Z" fill="#ffffff"/>
  <!-- Aviator helmet -->
  <path d="M21 56 Q22 18 60 16 Q98 18 99 56 Q80 42 60 44 Q40 42 21 56 Z" fill="#d88c3a" stroke="#4e342e" stroke-width="3.5"/>
  <rect x="52" y="14" width="16" height="10" rx="4" fill="#ffb74d" stroke="#4e342e" stroke-width="2.5"/>
  <!-- Orange-rimmed round goggles -->
  <line x1="21" y1="50" x2="99" y2="50" stroke="#4e342e" stroke-width="4"/>
  <circle cx="43" cy="52" r="14.5" fill="#fffde7" stroke="#ff7043" stroke-width="5"/>
  <circle cx="77" cy="52" r="14.5" fill="#fffde7" stroke="#ff7043" stroke-width="5"/>
  <!-- Eyes -->
  <circle cx="45" cy="52" r="4.8" fill="#212121"/>
  <circle cx="75" cy="52" r="4.8" fill="#212121"/>
  <circle cx="43.5" cy="50" r="1.8" fill="#ffffff"/>
  <circle cx="73.5" cy="50" r="1.8" fill="#ffffff"/>
  <!-- Rosy cheeks -->
  <ellipse cx="31" cy="71" rx="6" ry="3.5" fill="#ff8a80" opacity="0.75"/>
  <ellipse cx="89" cy="71" rx="6" ry="3.5" fill="#ff8a80" opacity="0.75"/>
  <!-- Orange beak -->
  <ellipse cx="60" cy="69" rx="11" ry="7" fill="#ffa726" stroke="#4e342e" stroke-width="2.8"/>
  <path d="M51 70 Q60 76 69 70" fill="none" stroke="#4e342e" stroke-width="2.2" stroke-linecap="round"/>
  <!-- Happy smile -->
  <path d="M53 81 Q60 88 67 81" fill="none" stroke="#4e342e" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

const PORORO_STAMP_SVG = `
<svg viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="90" cy="90" r="82" fill="#e3f2fd" stroke="#1e88e5" stroke-width="7"/>
  <circle cx="90" cy="90" r="71" fill="none" stroke="#ff7043" stroke-width="3.5" stroke-dasharray="9 6"/>
  <g transform="translate(36, 14) scale(0.9)">
    ${PORORO_MASCOT_SVG}
  </g>
  <rect x="20" y="118" width="140" height="34" rx="17" fill="#ff7043" stroke="#ffffff" stroke-width="3"/>
  <text x="90" y="140" text-anchor="middle" font-size="20" font-weight="900" fill="#ffffff" font-family="Pretendard, Noto Sans KR, sans-serif">대장 도장 쾅!</text>
</svg>`;

export const THEMES = {
  babyshark: {
    id: "babyshark",
    name: "아기상어",
    badge: "🦈 아기상어",
    mascotSvg: BABYSHARK_MASCOT_SVG,
    stampSvg: BABYSHARK_STAMP_SVG,
    stampTitle: "참 잘했어요! 쾅!",
    cheerPrefix: "뚜루루 뚜루~",
    particleType: "bubble",
    particleColors: ["#00bcd4", "#ffeb3b", "#ff7043", "#4dd0e1"],
  },
  pororo: {
    id: "pororo",
    name: "뽀로로",
    badge: "🐧 뽀로로",
    mascotSvg: PORORO_MASCOT_SVG,
    stampSvg: PORORO_STAMP_SVG,
    stampTitle: "대장 도장 쾅!",
    cheerPrefix: "노는 게 제일 좋아~",
    particleType: "star",
    particleColors: ["#1e88e5", "#ff9800", "#ffd54f", "#4fc3f7"],
  },
};
