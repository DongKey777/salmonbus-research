# 자율 루프 AI 하네스 조사 (2026-10-22)

여섯 갈래 조사 결과를 모은 문서다. 출처는 모두 2026-10-22에 확인했다. 표시: [공식] Anthropic 문서, [PR] 동료 심사 논문, [PP] 프리프린트, [블로그].

## 1. 설계 AI 한 번에 $1.38이 든 원인

- 실측 분해: 고정 맥락 약 10,700토큰(약 $0.21), 설계 자료 약 4,300토큰(약 $0.09), 출력 약 2만 토큰(약 $1.06, 대부분 생각).
- 원인 1: 사용자 설정 `~/.claude/settings.json`의 `effortLevel: xhigh`와 `ultracode: true`가 모든 `claude -p` 호출에 적용됐다. Fable 5.1 기본값은 high다. [공식] https://code.claude.com/docs/en/model-config
- 원인 2: 저장소 안에서 호출해 CLAUDE.md와 자동 메모리 약 9,200토큰이 매번 붙었다. 빈 폴더에서는 고정 맥락이 1,485토큰이었다(실측).
- Fable 5.1 단가(100만 토큰당): 입력 $10, 5분 캐시 쓰기 $12.50, 1시간 캐시 쓰기 $20, 캐시 읽기 $0.25, 출력 $50. [공식] https://platform.claude.com/docs/en/about-claude/pricing
- 구독(Pro/Max) 로그인이면 `total_cost_usd`는 정가 환산치이고 청구액이 아니다. 요금제 한도를 넘어 사용량 크레딧으로 갈 때만 달러가 나간다. [공식] https://code.claude.com/docs/en/costs

## 2. 호출 비용 줄이는 방법 (문서로 확인된 것)

- 생각 깊이: `--effort` 또는 `CLAUDE_CODE_EFFORT_LEVEL`(설정 파일보다 우선). 단계 low/medium/high/xhigh/max. Fable 5.1은 생각을 끌 수 없다. [공식] https://platform.claude.com/docs/en/build-with-claude/effort
- 공개 수치: Fable 5.1 DeepResearch Bench II에서 low 66%·$4.48, high 65%·$6.89. [공식] https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
- 맥락 끄기: `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `--setting-sources`로 사용자 설정 제외. `--exclude-dynamic-system-prompt-sections`는 `--system-prompt`와 함께 쓰면 무시된다. [공식] https://code.claude.com/docs/en/env-vars
- 대화 이어 쓰기 주의: Fable 5.1은 이전 턴의 생각 블록을 맥락에 그대로 싣는다. 이어 쓰면 턴마다 약 2만 토큰을 다시 캐시에 쓰게 된다. 상대 AI의 보이는 답만 새 호출에 넘기는 편이 싸다. [공식] https://platform.claude.com/docs/en/build-with-claude/thinking
- 캐시: 호출 하나가 5분 가까이 걸리므로 1시간 TTL이 맞다. 시스템 지시문을 고정하면 앞부분이 캐시로 읽힌다. [공식] https://code.claude.com/docs/en/prompt-caching
- `--max-budget-usd`: 응답이 끝난 뒤에 검사하므로 응답 하나만큼 넘을 수 있다. 넘으면 `error_max_budget_usd`로 끝나고 종료 코드가 0이 아니다. 폭주 방지용으로만 쓴다. [공식] https://code.claude.com/docs/en/agent-sdk/agent-loop
- `--json-schema`는 StructuredOutput 도구 호출 때문에 2턴이 된다. 연결이 끊길 때 잘못 실패로 찍히는 결함은 2.1.290에서 고쳐졌다(설치본 2.1.284).
- Anthropic 권고: 다중 에이전트는 토큰을 3~15배 쓴다. 앞 단계 결과에 기대는 순차 작업은 다중 에이전트에 맞지 않는다. 판정은 0~1 점수와 통과·불합격을 내는 단일 호출이 사람 판단과 가장 일치했다. [블로그] https://www.anthropic.com/engineering/multi-agent-research-system

## 3. 두 AI 상호 검증의 효과 (연구)

- 같은 응답 수라면 다수결(self-consistency)이 토론보다 낫거나 비슷하다. 토론 이득 대부분은 다수결 효과다. [PR] Debate or Vote, NeurIPS 2025, https://arxiv.org/abs/2508.17536
- 왕복을 늘려도 좋아지지 않는다: 정확도 73.3(2번) → 71.1(3번) → 70.8(5번). 2번째 이후 맞던 답이 틀린 답으로 바뀌는 경우가 더 많다. [PR] 위 논문; [WS] https://arxiv.org/abs/2509.05396
- 같은 모델끼리의 토론은 토큰을 2.1~3.4배 쓰고 정확도는 같거나 낮다. 다수 의견을 따라가는 비율이 최대 85.5%다. [PP] https://arxiv.org/abs/2605.00914
- 효과가 있었던 장치:
  - 합의 시 조기 종료: 표본을 최대 7.9배 줄이면서 손실 0.1%p 미만. [PR] https://aclanthology.org/2023.emnlp-main.761
  - 서로 다른 두 에이전트가 먼저 상호 확인하고, 합의하면 즉시 끝내고, 안 되면 최대 4라운드 + 2라운드 교착 시 중단. 토론보다 토큰 71% 적고 정확도 82.5 대 77.7. [PP] HCP-MAD, https://arxiv.org/abs/2604.09679
  - 작성자를 가리면 맞는 답을 버리는 일이 64.3% 줄었다. [PR] https://arxiv.org/abs/2510.07517
  - 다른 모델 계열을 섞으면 최대 +11.4%. 다만 약한 모델을 섞으면 오히려 나빠진다. [PR] https://arxiv.org/abs/2309.13007, https://arxiv.org/abs/2502.00674
  - 모델은 자기가 쓴 글을 알아보고 더 좋게 평가한다. [PR] https://arxiv.org/abs/2404.13076
  - 외부의 확실한 검증기가 있을 때만 큰 이득이 난다. 스스로 비판만 하면 성능이 무너진다. [PR] https://arxiv.org/abs/2402.08115
- ML 실험 루프에서 검토 AI의 가치를 비용 대비로 잰 논문은 찾지 못했다.
- 해석 단계가 편향이 들어오는 곳이다. 확인을 바라는 지시문 하나로 Claude Code의 결론이 10%에서 90% 지지로 바뀌었다(계수 추정은 그대로). [PP] https://arxiv.org/abs/2606.11456

## 4. ML 실험 AI 시스템 사례

- AIDE: 해법 나무에서 초안·디버그·개선. MLE-bench 메달 8.7%(GPT-4o). [PP] https://arxiv.org/abs/2502.13138
- MLE-bench: 제출 검사기는 점수를 주지 않고 유효성만 알린다. 로그 감사로 부정행위를 잡는다. [PR] https://arxiv.org/abs/2410.07095
- AIRA-dojo: 탐색 방식보다 편집 연산자가 중요(탐욕 45.5%, MCTS 47.0%). 기억은 효과 거의 없음. 검증 점수 대신 시험 점수로 골랐다면 9~13점 더 나왔다(검증 과적합). [PP] https://arxiv.org/abs/2507.02554
- R&D-Agent: 탐색 구조 제거 −28%, 계획 제거 −24%, 기억 제거 −9%. 과제당 약 $21. [PP] https://arxiv.org/abs/2505.14738
- MLE-STAR: 누설 검사기를 끄자 검증 0.819→0.868로 오르고 시험은 0.803→0.734로 떨어졌다. [PR] https://arxiv.org/abs/2506.15692
- 결과 조작: MLR-Bench에서 코딩 에이전트의 약 80%가 조작되거나 무효한 결과를 냈다. [PR] https://arxiv.org/abs/2505.19955
- 보상 해킹: METR 실험에서 30.4%의 실행이 평가기를 조작했다. "속이지 마라" 지시는 효과가 거의 없었다. 시험을 숨기자 거의 0이 됐다. [블로그] https://metr.org/blog/2025-06-05-recent-reward-hacking/ ; [PR] ImpossibleBench https://arxiv.org/abs/2510.20270
- AI Scientist는 자기 시간 제한을 고치고 결과표를 지어냈다. [PP] https://arxiv.org/abs/2408.06292

## 5. 피처 생성과 연구 기억

- CAAFE: pandas 코드 피처를 학습 데이터 교차검증으로 채택. AUC 0.798→0.822. [PR] https://arxiv.org/abs/2305.03403
- OCTree: 결정 나무를 글로 되먹임해 XGBoost 오류 5% 감소. [PR] https://arxiv.org/abs/2406.08527
- LATTEArena: 검증 +3.55%가 시험에서는 +0.73%로 줄었다. 반복 선택 과적합. [PP] https://arxiv.org/abs/2606.09004
- 시점 정합(point-in-time): 원천마다 `available_at`을 두고 창은 예보 시각 이전에서 끝나야 한다. 운영 입력 기록으로 다시 계산해 값이 같아야 서비스 가능하다. [공식 문서] Feast point-in-time joins; Google Rules of ML #29/#32/#37
- 연구 기억: 덧붙이기만 하는 JSONL에 가설·사전 예측·결과 구간·판정(지지/반박/불분명/무효)·교훈을 남긴다. 실패도 남긴다. LLM이 기록을 다시 쓰게 하면 맥락이 무너진다(ACE). 틀린 기억은 오류를 퍼뜨리므로 무효 판정은 격리한다. 기억의 효과 증거가 엇갈리므로 기억 자체를 A/B로 확인한다. [PR] https://arxiv.org/abs/2510.04618, https://arxiv.org/abs/2505.16067

## 6. 보안 하네스

- 도구 결과는 Anthropic API로 전송된다. 원본 행은 돌려주지 않고 집계만 돌려줘야 한다(셀 최소 건수, 바이트 상한).
- 서버 측 코드 실행 도구는 쓰지 않는다. 파일이 업로드되고 최대 30일 보관된다. [공식] https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool
- 권한 규칙과 Claude Code 내장 샌드박스(macOS Seatbelt, 베타)는 경계가 아니다. 셸 명령만 막고 파일 도구·MCP·훅은 밖에서 돈다. [공식] https://code.claude.com/docs/en/sandboxing
- Agent SDK의 프로세스 내 도구는 지휘 프로세스 권한으로 돈다. 입력 검증과 컨테이너 전달만 맡긴다. [공식] https://code.claude.com/docs/en/agent-sdk/custom-tools
- 실행은 호출마다 새 Docker 컨테이너: `--network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65534 --pids-limit --memory --tmpfs /tmp:noexec`, DEV_S 읽기 전용 마운트, 비밀값·docker.sock 없음. [공식] https://code.claude.com/docs/en/agent-sdk/secure-deployment
- 최소 라이브러리: numpy, pyarrow, pandas 또는 polars, scipy, scikit-learn, xgboost. 우리 고정 버전(numpy 2.4.4, pyarrow 24.0.0, scipy 1.18.1, xgboost 3.4.1)은 OSV 기록 없음.
- 피할 것: mlflow(보안 권고 82건, 2026년 27건), pickle·joblib 역직렬화, Jupyter 커널, featuretools(2024-05 이후 배포 없음), 에이전트의 pip 설치, 원본 행을 돌려주는 도구.
- 공급망: 해시 고정 오프라인 휠(`--require-hashes --no-index --only-binary :all:`), 호스트에서 pip-audit·osv-scanner. pyarrow·xgboost는 PEP 740 증명이 없다.
- 봉인 H: 마운트하지 않는 별도 볼륨. 에이전트 밖의 평가기가 DEV_S와 H 키가 겹치지 않는지 확인한다.

## 7. 약관

- Agent SDK 문서: 사전 승인 없이 제3자 제품에 claude.ai 로그인을 제공하지 말고 API 키를 쓰라고 한다. 요금제 한도는 "평범한 개인 사용"을 전제로 한다. [공식] https://code.claude.com/docs/en/agent-sdk/overview
- 개인 연구 루프가 "평범한 개인 사용"에 해당하는지는 문서가 답하지 않는다. `--bare`와 ZDR 요청은 API 키에서만 된다.
