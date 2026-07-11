# 컬처카드 공개 전 커버 원화 프롬프트

목업 `culturecard-editorial-mockup-v1.png`을 **스타일 레퍼런스**로 첨부하고 아래 프롬프트를 각각 별도로 실행한다.

## 공통 출력 규칙

- 세로 3:4 비율, 권장 1536×2048px
- UI, 버튼, 글자, 숫자, 로고를 이미지 안에 넣지 않는다.
- 앱에서 제목을 올릴 수 있도록 하단 30%는 대비가 낮고 복잡하지 않게 둔다.
- 피사체는 중앙 상단에 두고 상하좌우 8% 안전 여백을 남긴다.
- 네 장 모두 같은 편집 시스템처럼 보이되 구도와 소재는 다르게 만든다.
- 파일명: `locked-cover-exhibition.png`, `locked-cover-performance.png`, `locked-cover-popup.png`, `locked-cover-festival.png`

## 1. 전시

```text
Use case: stylized-concept
Asset type: locked mobile culture-card cover artwork, portrait 3:4
Input image: the attached Culture Card three-screen mockup is a STYLE REFERENCE ONLY.
Primary request: Create a premium editorial collage for a contemporary art exhibition discovery card. Show an anonymous museum visitor from behind, a cropped classical sculpture fragment, torn archival paper, abstract painted planes and a subtle gallery interior. The artwork must suggest an exhibition without revealing any real event identity.
Style/medium: independent culture magazine cover, analogue photomontage, editorial photography, risograph accents, halftone grain, torn paper edges, sophisticated 2026 Korean art direction.
Composition/framing: portrait 3:4; central subject in the upper-middle; preserve a quiet, dark lower-left 30% for Korean UI copy; generous 8% safe margins.
Color palette: charcoal black, warm ivory, oxblood red, muted cobalt, tiny mustard accent.
Lighting/mood: cinematic, intelligent, mysterious, premium.
Constraints: no words, no letters, no numbers, no logos, no watermarks, no recognizable person, no event poster, no UI.
Avoid: flat vector geometry, childish 3D icons, giant Hangul glyphs, gradients, web-card appearance, busy detail in the lower text-safe zone.
```

## 2. 공연

```text
Use case: stylized-concept
Asset type: locked mobile culture-card cover artwork, portrait 3:4
Input image: the attached Culture Card three-screen mockup is a STYLE REFERENCE ONLY.
Primary request: Create a premium editorial collage for a live-performance discovery card. Feature an anonymous full-body dancer or performer in silhouette under one dramatic stage light, with restrained fragments of sheet music, curtain texture and torn photographic paper. It must suggest a live performance without identifying a real show.
Style/medium: high-end performing-arts magazine, monochrome editorial photography, analogue collage, risograph red accents, fine film grain.
Composition/framing: portrait 3:4; performer in the upper-middle; motion directed diagonally; quiet dark lower-left 30% reserved for UI copy; 8% safe margins.
Color palette: deep black, warm ivory, oxblood red, muted cobalt, tiny aged-gold accent.
Lighting/mood: theatrical, elegant, tense, cultured.
Constraints: no words, no notes that form readable music titles, no letters, no numbers, no logos, no watermark, no celebrity, no UI.
Avoid: concert stock-photo clichés, neon lighting, childish illustration, flat shapes, giant category letter, excessive detail behind the copy area.
```

## 3. 팝업

```text
Use case: stylized-concept
Asset type: locked mobile culture-card cover artwork, portrait 3:4
Input image: the attached Culture Card three-screen mockup is a STYLE REFERENCE ONLY.
Primary request: Create a premium editorial still-life collage for a temporary pop-up discovery card. Combine an anonymous record-store or design-shop interior, sculptural lifestyle objects, stacked magazines with blank covers, urban building fragments and torn color paper. It must feel current and desirable without revealing a real brand or venue.
Style/medium: contemporary fashion-and-culture magazine, analogue photomontage, tactile paper grain, restrained art-direction collage.
Composition/framing: portrait 3:4; objects concentrated in the upper and middle areas; quiet dark lower-left 30% for UI copy; 8% safe margins.
Color palette: warm ivory, charcoal, oxblood red, muted cobalt, dark brown-black.
Lighting/mood: stylish, intimate, collectible, slightly unexpected.
Constraints: blank magazine covers only; no brand marks, no readable words, no letters, no numbers, no logos, no watermark, no UI.
Avoid: ecommerce product shot, bright gradients, playful 3D icons, generic social-media poster, giant Hangul glyphs.
```

## 4. 축제·행사

```text
Use case: stylized-concept
Asset type: locked mobile culture-card cover artwork, portrait 3:4
Input image: the attached Culture Card three-screen mockup is a STYLE REFERENCE ONLY.
Primary request: Create a premium editorial collage for a local festival and cultural-event discovery card. Use anonymous crowd silhouettes, a striking Korean architectural roofline, a contemporary venue fragment, flags reduced to abstract fabric shapes and textured paper cutouts. Do not identify a real festival.
Style/medium: independent city-culture magazine, documentary photography mixed with analogue collage, halftone and risograph texture.
Composition/framing: portrait 3:4; architecture and crowd in the upper-middle; quiet dark lower-left 30% for Korean UI copy; 8% safe margins.
Color palette: charcoal, warm ivory, oxblood red, muted cobalt, subtle mustard.
Lighting/mood: energetic but refined, communal, cinematic, culturally grounded.
Constraints: no readable signage, no flags with logos, no letters, no numbers, no words, no watermark, no identifiable individual, no UI.
Avoid: tourism brochure, colorful carnival cliché, flat vector art, childish balloons, giant Hangul glyphs, excessive detail in the text-safe area.
```

## 생성 후 검수

1. 네 이미지에 글자나 로고가 생성되지 않았는지 확인한다.
2. 하단 30%에 흰색 또는 아이보리 제목을 올렸을 때 읽히는지 확인한다.
3. 사람 얼굴이 식별 가능하게 생성됐다면 뒷모습이나 실루엣으로 다시 생성한다.
4. 네 이미지의 종이 질감과 버건디 색이 서로 일관적인지 확인한다.
