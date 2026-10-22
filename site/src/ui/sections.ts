import { siteUrl, viewUrl } from '../site/env.ts';

export type ResearchSection = 'metrics' | 'observer' | 'preparation' | 'cycles' | 'history' | 'real' | 'actual-cycles' | 'autoloop';

/** Top-level sections. `localOnly` sections need the local API servers and show a notice on the public site. */
export const RESEARCH_SECTIONS = [
  { id: 'autoloop', label: '자율 루프', href: viewUrl('autoloop'), localOnly: false },
  { id: 'route-map', label: '노선도', href: siteUrl('autoloop-route.html'), localOnly: false },
  { id: 'actual-cycles', label: '실자료 반복', href: viewUrl('actual-cycles'), localOnly: false },
  { id: 'real', label: '실자료 평가', href: viewUrl('real'), localOnly: false },
  { id: 'history', label: '전체 이력', href: viewUrl('history'), localOnly: true },
  { id: 'preparation', label: '자료 검증', href: viewUrl('preparation'), localOnly: false },
] as const;
