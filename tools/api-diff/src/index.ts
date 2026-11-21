// Library entry point.
export { compareInputs, compareOpened, countFindings, shouldFail, stateOf, type CompareOptions } from './engine.ts';
export { RULES, getRule, type RuleMeta } from './rules/registry.ts';
export { inputsFromArgs, open, parseInput, type InputSpec, type OpenedInput } from './sources/input.ts';
export type { DocumentSource } from './sources/source.ts';
export { MemorySource } from './sources/memory.ts';
export type * from './types.ts';
