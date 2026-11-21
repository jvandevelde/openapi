// Core types shared by every stage. The result object (`Result`) is the
// stable interface; its JSON Schema is in schema/result-v0.schema.json.

export type Severity = 'error' | 'warn' | 'info';
export type Kind = 'wire' | 'sdk' | 'docs';
export type Direction = 'in' | 'out';
export type Profile = 'wire' | 'sdk';
export type ParamLocation = 'path' | 'query' | 'header' | 'cookie';
export type Side = 'base' | 'revision';
export type State = 'no-changes' | 'compatible' | 'breaking';
export type FailOn = Severity | 'never';

/** A place in one of the compared documents. */
export interface Location {
  /** Display name of the file, e.g. `openapi.yaml` or `main:openapi.yaml`. */
  file: string;
  /** JSON Pointer inside that file. */
  pointer: string;
  /** 1-based line and column, when known. */
  line?: number;
  column?: number;
}

/**
 * A change found by the diff stage. It has no severity yet: the classify
 * stage turns it into a `Finding`.
 */
export interface Change {
  /** Base rule ID from the registry, e.g. `parameter-removed`. */
  rule: string;
  /** What the change is about, e.g. `GET /pets/{id}` or `document`. */
  subject: string;
  base?: Location;
  revision?: Location;
  /** Parameter location, for rules with location variants. */
  location?: ParamLocation;
  /** Usage direction, for rules with direction variants. */
  direction?: Direction;
  /** Rule-specific values used in messages and conditional severities. */
  details: Record<string, unknown>;
  /** Other places affected by this change (e.g. operations using a scheme). */
  impact?: string[];
}

export interface Finding {
  /** Stable ID: the same change in the same place always gets the same ID. */
  id: string;
  /** Most specific rule ID, e.g. `query-parameter-removed`. */
  rule: string;
  /** Rule ID without location or direction, e.g. `parameter-removed`. */
  baseRule: string;
  kind: Kind;
  severity: Severity;
  /** Where the severity came from, e.g. `default` or `profile sdk`. */
  severitySource: string;
  subject: string;
  message: string;
  base?: Location;
  revision?: Location;
  details: Record<string, unknown>;
  impact?: string[];
  /** Policy exclusion sets the finding belongs to (POLICY.md section 8); reports can leave them out. */
  exclusions?: string[];
}

export interface ComparedSide {
  /** The input as given, e.g. `openapi.yaml` or `main:openapi.yaml`. */
  input: string;
  /** Display name of the root file. */
  file: string;
  /** OpenAPI version from the `openapi` field. */
  openapi?: string;
  /** `info.version`, or `unknown`. */
  version: string;
  /** SHA-256 of the root file's contents. */
  sha256?: string;
  /** Resolved commit, for git inputs. */
  commit?: string;
}

export interface Counts {
  total: number;
  bySeverity: Record<Severity, number>;
  byKind: Record<Kind, number>;
  byRule: Record<string, number>;
}

export interface Result {
  schemaVersion: 0;
  tool: { name: 'api-diff'; version: string };
  profile: Profile;
  compared: { base: ComparedSide; revision: ComparedSide };
  state: State;
  counts: Counts;
  findings: Finding[];
}
