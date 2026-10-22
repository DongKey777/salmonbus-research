# 연구 사이트

salmonbus 좌석 예보 연구의 진행 상황을 보여 주는 웹 사이트입니다.\
React, TypeScript, Vite로 만들었고 차트는 모두 ECharts로 그립니다.\
같은 소스에서 연구 환경용 로컬 화면과 GitHub Pages 공개 사본을 빌드합니다.

## 화면

| 화면 | 주소 | 내용 | 자료 |
| --- | --- | --- | --- |
| 자율 루프 | `?view=autoloop` | 루프 상태, 실험 장부 | `public/autoloop-report.json` |
| 노선도 | `autoloop-route.html` | 한 바퀴의 단계 | 정적 HTML |
| 실자료 반복 | `?view=actual-cycles` | 학습·평가 반복, 노선별 평가 | 로컬 서버 `/api/v7`, `public/`의 보고 JSON |
| 실자료 평가 | `?view=real` | 실제 관측 평가 결과 | `public/real-pilot/` |
| 전체 이력 | `?view=history` | 시도·모델·구간별 이력 | 로컬 서버 `/api/v8` |
| 자료 검증 | `?view=preparation` | 자료 준비, 독립 감사 집계 | 로컬 서버 `/api/v3` |

`view`를 주지 않으면 실자료 반복 화면을 엽니다.\
`public/autoloop-report.json`은 루프의 `publish_site.py`가 씁니다.

## 실행

이 폴더에서 실행합니다.

```sh
npm ci
npm run dev
npm test
npm run build
```

개발 서버는 이 컴퓨터의 62421 포트에만 열리고, 포트가 사용 중이면 시작하지 않습니다.\
`/api/v3`, `/api/v7`, `/api/v8` 요청은 같은 컴퓨터의 연구 서버(62424, 62434, 62436 포트)로 넘깁니다.\
연구 서버가 꺼져 있으면 그 서버를 읽는 화면은 오류를 표시합니다.\
`npm test`는 `test/`의 계약, 화면 변환, 공개 자료 검사 시험을 Node 시험 실행기로 돌립니다.\
`npm run build`는 타입 검사 뒤 로컬용 빌드를 `dist/`에 만듭니다.

시험 일부는 `public/`의 자료 JSON을 읽습니다.\
공개 저장소의 `site/`에는 소스와 시험 코드, `public/`의 노선도 HTML과 스키마만 들어가고 `public/`의 자료 JSON, `snapshots/`, `node_modules/`는 빠집니다.\
시험 파일 일부(9개)는 작업 공간의 `evidence/`와 `retired-synthetic-20261021/` 자료를 읽기 때문에 공개 저장소에서는 돌지 않습니다.\
그래서 시험과 빌드는 연구 작업 공간의 원본 폴더에서 돌립니다.

## 공개 사본

`npm run deploy:pages`(`scripts/deploy-pages.sh`)가 GitHub Pages용 공개 사본을 만들어 공개 저장소에 커밋합니다.\
순서는 시험, 스냅샷 저장, 공개 빌드, 정리, 공개 자료 검사, 공개 저장소 복사, 복사본 재검사, 커밋입니다.\
중간 단계가 실패하면 공개 저장소에 복사하지 않고, 복사본 재검사가 실패하면 복사한 내용을 되돌립니다.\
바뀐 내용이 없거나 `servedAt`만 바뀌었으면 커밋하지 않습니다.\
push는 `--push`와 `ALLOW_PUBLIC_PUSH=1`을 함께 줄 때만 합니다.\
공개 저장소 위치, 브랜치, 폴더, 경로 접두어는 `PAGES_REPO`, `PAGES_BRANCH`, `PAGES_DIR`, `PAGES_BASE`로 정합니다.

공개 빌드(`vite build --mode pages`)는 로컬 연구 서버를 부르지 않습니다.\
실자료 반복과 자료 검증은 `scripts/capture-snapshots.mjs`가 배포 때 저장한 `snapshots/`의 정적 사본을 읽습니다.\
저장에 실패한 자료는 이전 사본을 그대로 씁니다.\
전체 이력은 공개 사본에 싣지 않고 로컬 전용 안내를 보여 줍니다.\
모든 화면 위에는 배포 시점의 정적 자료라는 안내가 붙습니다.

`scripts/stage-pages.mjs`는 `dist-pages/`에 스냅샷과 `THIRD-PARTY-LICENSES.txt`를 넣고, 점 파일과 소스맵을 지운 뒤 경로 접두어를 확인합니다.\
`THIRD-PARTY-LICENSES.txt`는 `scripts/third-party-licenses.mjs`가 공개 번들에 들어간 npm 패키지의 라이선스와 LICENSE·NOTICE 파일을 모아 만듭니다.

`scripts/audit-public.mjs`는 로컬 경로, 이메일, 키, 사설망 주소, 클라우드 주소, 노선 식별자처럼 공개하면 안 되는 값을 찾습니다.\
공개 사본 검사는 비공개 연구 폴더의 노선 식별자 사이드카를 요구하므로 연구 환경에서만 돌릴 수 있습니다.\
`scripts/deploy-if-changed.sh`는 입력이 바뀌었을 때만 10분에 한 번 이하로 배포를 백그라운드에서 시작합니다.
