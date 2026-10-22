import { useFullPreparation } from './connection.ts';
import { normalizationProgress, progressClocks } from './project.ts';
import { bytes, clock, count, decimal, percentage, phaseLabel, readErrorText, rssPresentation, usd } from './presentation.ts';
import { AttemptHistory } from './AttemptHistory.tsx';
import { useObservationRates } from './observations.ts';
import { RecoverySummary } from './RecoverySummary.tsx';
import './full-preparation.css';

export function FullPreparationPanel() {
  const query = useFullPreparation(), data = query.data;
  const progress = data ? normalizationProgress(data) : null;
  const clocks = data ? progressClocks(data) : null;
  const rss = data ? rssPresentation(data) : null;
  const rates = useObservationRates(data);
  const reportedCpu = data?.schema === 'full-training-progress/2' ? data.resources.workloadCpuUtilizationPercent : null;
  const cpuUsage = reportedCpu ?? rates?.derivedCpuUtilizationPercent ?? null;
  const hasRecovery = data?.schema === 'full-training-progress/2' && Boolean(data.recovery);
  return <section className={`full-preparation-panel ${query.error ? 'has-error' : ''}`} aria-label="전체 자료 파이프라인 진행">
    <header className="full-preparation-heading"><div><span>FULL DATA PIPELINE</span><h2>전체 자료 진행 <small>기존 P1 5회 평가와 별도 작업</small></h2></div><div>
      <span className={`full-preparation-phase ${data?.phase.toLowerCase() ?? 'pending'}`}>{data ? phaseLabel[data.phase] : '상태 파일 준비 중'}</span>
      <button disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="전체 자료 상태 다시 읽기">{query.isFetching ? '읽는 중' : '↻ 상태 다시 읽기'}</button>
    </div></header>
    {query.error && <div className="full-preparation-read-error" role="alert"><span>{readErrorText(query.error, Boolean(data))}</span><details><summary>오류 코드</summary><code>{query.error.message}</code></details></div>}
    {data ? <>
      <p className="full-preparation-status">{data.statusDetail || '추가 상태 설명이 없습니다.'}</p>
      <div className="full-preparation-facts">
        <div><span>{hasRecovery ? '검증 완료 원자료 범위' : '정규화 확정 원자료'}</span><strong>{count(data.normalization.committedSourceFiles)}<small> / {count(data.normalization.totalSourceFiles)} 파일</small></strong><p>{count(data.normalization.committedRows)} / {count(data.normalization.totalRawRows)} 원자료 행</p></div>
        <div><span>학습 사례 수 <em>{data.training.ready ? '준비됨' : '준비 전'}</em></span><strong>T {count(data.training.trainRows)}<small> · DEV {count(data.training.devRows)}</small></strong><p>정규화 원자료 행 수와 구분합니다.</p></div>
        <div><span>보고된 학습 실행</span><strong>CPU {count(data.training.cpuFits)}<small> · GPU {count(data.training.gpuFits)} fit</small></strong><p>보고 GPU {data.resources.gpuName ?? '미측정'}</p></div>
        <div><span>{hasRecovery ? '마지막 검증 범위 증가 관측' : '마지막 관측된 진행'}</span><strong className="full-preparation-clock">{clock(clocks?.lastObservedProgressAt)}</strong><p>자동 조회 시각으로 갱신하지 않습니다.</p></div>
      </div>
      <AttemptHistory data={data}/>
      <RecoverySummary data={data}/>
      {data.phase === 'NORMALIZING' && <div className="full-preparation-normalization" aria-label="원자료 행 정규화 진행">
        <div><span>{hasRecovery ? '검증 완료 범위 · 재사용 + 새 처리' : data.schema === 'full-training-progress/2' ? '현재 시도 · 원자료 행 정규화' : '원자료 행 정규화'}</span><strong>{progress ? percentage(progress.percentage) : '행 수 미측정 · 비율 미제공'}</strong></div>
        {progress && <progress value={progress.committedRows} max={progress.totalRows}
          aria-label={hasRecovery ? '전체 원자료 행 중 검증 완료 범위' : '전체 원자료 행 중 정규화 확정 행'} aria-valuetext={`${count(progress.committedRows)} / ${count(progress.totalRows)} 원자료 행, ${percentage(progress.percentage)}`}/>}
        <p>이 비율은 원자료 정규화에만 해당합니다. 학습·평가 또는 전체 연구의 완료율이 아닙니다.</p>
        {data.schema === 'full-training-progress/2' && <p className="full-preparation-rate">
          {hasRecovery ? '새 처리 관측 속도 ' : '관측 구간 처리속도 '}{rates ? `${decimal(rates.rowsPerSecond)} 원자료 행/초` : hasRecovery ? '두 새 처리 관측 대기' : '두 진행 관측 대기'} ·
          정규화 남은 시간 추정 {rates?.remainingSeconds != null ? `${decimal(rates.remainingSeconds / 3600)}시간` : '미제공'}.
          {rates ? ` ${decimal(rates.intervalSeconds)}초 구간 기준.` : ''} 자료 유형마다 처리 속도가 달라 전체 남은 시간 추정의 신뢰가 낮습니다.
        </p>}
      </div>}
      <details className="full-preparation-details"><summary>자원 · 처리량 · 보고 시각</summary><div className="full-preparation-detail-grid">
        <dl><div><dt>{hasRecovery ? '검증된 범위의 압축자료' : '읽은 압축자료'}</dt><dd>{bytes(data.normalization.compressedBytesRead)} / {bytes(data.normalization.totalCompressedBytes)}</dd></div><div><dt>정규화 완료 보고</dt><dd>{data.normalization.complete ? '완료' : '아직 완료 아님'}</dd></div><div><dt>할당 호스트 메모리</dt><dd>{data.resources.allocatedHostMemoryGB === null ? '미측정' : `${decimal(data.resources.allocatedHostMemoryGB)} GB`}</dd></div><div><dt title={rss?.explanation}>{rss?.label}</dt><dd>{bytes(data.resources.processRssBytes)}</dd></div></dl>
        <dl><div><dt>보고 CPU 시간</dt><dd>{data.resources.cpuSeconds === null ? '미측정' : `${decimal(data.resources.cpuSeconds)}초`}</dd></div><div><dt>보고 worker 경과 시간</dt><dd>{data.resources.workerWallSeconds === null ? '미측정' : `${decimal(data.resources.workerWallSeconds)}초`}</dd></div><div><dt>보고된 예상 컴퓨트 비용</dt><dd>{usd(data.resources.estimatedComputeUsd)}</dd></div><div><dt>생산자 보고 시각</dt><dd>{clock(clocks?.producerReportedAt)}</dd></div></dl>
      </div>{data.schema === 'full-training-progress/2' && <>
        <div className="full-preparation-detail-grid">
          <dl><div><dt>프로바이더 할당 vCPU</dt><dd>{count(data.resources.allocatedVcpuCount)}</dd></div>
            <div><dt>컨테이너 실제 CPU 한도</dt><dd>{data.resources.cpuQuotaCores === null ? '미측정' : `${decimal(data.resources.cpuQuotaCores)}코어`}</dd></div>
            <div><dt>{reportedCpu === null && cpuUsage !== null ? '관측 구간 CPU 사용률 추정 · 실제 한도 대비' : '보고 CPU 사용률 · 실제 한도 대비'}</dt><dd>{cpuUsage === null ? '미측정' : percentage(cpuUsage)}</dd></div></dl>
          <dl><div><dt>보고 GPU 사용률</dt><dd>{data.resources.gpuUtilizationPercent === null ? '미측정' : percentage(data.resources.gpuUtilizationPercent)}</dd></div>
            <div><dt>보고 GPU 메모리 사용</dt><dd>{bytes(data.resources.gpuMemoryUsedBytes)}</dd></div></dl>
        </div><p>{rss?.explanation} CPU 사용률은 컨테이너 실제 CPU 한도 대비입니다. 구간 추정은 CPU 누적 시간 차이를 worker 경과 시간 차이와 실제 한도 코어 수로 나눕니다. GPU 사용률은 측정 보고가 없으면 추정하지 않습니다.</p>
      </>}{hasRecovery && <p>압축자료 크기는 재사용을 포함한 검증 범위의 원본 크기이며, 이번 실행의 디스크 읽기량이나 I/O 속도를 나타내지 않습니다.</p>}<p>상태 자료 작성 {clock(clocks?.snapshotWrittenAt)} · 원자료 행과 학습 사례는 별도 집계입니다. 재조회는 worker heartbeat가 아닙니다.</p></details>
    </> : <p className="full-preparation-empty">{query.isFetching ? '공개된 전체 자료 상태를 확인하고 있습니다.' : '상태 파일이 게시되면 원자료 정규화·학습 사례 구성·학습·평가 진행을 표시합니다.'} 측정값이 없으면 0으로 대신 표시하지 않습니다.</p>}
    <footer className="full-preparation-footer"><span>10초마다 상태 파일 확인 · 실행 명령 없는 읽기 전용</span><span>{data ? 'REAL_OBSERVATION_PIPELINE' : '관측된 상태 자료 없음'}</span></footer>
  </section>;
}
