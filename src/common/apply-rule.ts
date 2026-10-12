import { DomainRuleError } from '../domain/weighted-average';
import { AppError } from './app-error';

/** Runs a domain rule and maps its violation to a 400 with the rule's stable code. */
export function applyRule<T>(rule: () => T): T {
  try {
    return rule();
  } catch (error) {
    if (error instanceof DomainRuleError) {
      throw new AppError(400, error.code, error.message);
    }
    throw error;
  }
}
