# 릴리즈 · 버전 (spec)

## 버전 소스

`package.json` 의 `version` 이 정본이다.

- `src-tauri/tauri.conf.json` 은 `"version": "../package.json"` 으로 그 값을 읽는다 (Tauri v2 형식).
- `src-tauri/Cargo.toml` / `Cargo.lock` 은 crate 버전일 뿐 번들 버전에 영향을 주지 않지만,
  혼란을 막기 위해 bump 워크플로가 같은 값으로 맞춘다.

## 릴리즈 절차

1. Actions → **Bump version** 실행 (`patch` / `minor` / `major`). `main` 에서 돌린다.
2. 워크플로가 `package.json` 을 올리고 Cargo 매니페스트를 맞춘 뒤 `chore: release vX.Y.Z` 커밋과
   `vX.Y.Z` 태그를 푸시하고, 이어서 Release 워크플로를 호출한다.
3. Release 가 Apple Silicon 번들을 만들어 **draft** 릴리즈에 올린다.
4. 릴리즈 페이지에서 노트를 확인하고 직접 공개한다.

태그를 손으로 밀어도(`git push origin vX.Y.Z`) 같은 Release 워크플로가 돈다.
`workflow_dispatch` 로는 빌드만 하고 릴리즈는 만들지 않는다.

## 산출물

| 파일 | 용도 |
|---|---|
| `Bellboy_X.Y.Z_aarch64.dmg` | 일반 배포 |
| `Bellboy_aarch64.zip` | README 의 `releases/latest/download/…` 링크 대상 — **이름에 버전이 들어가면 안 된다** |

`Bellboy_aarch64.zip` 은 Tauri 가 만들지 않으므로 워크플로가 `.app` 을 `ditto` 로 압축해 생성한다.

## 결정 히스토리

- **2026-08-06** — Intel(`macos-13`) 매트릭스 제거. v0.1.0 run 에서 arm64 는 4분에 성공했지만
  Intel 잡은 24시간 큐 대기 후 취소됐다. README 도 Intel 은 소스 빌드를 안내하고 있어
  실제로 쓰이지 않는 아티팩트였다.
- **2026-08-06** — `Bellboy_aarch64.zip` 생성 단계 추가. v0.1.0 의 zip 은 수동 업로드였고,
  워크플로 산출물은 dmg 와 `.app.tar.gz` 뿐이라 다음 릴리즈에서 README 링크가 깨질 상태였다.
- **2026-08-06** — `.app.tar.gz` 제거. Tauri 자동 업데이터를 쓰지 않는다.
- **2026-08-06** — 릴리즈는 `draft` 로 만든다. 태그를 미는 것과 공개를 분리해 빌드 결과를 보고 낸다.
- **2026-08-06** — bump 워크플로가 Release 를 `workflow_call` 로 직접 호출한다.
  `GITHUB_TOKEN` 으로 푸시한 태그는 `push` 이벤트를 트리거하지 않기 때문에,
  태그만 밀고 끝내면 빌드가 돌지 않는다.
- **2026-08-06** — CHANGELOG.md 는 두지 않는다. 커밋이 Conventional Commits 형식이라
  `generate_release_notes` 로 충분하고, 릴리즈 페이지가 버전 기록 역할을 한다.
