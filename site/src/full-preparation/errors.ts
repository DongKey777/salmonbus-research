export class FullPreparationReadError extends Error {
  readonly status: number | null;
  constructor(code: string, status: number | null = null) {
    super(`FULL_PREPARATION_${code}`); this.name = 'FullPreparationReadError'; this.status = status;
  }
}
