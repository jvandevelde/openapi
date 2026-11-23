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
  /** The policy's migration note for clients (rules.<id>.note), used instead of the built-in one. */
  note?: string;
  /** Teams that own the finding (POLICY.md section 14): its operation's or component's owners, plus those of the operations it affects. */
  owners?: string[];
  /** Set when an acknowledgement covers the finding: it's reported but doesn't fail CI or count towards `state`. */
  acknowledged?: { reason: string; owner?: string; expires: string; file: string };
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
  /** `info.title`. */
  title?: string;
  /** Where `version` came from: a policy source such as `info.version`, or `command line`. */
  versionSource?: string;
  /** Version labels (POLICY.md section 9); `commit` is filled in for git inputs. */
  labels?: Record<string, string>;
  /** The document couldn't be read as OpenAPI 3.x (a `spec-invalid` finding says why), so nothing was compared. The CLI exits 2. */
  unreadable?: true;
}

export interface Counts {
  total: number;
  bySeverity: Record<Severity, number>;
  byKind: Record<Kind, number>;
  byRule: Record<string, number>;
  /** Findings covered by an acknowledgement (included in the other counts). */
  acknowledged: number;
}

export interface Result {
  schemaVersion: 0;
  tool: { name: 'api-diff'; version: string };
  profile: Profile;
  compared: { base: ComparedSide; revision: ComparedSide };
  state: State;
  counts: Counts;
  /** Semver advice, when both versions are semver: the bump the findings need and the bump the versions show. */
  advice?: { needed: BumpLevel; actual: BumpLevel; ok: boolean; because?: string; breaking: number };
  /** The policy file used, if any, and the SHA-256 of its contents. */
  policy?: { file: string; sha256: string };
  /** Source lines around each finding, by finding ID (only when asked for, e.g. by the explore report). */
  snippets?: Record<string, { base?: Snippet; revision?: Snippet }>;
  /** With snippets: the source lines their scopes and `$ref` targets cover, by side, file and line number. */
  sourceLines?: { base: Record<string, Record<number, string>>; revision: Record<string, Record<number, string>> };
  /** The operations findings mention (as subject or impact), for grouping and labels; the revision's details win. */
  operations?: Record<string, OperationSummary>;
  /** --uses: the consumer's operations the reports were narrowed to, and the entries that matched no operation. */
  uses?: { file: string; operations: string[]; unmatched: string[] };
  findings: Finding[];
}

export type BumpLevel = 'none' | 'patch' | 'minor' | 'major';

export interface Snippet {
  file: string;
  /** 1-based line number of `lines[0]`. */
  start: number;
  /** The line the finding points at. */
  line: number;
  lines: string[];
  /** The pointer's steps from the document root, each with its line (the breadcrumb). */
  path?: { key: string; line: number }[];
  /** The enclosing schema or operation (or the outermost node on the path that fits), in `file`; its lines are in `sourceLines`. */
  scope?: SnippetBlock;
  /** When the node is a `$ref`: the node it points at; its lines are in `sourceLines`, under `file`. */
  ref?: SnippetBlock & { file: string; name: string };
}

/** A node's lines: `start` to `end`, with `line` the one to highlight. */
export interface SnippetBlock {
  pointer: string;
  start: number;
  end: number;
  line: number;
}

export interface OperationSummary {
  operationId?: string;
  tags: string[];
  summary?: string;
  /** The operation's owners (POLICY.md section 14), when any. */
  owners?: string[];
}
