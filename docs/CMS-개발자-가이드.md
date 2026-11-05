# 차 태권도 CMS 개발자 가이드

관장님은 관리자 페이지(`/admin`)에서 콘텐츠를 수정합니다. 개발자는 지금처럼 VS Code와 Claude Code로 사이트를 관리하고 Vercel에 직접 배포합니다.
관장님이 저장한 내용은 내 PC의 `content/` 폴더로 자동 동기화됩니다. 서버 저장소는 **Supabase 하나**(데이터베이스 + 사진 저장소)입니다.

---

## 1. 구조

```
관장님 ──▶ /admin (아이디 master) ──▶ /api/admin/* ──▶ Supabase 데이터베이스(글·문구·갤러리·계정·변경 기록)
                                                      └▶ Supabase Storage(사진, 매일 암호화 백업)
                                                            ▲  콘텐츠 단일 원본
방문자 ──▶ /api/render ──▶ 원본 HTML + 저장소 콘텐츠 ─────────┘
                           (저장소 장애 → 배포에 포함된 content/ 사본 → 원본 HTML)

내 PC (로그인 시 자동 실행) ──▶ 동기화 프로그램 ──▶ /api/sync/* (토큰 인증)
                                 └▶ 프로젝트 content/ 폴더 ⇄ 서버 (양방향, 2분마다 + 파일 수정 즉시)
```

### 무엇이 어디에 있나 (Single Source of Truth)
| 무엇 | 원본 | 수정 방법 |
|---|---|---|
| 디자인, CSS, JS, 레이아웃, 메뉴, 수정 영역 지정(`data-cms`) | **내 PC의 소스코드** | VS Code → Vercel 배포 |
| `data-cms` 영역의 문구·사진, 도장 소식, 갤러리 | **서버 저장소 (Supabase)** | 관리자 페이지, 또는 `content/` 파일 수정(자동 업로드) |
| `content/` 폴더 | 서버 콘텐츠의 **사본** (자동 동기화) | 직접 고쳐도 됨 → 서버에 올라감 |

> ⚠ `data-cms`가 붙은 요소 안의 글자를 **HTML 파일에서** 고쳐도 홈페이지에 반영되지 않습니다 (서버 값이 우선).
> 콘텐츠는 `content/` 폴더에서 고치세요.
>
> 재배포해도 서버 콘텐츠는 그대로입니다. 배포에 포함되는 `content/` 사본은 저장소 장애 때만 쓰이고, 서버를 덮어쓰지 않습니다.

### 파일 구성
```
api/render.js        방문자 페이지 렌더링
api/admin.js         관리자 API (로그인·콘텐츠·사진 업로드)
api/sync.js          동기화·개발자 명령 API (CMS_SYNC_TOKEN), 매일 자동 백업 (Cron)
api/_lib/            저장소(kv, media, supabase), 콘텐츠, 인증, 렌더링 로직
supabase/schema.sql  Supabase 테이블·함수·버킷 설정 (SQL Editor에서 한 번 실행)
admin/               관리자 페이지
content/             콘텐츠 사본 (동기화 프로그램이 관리)
cms/post-extras.*    기존 글에 사진 묶음·유튜브를 새로 추가할 때만 쓰는 보충 CSS/JS
scripts/             개발자 명령·동기화 프로그램 (배포에서 제외)
vercel.json          라우팅·보안 헤더·Cron
```

---

## 2. 최초 설정 (한 번만)

### 2-1. Supabase 설정
1. Supabase 프로젝트의 **SQL Editor**에 `supabase/schema.sql` 파일 **내용 전체**를 붙여넣고 **Run**
   → 테이블 `cms_kv`, `cms_revisions`, 함수 `cms_cas`, 버킷 `cms-media`(공개 읽기)·`cms-backups`(비공개) 생성.
   여러 번 실행해도 안전하고, 기존 데이터를 지우지 않습니다.
2. **Settings → API**(또는 API Keys)에서 **Project URL**과 **secret 키**(`sb_secret_…` 또는 예전 service_role 키) 확인.
   secret 키는 서버 전용입니다. 브라우저 코드·채팅·GitHub에 절대 넣지 마세요.

보안: 모든 테이블에 RLS가 켜져 있고 정책이 없어서, 공개키(anon/publishable)로는 읽기·쓰기가 모두 막힙니다.
서버(Vercel 함수)만 secret 키로 접근합니다.

### 2-2. Vercel 환경변수 추가
Vercel → Settings → Environment Variables

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Project URL (`https://<프로젝트ID 20자>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | secret 키 |
| `SESSION_SECRET` | 임의 문자열 32자 이상 (로그인 쿠키 서명) |
| `CMS_SYNC_TOKEN` | 임의 문자열 32자 이상 (내 PC 동기화용) |
| `BACKUP_KEY` | 임의 문자열 32자 이상 (자동 백업 암호화) |
| `CRON_SECRET` | 임의 문자열 (자동 백업 Cron 인증) |

임의 문자열 만들기:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```
`CMS_SYNC_TOKEN`과 `BACKUP_KEY`는 비밀번호 관리자에도 보관하세요. 환경변수를 추가한 뒤에는 **재배포**해야 적용됩니다.

> 운영 전 시험: 저장소 변수를 **Development에만** 넣고 `npx vercel env pull .cms/vercel-dev.env --environment development` 후
> `npm run test:storage` → 실제 Supabase에 임의 접두사(`cmstest-…`)로 전체 시나리오를 실행하고 시험 데이터를 모두 지웁니다. 운영 데이터와 섞이지 않습니다.

### 2-3. 내 PC 설정
```bash
cp .env.example .env.local     # CMS_SITE_URL, CMS_SYNC_TOKEN, BACKUP_KEY 입력 (커밋·배포 안 됨)
npm install
```

### 2-4. 배포 → 콘텐츠 이전 → 동기화 시작
```bash
vercel --prod                  # 또는 기존 방식대로 배포
npm run cms:seed               # 현재 HTML의 콘텐츠를 서버에 등록 (없는 것만, 덮어쓰기 없음)
npm run cms:verify             # 누락 검사 + 렌더링이 원본과 같은지 비교 → "모든 페이지 동일"이어야 정상
npm run sync                   # content/ 폴더 받기
npm run sync:install           # PC 로그인 시 자동 실행 등록 + 바로 시작
```

### 2-5. 관장님 계정
```bash
npm run admin -- link          # 비밀번호 설정 링크 출력 → 카카오톡 등으로 관장님께 전달
```
- 로그인 아이디는 `master`입니다. 관장님이 링크에서 비밀번호를 직접 만듭니다(24시간 동안 한 번만 쓸 수 있는 링크).
- 비밀번호를 만들면 **복구 코드**가 한 번 표시됩니다. 관장님이 보관하도록 안내해 주세요.
- 비밀번호는 scrypt 해시로만 저장되어 개발자도 볼 수 없습니다.

---

## 3. 평소 작업

### 홈페이지 코드·디자인 수정 (기존과 동일)
VS Code에서 수정 → 확인 → `vercel --prod`로 배포.
```bash
npm run dev                    # 로컬 테스트 서버 (테스트 저장소 .cms/store 사용, 관리자 기능 전체 시험 가능)
npm run dev -- --offline       # 저장소 없이 HTML 추출 데이터로 (디자인 작업용)
npm run dev -- --static        # 원본 HTML 그대로
npm test                       # 렌더링·관리자·동기화 자동 테스트 (30개)
npm run check:render           # 현재 HTML 기준 렌더링 = 원본인지
```
로컬 테스트 서버에서 관리자 계정 만들기: `npm run cms:seed -- --env .cms/dev.env` → `npm run admin -- link --env .cms/dev.env`

### 콘텐츠 수정 (VS Code)
`content/` 폴더의 파일을 고치고 저장하면 동기화 프로그램이 5초 뒤 서버에 올립니다. 1분 안에 홈페이지에 반영됩니다.
```
content/blocks.json             페이지 문구·사진 (value, meta 만 수정)
content/gallery.json            갤러리 (id 없는 항목을 추가하면 새 사진)
content/posts/<slug>.json       글 정보 · 새 파일 = 새 글 (/post-<slug>.html)
content/posts/<slug>.body.html  글 본문
content/posts/<slug>.after.html 본문 아래 영역 (블로그 링크·현장 사진)
content/media/                  관장님이 올린 사진 사본 (배포 제외)
```
- **충돌 방지**: 관장님이 같은 항목을 먼저 고쳤다면 내 수정은 올라가지 않습니다. 그 내용은 `content/_충돌/` 폴더에 보관되고, 파일은 관장님 버전으로 바뀝니다.
- 아직 서버에 올라가지 않은 내 수정 파일은 서버 내용으로 덮어쓰지 않습니다.
- 삭제는 관리자 페이지의 휴지통에서 하세요 (`content/`에서 지워도 서버에서는 삭제되지 않습니다).
- 동기화 프로그램이 꺼져 있으면 `npm run sync`로 한 번 실행하면 됩니다.
- Claude Code에 요청하는 예: *"content/posts/minami.body.html 두 번째 문단을 ○○로 바꿔 줘"*

### 동기화 상태 확인
```bash
npm run sync -- --status       # 마지막 동기화 시각, 실행 여부, 최근 기록
npm run sync:uninstall         # 자동 실행 해제
```
기록은 `.cms/sync.log`에 남습니다. PC가 꺼져 있던 동안의 변경은 다음에 켤 때 모두 받습니다(서버가 변경 번호를 관리).

### 디자인을 바꿀 때 주의할 점
| 상황 | 해야 할 일 |
|---|---|
| `data-cms` 요소의 태그·클래스·스타일 변경 | 자유롭게 변경 가능 |
| `data-cms` 요소 삭제·이동 | 속성을 함께 옮기면 됨. 지우면 해당 콘텐츠가 화면에 안 나옴 |
| 소식 카드·갤러리 카드 디자인 변경 | `api/_lib/lists.js`도 함께 수정 |
| 기존 글 디자인 변경 | `article-title`, `article-meta`, `article-hero`, `article-body`, `back-btn` 클래스 유지 |
| 새 글 디자인 | `api/_lib/post-template.html` |

### 관장님이 수정할 수 있는 영역 추가
```html
<p data-cms="facility.intro" data-cms-label="시설 소개 문구">현재 문구</p>
<img data-cms="facility.photo1" data-cms-label="시설 사진 1" src="/images/a.jpg" alt="...">
<ul data-cms="facility.list" data-cms-type="lines" data-cms-label="시설 목록 (한 줄에 하나)">…</ul>
<!--cms:facility.body|시설 안내 본문--> 여러 요소 <!--/cms:facility.body-->
```
새 페이지라면 `api/render.js`의 `PAGES`, `vercel.json` routes, `scripts/lib/extract.mjs`의 `CMS_PAGES`, `admin/js/views/pages.js`의 `PAGE_INFO`에 추가합니다.
그다음 `npm run check:render` → 배포 → `npm run cms:seed`(없는 항목만 추가).

---

## 4. 보안
| 항목 | 구현 |
|---|---|
| 관리자 인증 | 서버 측 세션 검증 (서명된 HttpOnly·Secure·SameSite=Strict 쿠키, 12시간 / 로그인 유지 30일) |
| 비밀번호·복구 코드 | scrypt 해시만 저장. 비밀번호를 바꾸면 기존 세션이 모두 무효 |
| 로그인 시도 제한 | 5회 실패 시 15분 잠금 (서버 기록). 해제: `npm run admin -- unlock` |
| 계정 생성 | 회원가입 없음. 개발자 명령으로 발급한 일회용 링크로만 비밀번호 설정 |
| CSRF | 쓰기 요청에 전용 헤더와 Origin 검사 |
| XSS | 관장님 입력 HTML은 서버에서 정화 (script·on* 속성·javascript: 링크·유튜브 외 iframe 제거), 관리자 페이지 CSP |
| 업로드 | 브라우저에서 JPEG로 재인코딩(메타데이터 제거) → 서버에서 형식(JPEG 시그니처)과 크기(4.4MB) 재검사 |
| 동기화 API | `CMS_SYNC_TOKEN` 필요 (Cron은 `CRON_SECRET`으로 백업 경로만) |
| 비밀키 | Vercel 환경변수와 `.env.local`에만 보관 (`.gitignore`, `.vercelignore` 제외) |
| 검색엔진 | `/admin`, `/api`는 noindex 헤더와 robots.txt로 차단 |

---

## 5. 백업 및 복구

| 백업 | 주기 | 위치 |
|---|---|---|
| 변경 기록 | 저장할 때마다 (최근 500건) | 서버. 관리자 페이지 "변경 기록"에서 되돌리기 |
| 서버 자동 백업 | 매일 03:00 (30일 보관, 암호화) | Supabase Storage `cms-backups` 버킷 (비공개) |
| PC 자동 백업 | 동기화 프로그램이 하루 한 번 (30일 보관) | `.cms/backups/daily-<날짜>/` |
| 수동 백업 | 필요할 때 | `npm run cms:backup` → `.cms/backups/manual-<날짜시간>/` (사진 포함) |

```bash
npm run cms:backup                          # 지금 백업 (사진 포함)
npm run cms:backup -- --cloud               # 서버 자동 백업 목록
npm run cms:backup -- --cloud 2026-11-05    # 해당 날짜 서버 백업 받아서 복호화
npm run cms:restore -- .cms/backups/<폴더>          # 미리보기
npm run cms:restore -- .cms/backups/<폴더> --apply  # 실제 복구 (되돌리기 전 내용은 변경 기록에 남음)
```
**중요한 작업 전에는 `npm run cms:backup`을 먼저 실행하세요.**

---

## 6. 관장님 계정 관리
```bash
npm run admin -- link         # 비밀번호 설정 링크 (최초 · 분실 시)
npm run admin -- status       # 설정 여부, 마지막 로그인, 잠금
npm run admin -- unlock       # 잠금 해제
npm run admin -- logout-all   # 모든 기기 강제 로그아웃 (도용 의심 시 → 이어서 link)
```
| 상황 | 해결 |
|---|---|
| 비밀번호 분실 (복구 코드 있음) | 관장님이 로그인 화면 "비밀번호를 잊으셨나요?"에서 직접 재설정 |
| 복구 코드도 분실 | `npm run admin -- link` → 새 링크 전달 |
| 5회 실패로 잠김 | 15분 기다리거나 `npm run admin -- unlock` |
| 휴대폰 분실 | `npm run admin -- logout-all` |

---

## 7. 무료 플랜 제한과 비용

| 서비스 | 무료 한도 (변동 가능, Vercel 대시보드 Usage에서 확인) | 이 사이트 사용 방식 |
|---|---|---|
| Supabase 데이터베이스 | 500MB, **1주일간 요청이 없으면 일시정지** | 콘텐츠 문서 1개 + 글 본문. 페이지 조회는 CDN 30초 캐시와 서버 5초 캐시로 호출 최소화. 매일 자동 백업이 접속하므로 정지되지 않음 (정지돼도 홈페이지는 `content/` 사본으로 표시) |
| Supabase Storage | 1GB, 월 전송량 한도 | 관장님이 올린 사진만 저장 (긴 변 2000px JPEG). 기존 `/images` 사진은 그대로 Vercel 정적 파일 |
| Vercel Functions | Hobby 한도 | 함수 3개 (render, admin, sync) |
| Vercel Cron | Hobby: 하루 1회 | 자동 백업 1개 |

- 예상 월 비용은 **0원**입니다. 한도를 넘으면 Vercel 대시보드에 경고가 표시됩니다.
- ⚠ **Vercel Hobby 약관은 비상업적 용도만 허용합니다.** 도장 홈페이지는 상업적 용도로 볼 수 있어서 엄밀히는 Pro(월 $20)가 필요합니다.
- 관장님이 저장한 뒤 홈페이지에 보이기까지 최대 약 1분 걸립니다.

---

## 8. 유지보수와 문제 해결

| 주기 | 할 일 |
|---|---|
| 월 1회 | Supabase → Usage, Vercel → Usage 확인, `npm run sync -- --status` |
| 분기 1회 | `npm run cms:backup`으로 사진 포함 백업, `--cloud` 목록 확인 |
| 라이브러리 업데이트 | `npm update` → `npm run vendor` → `npm test` |
| 디자인 변경 후 | `npm run check:render` |

| 증상 | 확인 |
|---|---|
| 응답 헤더 `X-CMS` | `db` 정상 / `content-files` 저장소 연결 실패(사본 표시 중) / `static` 저장소·사본 모두 없음 |
| 관리자 페이지 "설정이 필요합니다" | Vercel 환경변수 (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`) 확인 후 재배포 |
| `X-CMS: content-files` 가 계속됨 | Supabase 프로젝트 일시정지 여부(대시보드에서 Restore), `SUPABASE_URL` 오타 확인 |
| 동기화 실패 | `.cms/sync.log` 확인. `.env.local`의 주소·토큰이 Vercel과 같은지 |
| 링크를 쓸 수 없다고 나옴 | 24시간이 지났거나 이미 사용한 링크 → `npm run admin -- link` |
