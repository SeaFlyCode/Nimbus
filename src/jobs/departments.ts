const METROPOLE = Array.from({ length: 95 }, (_, i) => i + 1)
  .filter((n) => n !== 20)
  .map((n) => String(n).padStart(2, '0'))
  .concat(['2A', '2B']);

const OUTRE_MER = ['971', '972', '973', '974', '975', '976'];

export const FRENCH_DEPARTMENT_CODES: readonly string[] = [...METROPOLE, ...OUTRE_MER].sort();

export function isValidDepartmentCode(code: string): boolean {
  return FRENCH_DEPARTMENT_CODES.includes(code.toUpperCase());
}
