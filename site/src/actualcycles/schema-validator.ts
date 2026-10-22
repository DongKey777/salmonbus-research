/** The finite JSON Schema vocabulary used by the pinned owner's public schemas. */
export interface Schema {
  $schema?: string; type?: string; const?: unknown; enum?: unknown[]; anyOf?: Schema[];
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean;
  items?: Schema; maxItems?: number; minimum?: number; maximum?: number;
  pattern?: string; minLength?: number; maxLength?: number; format?: string;
}
export function validateSchema(value: unknown, schema: Schema, path = 'snapshot'): void {
  const fail = (): never => { throw new Error(`ACTUAL_CYCLES_CONTRACT:${path}`); };
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (schema.anyOf) {
    for (const choice of schema.anyOf) { try { validateSchema(value, choice, path); return; } catch { /* next closed branch */ } }
    fail();
  }
  if (schema.type === 'null') { if (value !== null) fail(); return; }
  if (schema.type === 'boolean') { if (typeof value !== 'boolean') fail(); return; }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value)) ||
      (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) fail();
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') fail();
    const string = value as string;
    if ((schema.minLength !== undefined && string.length < schema.minLength) || (schema.maxLength !== undefined && string.length > schema.maxLength) ||
      (schema.pattern && !new RegExp(schema.pattern).test(string)) ||
      (schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(string) || !Number.isFinite(Date.parse(string))))) fail();
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail();
    const values = value as unknown[];
    if (schema.maxItems !== undefined && values.length > schema.maxItems) fail();
    if (schema.items) values.forEach((item, index) => validateSchema(item, schema.items!, `${path}[${index}]`));
    return;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    const object = value as Record<string, unknown>, properties = schema.properties ?? {};
    if (schema.required?.some(key => !Object.hasOwn(object, key)) ||
      (schema.additionalProperties === false && Object.keys(object).some(key => !Object.hasOwn(properties, key)))) fail();
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(object, key)) validateSchema(object[key], child, `${path}.${key}`);
  }
}
