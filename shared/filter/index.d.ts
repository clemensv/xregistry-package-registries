export interface FilterExpression {
  attribute: string;
  operator: 'exists' | '=' | '!=' | '<>' | '<' | '<=' | '>' | '>=';
  value: string | null;
}

export function parseFilterExpression(filterStr: string): FilterExpression[];
export function getNestedValue(obj: any, path: string): any;
export function compareValues(attrValue: any, filterValue: string | null, operator: string): boolean;
export function applyXRegistryFilterWithNameConstraint(
  filterParams: string | string[],
  entities: any[],
  req: any
): Promise<any[]>;
