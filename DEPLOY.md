# 배포 가이드 — Cloudflare Pages

이 앱은 백엔드 없는 정적 Vite SPA라 Cloudflare Pages에 그대로 올라갑니다.

## 방법 A — 대시보드(Git 연동, 권장)

1. [Cloudflare 대시보드](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 이 저장소(`djkdb/star-movie`)를 선택
3. 빌드 설정:
   | 항목 | 값 |
   | --- | --- |
   | Framework preset | `Vite` (또는 None) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
4. **Environment variables** 에 TMDB 키 추가 (자동완성을 쓸 경우):
   - `VITE_TMDB_API_KEY` = 발급받은 TMDB v3 API 키
   - 키를 넣지 않아도 앱은 정상 동작하며, 자동완성만 숨겨집니다.
5. **Save and Deploy**. 이후 브랜치에 push하면 자동 재배포됩니다.

Node 버전은 저장소의 `.node-version`(20)이 자동 적용됩니다.

## 방법 B — CLI (`wrangler`)

```bash
npm install
VITE_TMDB_API_KEY=<your-key> npm run build   # 키 없이 빌드해도 됨
npx wrangler pages deploy dist --project-name star-movie
```

`wrangler.toml`이 프로젝트 이름과 출력 폴더(`dist`)를 잡아줍니다.

## 포함된 설정 파일

- `public/_redirects` — SPA 폴백(`/* /index.html 200`)
- `.node-version` — 빌드 Node 버전 고정(20)
- `wrangler.toml` — Pages 프로젝트 이름 + 출력 폴더

## 주의

- **API 키 노출**: 클라이언트 SPA라 `VITE_TMDB_API_KEY`는 빌드 결과 JS에 포함되어 공개됩니다. TMDB 읽기 전용 키는 통상 이렇게 쓰지만, 이 점을 인지하세요.
- **라이선스**: TMDB 무료 API는 **비상업 용도 전용**입니다. 상업 배포 시에는 TMDB와 별도 상업 계약이 필요합니다. 자세한 내용은 <https://www.themoviedb.org/api-terms-of-use> 참고.
- **출처 표기**: 앱의 "아카이브 현황" 패널과 "작품 추가" 폼에 TMDB 로고와 필수 고지 문구가 자동 표시됩니다(키가 설정된 경우).
