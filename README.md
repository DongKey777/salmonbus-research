# salmonbus-research

버스가 정류장에 도착할 때 남는 좌석을 예보하는 모델을 스스로 개선하는 연구 저장소입니다.\
설계 AI가 다음 실험을 정하고, GPU에서 학습한 결과를 심사 AI가 판정합니다.\
연구 결과는 [연구 사이트](https://dongkey777.github.io/salmonbus-research/)에서 볼 수 있습니다.

## 구성

| 폴더 | 내용 |
|---|---|
| `autoloop/` | 자율 개선 루프, Runpod 실행 경로, 봉인 H 확인 |
| `autoloop/ai/` | 설계·심사 AI, 호출 관문, 상호 검증, 연구 일지 |
| `autoloop/sandbox/` | 격리 분석 도구 |
| `autoloop/features/` | 코드 피처 표현식과 검증기 |
| `site/` | 연구 사이트 원본 |
| `research/` | 계획과 조사 문서 |

## 한 바퀴의 흐름

1. 설계 AI가 연구 일지와 장부를 읽고 가설, 후보, 사전 예측을 냅니다.
2. 검토 AI가 점검표로 설계를 따지고, 합의할 때까지 최대 두 번 주고받습니다.
3. 실행 묶음을 만들고 사전 시험을 통과하면 Runpod GPU에서 학습과 채점을 합니다.
4. 측정값과 바닥선은 코드가 계산하고, 심사 AI는 그 위에서 챔피언 교체와 정지를 판단합니다.
5. 장부와 연구 일지를 남기고 사이트를 갱신합니다.

## 판정과 봉인 H

판정은 DEV-S(10/12·14·16·17)에서만 합니다.\
H(10/13·15·18·19)는 연속 미개선 상한·총예산 소진·심사 AI 정지 판단으로 루프가 끝날 때만 챔피언 하나로 한 번 확인합니다.\
H는 루프의 선택에서 떼어 둔 날짜입니다.\
10/22 이전 보고서와 시작 챔피언 선택에는 이 날짜가 들어간 DEV 전체가 쓰였습니다.\
그래서 그 보고서 JSON의 `HRead: false`, `HIncluded: false`는 "만들 때 따로 떼어 둔 H가 없었다"는 뜻이고, H 날짜를 뺐다는 뜻이 아닙니다.

## 이 저장소에 없는 것

원본 관측 자료, 학습 결과, 루프 상태와 장부, API 키는 올리지 않습니다.\
그래서 루프 전체는 연구 작업 공간에서만 돌고, 이 저장소에서는 자료 없이 도는 시험만 돌릴 수 있습니다.

## 시험

```sh
cd autoloop
python3 -B tests/test_loop_logic.py
python3 -B tests/test_ai_gateway.py
python3 -B tests/test_ai_journal.py
python3 -B tests/test_ai_judge.py
python3 -B tests/test_ai_debate.py
python3 -B tests/test_features_dsl.py
python3 -B tests/test_features_java.py   # JDK 21 필요
```

새 설계 AI와 새 작업기 묶음 시험은 루프 상태와 자료가 있어야 해서 연구 작업 공간에서만 돕니다.\
사이트 시험 일부도 같은 이유로 작업 공간에서만 돕니다.

## 사이트 배포

`site/scripts/deploy-pages.sh`가 빌드, 공개 전 검사, `gh-pages` 브랜치 갱신을 맡습니다.\
공개 전 검사는 로컬 경로, 키, 내부 주소, 원본 노선 ID가 섞였는지 찾고, 통과한 것만 올립니다.\
사이트에 쓰인 외부 라이브러리의 라이선스는 사이트의 `THIRD-PARTY-LICENSES.txt`에 있습니다.
