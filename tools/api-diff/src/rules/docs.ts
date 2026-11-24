// Documentation for every rule: what it detects, why it has its default
// severity, how to fix it, and its policy options. The pages in docs/rules/
// are generated from this file and the registry (`npm run docs`).

export interface RuleOption {
  name: string;
  default: string;
  description: string;
}

export interface RuleDoc {
  /** What the rule detects. */
  description: string;
  /** Why it has its default severity: which clients break, and how. */
  why: string;
  /** How to avoid or fix the change. */
  fix: string;
  /** Rule-specific policy options (POLICY.md section 4). */
  options?: RuleOption[];
  /** Test case used as the example, if not the first case that expects the rule. */
  example?: string;
}

const REQ_RESP_WHY = (inWhy: string, outWhy: string): string => `In requests: ${inWhy} In responses: ${outWhy}`;

export const RULE_DOCS: Record<string, RuleDoc> = {
  // 1. Core variance rules
  'schema-narrowed': {
    description: 'Fallback for a schema change that no specific rule matches, where the new schema accepts fewer values than the old one.',
    why: REQ_RESP_WHY('clients may send values that are now rejected.', 'clients receive a subset of what they handled before, which is safe.'),
    fix: 'Keep accepting the old values in requests, or version the operation.',
  },
  'schema-widened': {
    description: 'Fallback for a schema change that no specific rule matches, where the new schema accepts more values than the old one.',
    why: REQ_RESP_WHY('old clients keep sending values that are still valid.', 'clients may receive values they were not written to handle.'),
    fix: 'In responses, only send the new values to clients that ask for them, or document that clients must tolerate them.',
  },
  'schema-incompatible': {
    description: 'Fallback for a schema change where the new schema is neither a subset nor a superset of the old one (e.g. `string` became `integer`).',
    why: 'Some old values become invalid and some new values are unfamiliar, so clients break in either direction.',
    fix: 'Add a new field or operation with the new schema instead of changing the existing one.',
  },
  'unclassified-change': {
    description: "Safety net: a schema's shape changed, but no rule produced a finding for it. Reported once per schema root (a component schema, another `$ref` target, or a schema written inline in an operation) with the JSON Pointers that changed inside it. A shared schema is reported once, with the operations that use it, and only where the change is: a change inside `Address` is reported for `Address`, not for every schema that references it. Annotations (`description`, examples, `x-` extensions) are not shape. Until the schema rules arrive in M5, every schema change is reported this way.",
    why: "The change might matter, and no rule has decided it doesn't. Every occurrence points at a missing rule.",
    fix: 'Check the change by hand. If it is safe, acknowledge the finding; either way, report it so a rule can be added.',
  },

  // 2. Paths and operations
  'operation-added': {
    description: 'A new operation (method + path) exists in the revision.',
    why: 'Existing clients never call it, so nothing breaks.',
    fix: 'Nothing to fix.',
  },
  'operation-removed': {
    description: 'An operation in the base no longer exists in the revision, and no operation with the same `operationId` replaced it at another path.',
    why: 'Clients that call it get 404 or 405 responses.',
    fix: 'Mark the operation `deprecated` first and remove it after the deprecation period, or keep it and point clients at the replacement.',
    options: [
      { name: 'unless.deprecated-for-days', default: '90', description: 'Allow removal (as `operation-removed-after-deprecation`) once the operation has been deprecated this long. Can be set per stability level.' },
      { name: 'unless.past-sunset', default: 'true', description: "Allow removal once the operation's sunset date has passed." },
      { name: 'unless.undated-deprecation', default: 'allow', description: 'For an operation marked `deprecated` without a deprecation date: `allow` counts it as long enough, `block` keeps the removal an error.' },
    ],
  },
  'operation-removed-after-deprecation': {
    description: 'An operation was removed after it had been deprecated for the configured period, or after its sunset date.',
    why: 'Clients were warned for the agreed period, so the removal follows the API lifecycle.',
    fix: 'Nothing to fix; make sure the removal is in the changelog.',
  },
  'operation-id-changed': {
    description: 'The same method and path has a different `operationId` (or gained or lost one).',
    why: 'The JSON on the wire is unchanged, but generated SDKs name methods after the `operationId`, so code calling the old method name stops compiling.',
    fix: 'Keep the old `operationId`. If the name must change, add the new operation alongside and deprecate the old one.',
  },
  'path-param-renamed': {
    description: 'A path parameter was renamed in the same position, e.g. `/users/{id}` → `/users/{userId}`. The endpoint is the same.',
    why: 'The URL clients call is unchanged, but SDKs that name method arguments after parameters change their signatures.',
    fix: 'Keep the old parameter name unless the SDK change is intended.',
  },
  'operation-path-changed': {
    description: 'An operation with the same `operationId` and method moved to a different path, e.g. a path parameter was added or removed, or a prefix changed.',
    why: 'Old clients call a URL that no longer exists.',
    fix: 'Keep serving the old path (e.g. as a deprecated alias) until clients have moved.',
  },
  'operation-tags-changed': {
    description: "The operation's tags changed (order doesn't matter).",
    why: "Many SDK generators group methods into classes by tag, so the method moves to another class. The wire format doesn't change.",
    fix: 'Keep the old tags if SDK compatibility matters.',
  },
  'server-url-changed': {
    description: 'A server URL was removed from `servers` at the document, path or operation level. Adding a URL is not reported.',
    why: 'Clients configured with the removed base URL send requests to the wrong place. It is a warning because clients often configure the base URL themselves.',
    fix: 'Keep the old server URL working, or announce the move.',
    options: [{ name: 'compare', default: 'full', description: '`full`, `path` (ignore host changes, e.g. per environment) or `off`.' }],
  },

  // 3. Security
  'security-requirement-added': {
    description: 'An operation that needed no authentication now requires it, or an existing requirement now also needs an additional scheme.',
    why: 'Clients that send no credentials, or only the old ones, get 401/403 responses.',
    fix: 'Make the new requirement an alternative (an extra entry in the `security` list) instead of a replacement, then remove the old one later.',
  },
  'security-requirement-removed': {
    description: 'An operation needs less authentication: no security at all, an optional empty requirement (`{}`) was added, or a scheme was dropped from a combined requirement.',
    why: 'Clients that send credentials keep working.',
    fix: 'Nothing to fix; check that it was intended.',
  },
  'security-alternative-added': {
    description: 'A new alternative was added to the `security` list (OR).',
    why: 'Clients can keep using the alternative they already use.',
    fix: 'Nothing to fix.',
  },
  'security-alternative-removed': {
    description: 'An alternative was removed from the `security` list.',
    why: 'Clients using that way of authenticating get 401/403 responses.',
    fix: 'Keep the alternative until clients have moved to another one.',
  },
  'security-scope-added': {
    description: 'An OAuth or OpenID Connect requirement now needs an additional scope.',
    why: 'Tokens issued for the old scopes are rejected.',
    fix: 'Add the new scope as a separate alternative first, or accept tokens with either scope set.',
  },
  'security-scope-removed': {
    description: 'A requirement needs fewer scopes.',
    why: 'Tokens with the old scopes still work.',
    fix: 'Nothing to fix.',
  },
  'security-scheme-changed': {
    description: "A security scheme's `type`, `in`, `name`, `scheme`, `openIdConnectUrl` or OAuth flow URLs changed, or a flow was removed. Reported once for the scheme, with the operations that use it.",
    why: 'Clients send credentials in the old way or to the old URLs, and authentication fails.',
    fix: 'Add a new scheme and offer it as an alternative instead of changing the existing one.',
  },

  // 4. Parameters
  'parameter-added-required': {
    description: 'A new required query, header or cookie parameter. (Path parameters change the path; see `operation-path-changed`.)',
    why: "Old clients don't send it, so their requests are rejected.",
    fix: 'Make the parameter optional with a server-side default.',
  },
  'parameter-added-optional': {
    description: 'A new optional query, header or cookie parameter.',
    why: "Old clients don't send it, and the server uses its default.",
    fix: 'Nothing to fix.',
  },
  'parameter-removed': {
    description: 'A query, header or cookie parameter was removed.',
    why: 'Clients still send it. Usually the server ignores it, so the request succeeds but behaves differently (e.g. a removed `?status=` filter returns everything); if the server rejects unknown parameters, the request fails. Under `--profile sdk` it is an error, because the parameter disappears from generated method signatures.',
    fix: 'Keep accepting the parameter (it can be deprecated) until clients stop sending it.',
    options: [{ name: 'strict-servers', default: 'false', description: '`true` if servers reject unknown parameters, making removals errors. Can be set per location, e.g. `{ query: true }`.' }],
  },
  'parameter-became-required': {
    description: 'An optional parameter is now required.',
    why: "Clients that didn't send it are rejected.",
    fix: 'Keep it optional and apply a server-side default.',
  },
  'parameter-became-optional': {
    description: 'A required parameter is now optional.',
    why: 'Clients that send it keep working.',
    fix: 'Nothing to fix.',
  },
  'parameter-location-changed': {
    description: 'A parameter with the same name moved to another location, e.g. from `query` to `header`.',
    why: 'Old clients send it in the old place, where the server no longer reads it.',
    fix: 'Accept it in both places during a transition.',
  },
  'parameter-serialization-changed': {
    description: "A parameter's `style`, `explode` or `allowReserved` changed, or it switched between `schema` and `content` or changed its `content` media type. Defaults are applied before comparing, so writing out a default isn't a change.",
    why: 'Clients encode the value the old way (e.g. `tags=a&tags=b` instead of `tags=a,b`), and the server misreads it.',
    fix: 'Keep the old serialization, or add a new parameter with the new one.',
  },
  'parameter-renamed': {
    description: 'A parameter appears to have been renamed: same position and schema, different name.',
    why: "On the wire, old clients send the old name, which is also reported as removed + added. In generated SDKs, the method's argument name changes.",
    fix: 'Keep the old name, or accept both names during a transition.',
  },

  // 5. Request bodies
  'request-body-added-required': {
    description: 'An operation that had no request body now requires one.',
    why: "Old clients send no body and are rejected.",
    fix: 'Make the body optional, with defaults for its fields.',
  },
  'request-body-added-optional': {
    description: 'An operation that had no request body now accepts an optional one.',
    why: 'Old clients send no body, which is still valid.',
    fix: 'Nothing to fix.',
  },
  'request-body-became-required': {
    description: 'An optional request body is now required.',
    why: 'Clients that sent no body are rejected.',
    fix: 'Keep the body optional.',
  },
  'request-body-became-optional': {
    description: 'A required request body is now optional.',
    why: 'Clients that send a body keep working.',
    fix: 'Nothing to fix.',
  },
  'request-body-removed': {
    description: 'An operation no longer documents a request body.',
    why: 'Clients still send one. Most servers ignore it, so the data is silently dropped; some reject it.',
    fix: 'Keep accepting the body until clients stop sending it, or version the operation.',
  },
  'request-media-type-added': {
    description: 'A request body accepts an additional media type, e.g. `application/xml`.',
    why: 'Clients keep sending the media types they already use.',
    fix: 'Nothing to fix.',
  },
  'request-media-type-removed': {
    description: 'A request body no longer accepts a media type. Media types compare case-insensitively.',
    why: 'Clients sending that media type get 415 responses.',
    fix: 'Keep accepting the media type until clients have moved.',
  },

  // 6. Responses
  'response-success-status-added': {
    description: 'A new 1xx, 2xx or 3xx response, e.g. `202` alongside `200`, or `304`.',
    why: "Clients may only handle the statuses they knew about and treat the new one as an error. It's a warning because many clients accept any 2xx.",
    fix: 'Only return the new status to clients that opt in (e.g. with a `Prefer` header), or document it clearly.',
    options: [{ name: 'ignore-statuses', default: '[]', description: 'Statuses that never warn when added, e.g. `[202, 204]`.' }],
  },
  'response-success-status-removed': {
    description: 'A documented 1xx, 2xx or 3xx response was removed.',
    why: 'Clients that relied on it (e.g. polling for `202`, or following a `302`) behave differently.',
    fix: 'Keep returning the status, or version the operation.',
  },
  'response-error-status-added': {
    description: 'A new 4xx or 5xx response was documented.',
    why: 'Clients already have to handle errors; documenting one more is usually just documentation.',
    fix: 'Nothing to fix.',
  },
  'response-error-status-removed': {
    description: 'A documented 4xx or 5xx response was removed.',
    why: 'Clients that handle it keep working; the server just stops returning it (or stops documenting it).',
    fix: 'Nothing to fix; check that the server really stopped returning it.',
  },
  'response-status-range-widened': {
    description: 'Specific status codes were replaced by their range, e.g. `200` → `2XX`. Not reported as a removal; each code\'s response is compared with the range\'s response.',
    why: "Clients still get a status in the range, but may now get codes other than the ones they handled. It's info because a range is often just broader documentation.",
    fix: 'Keep documenting the specific codes if clients depend on them.',
  },
  'response-status-range-narrowed': {
    description: "A status range was replaced by specific codes in it, e.g. `2XX` → `200`. Not reported as a removal; the range's response is compared with each code's response.",
    why: 'Responses clients receive got more specific, which is usually safe.',
    fix: 'Nothing to fix.',
  },
  'response-default-removed': {
    description: 'The `default` response was removed.',
    why: "Clients that used it to parse undocumented errors lose that schema. It's a warning because errors still arrive; only their documented shape is gone.",
    fix: 'Keep a `default` response, or document the specific error statuses.',
  },
  'response-media-type-added': {
    description: 'A response with a body can return an additional media type.',
    why: 'The server only sends it to clients that ask for it in `Accept`.',
    fix: 'Nothing to fix.',
  },
  'response-media-type-removed': {
    description: 'A response can no longer return a media type. Media types compare case-insensitively.',
    why: 'Clients asking for it in `Accept` get 406 or an unexpected format.',
    fix: 'Keep returning the media type until clients have moved.',
  },
  'response-body-removed': {
    description: 'A response that had a body (`content`) now has none.',
    why: 'Clients that parse the body fail.',
    fix: 'Keep returning the body, or version the operation.',
  },
  'response-header-added': {
    description: 'A new response header. `Content-Type` is ignored, as OpenAPI says; names compare case-insensitively.',
    why: 'Clients ignore headers they don\'t know.',
    fix: 'Nothing to fix.',
  },
  'response-header-removed': {
    description: 'A response header was removed. An error if the header was `required`, otherwise a warning.',
    why: "Clients that read it (e.g. a rate-limit or request-ID header) lose the value. A required header was promised, so clients may not check that it's there.",
    fix: 'Keep sending the header until clients stop reading it.',
    options: [{ name: 'required-severity', default: 'error', description: 'Severity when the removed header was required.' }],
  },
  'response-header-became-optional': {
    description: 'A required response header is now optional.',
    why: 'Clients may assume it is always present and fail when it is missing.',
    fix: 'Keep it required, or make sure clients check for it first.',
  },

  // 7. Schemas
  'property-added-required': {
    description: 'A new required property in an object schema.',
    why: REQ_RESP_WHY("old clients don't send it and are rejected.", 'clients receive an extra field, which they ignore.'),
    fix: 'In requests, make the property optional with a server-side default.',
  },
  'property-added-optional': {
    description: 'A new optional property in an object schema.',
    why: REQ_RESP_WHY("old clients don't send it, which is fine.", 'clients that ignore unknown fields are fine; strict clients may reject the extra field.'),
    fix: 'Nothing to fix for tolerant clients. For strict clients, see the `strict-clients` option.',
    options: [{ name: 'strict-clients', default: 'false', description: '`true` raises the response side to `warn`, for clients that reject unknown fields.' }],
  },
  'property-removed': {
    description: 'A property was removed from an object schema.',
    why: REQ_RESP_WHY('clients keep sending it; it is ignored, or rejected if the object disallows additional properties.', 'clients that read it get nothing.'),
    fix: 'Deprecate the property and keep it until clients stop using it.',
    options: [{ name: 'closed-object-severity', default: 'error', description: 'Severity on the request side when the object has `additionalProperties: false`.' }],
  },
  'property-became-required': {
    description: 'An optional property is now required.',
    why: REQ_RESP_WHY("clients that didn't send it are rejected.", 'clients now always receive it, which is safe.'),
    fix: 'In requests, keep it optional with a default.',
  },
  'property-became-optional': {
    description: 'A required property is now optional.',
    why: REQ_RESP_WHY('clients that send it keep working.', 'clients may assume it is always present and fail when it is missing.'),
    fix: 'In responses, keep returning the property.',
  },
  'property-became-read-only': {
    description: '`readOnly: true` was added to a property, so it is no longer part of requests.',
    why: REQ_RESP_WHY('clients that send it have it ignored (or rejected).', 'nothing changes.'),
    fix: 'Keep accepting the property in requests during a transition.',
  },
  'property-became-write-only': {
    description: '`writeOnly: true` was added to a property, so it is no longer returned in responses.',
    why: REQ_RESP_WHY('nothing changes.', 'clients that read it get nothing.'),
    fix: 'Keep returning the property until clients stop reading it.',
  },
  'additional-properties-restricted': {
    description: '`additionalProperties` became `false` or a narrower schema.',
    why: REQ_RESP_WHY('clients sending extra fields are rejected.', 'clients receive fewer kinds of fields, which is safe.'),
    fix: 'Keep allowing extra fields in requests.',
  },
  'additional-properties-allowed': {
    description: '`additionalProperties` became `true` or a wider schema.',
    why: REQ_RESP_WHY('more requests are valid.', 'clients may receive fields they were not written to handle.'),
    fix: 'Document that clients must ignore unknown fields.',
  },
  'min-properties-increased': { description: '`minProperties` increased.', why: REQ_RESP_WHY('objects with fewer properties are now rejected.', 'clients receive objects with at least as many properties as before.'), fix: 'Keep the old minimum in requests.' },
  'max-properties-decreased': { description: '`maxProperties` decreased.', why: REQ_RESP_WHY('objects with more properties are now rejected.', 'clients receive objects with fewer properties, which is safe.'), fix: 'Keep the old maximum in requests.' },
  'min-properties-decreased': { description: '`minProperties` decreased.', why: REQ_RESP_WHY('more objects are valid.', 'clients may receive smaller objects than they expect.'), fix: 'Check that clients handle the smaller objects.' },
  'max-properties-increased': { description: '`maxProperties` increased.', why: REQ_RESP_WHY('more objects are valid.', 'clients may receive larger objects than they expect.'), fix: 'Check that clients handle the larger objects.' },
  'type-changed': {
    description: 'The type changed incompatibly, e.g. `string` → `integer`.',
    why: 'Clients send or parse the old type and fail in both directions.',
    fix: 'Add a new property with the new type and deprecate the old one.',
  },
  'type-widened': {
    description: 'The type now accepts more, e.g. `integer` → `number`, or a type was added to a type array.',
    why: REQ_RESP_WHY('old values are still valid.', 'clients parsing the old type (e.g. into an int) fail on the new values.'),
    fix: 'In responses, keep returning the old type.',
  },
  'type-narrowed': {
    description: 'The type now accepts less, e.g. `number` → `integer`.',
    why: REQ_RESP_WHY('clients sending the removed kinds of values are rejected.', 'clients receive a subset of what they handled.'),
    fix: 'In requests, keep accepting the old type.',
  },
  'nullable-added': {
    description: '`null` is now allowed (3.0 `nullable: true`, or `"null"` added to a 3.1 type array). 3.0 and 3.1 forms are normalised first, so switching between them is not a change.',
    why: REQ_RESP_WHY('old clients never send null.', "clients that don't expect null crash on it."),
    fix: 'In responses, omit the property instead of sending null, or keep it non-nullable.',
  },
  'nullable-removed': {
    description: '`null` is no longer allowed.',
    why: REQ_RESP_WHY('clients sending null are rejected.', 'clients no longer receive null, which is safe.'),
    fix: 'In requests, keep accepting null.',
  },
  'format-added': {
    description: 'A `format` was added to a schema that had none, e.g. a plain string became `format: uuid`.',
    why: REQ_RESP_WHY("clients' existing values may not match the format and are rejected.", 'clients receive values in a narrower format, which is safe.'),
    fix: 'In requests, validate the format only for new clients, or keep it unformatted.',
  },
  'format-removed': {
    description: 'A `format` was removed.',
    why: REQ_RESP_WHY('more values are valid.', 'clients that parse the format (e.g. as a date) may fail on other values.'),
    fix: 'Keep the format in responses if clients parse it.',
  },
  'format-changed': {
    description: 'The `format` changed, e.g. `date-time` → `date`. Some changes count as widening (e.g. `int32` → `int64` in requests).',
    why: 'Clients send or parse values in the old format.',
    fix: 'Add a new property with the new format.',
    options: [
      { name: 'widening', default: '{ int32: int64, float: double }', description: 'Format changes treated as widening.' },
      { name: 'equivalent', default: '[]', description: 'Formats that count as the same, e.g. `[[date-time, datetime]]`.' },
    ],
  },
  'const-changed': { description: 'A `const` value changed.', why: 'Clients send or expect the old value.', fix: 'Add a new property, or use an enum with both values during a transition.' },
  'default-changed': {
    description: 'A `default` value changed.',
    why: 'When a client omits the field, the server now behaves differently. The JSON is still valid, so it is a warning.',
    fix: 'Keep the old default, or announce the change.',
  },
  'enum-value-added': {
    description: 'A value was added to an enum.',
    why: REQ_RESP_WHY('old clients never send it.', 'clients with exhaustive switches or strict enum types fail on the new value. A warning, because tolerant clients are fine.'),
    fix: 'Mark enums that clients must treat as open with `x-api-diff: { enum: open }`, or only send the new value to clients that support it.',
    options: [
      { name: 'honour-open-hint', default: 'true', description: 'Treat enums marked `x-api-diff: { enum: open }` as `info`.' },
      { name: 'open-extensions', default: '[]', description: 'Other extensions that mean "open enum", e.g. `[x-extensible-enum]`.' },
    ],
  },
  'enum-value-removed': {
    description: 'A value was removed from an enum.',
    why: REQ_RESP_WHY('clients sending it are rejected.', 'clients stop receiving it, which is safe.'),
    fix: 'In requests, keep accepting the value (it can be deprecated in the description).',
  },
  'enum-added': {
    description: 'A free value became a closed set (an `enum` was added).',
    why: REQ_RESP_WHY('clients sending other values are rejected.', 'clients receive a subset of values.'),
    fix: 'In requests, keep the value free and validate it softly.',
  },
  'enum-removed': {
    description: 'An `enum` was removed, so any value of the type is allowed.',
    why: REQ_RESP_WHY('more values are valid.', 'clients written for the closed set may fail on other values.'),
    fix: 'Keep the enum in responses if clients rely on it.',
  },
  'max-length-decreased': { description: '`maxLength` decreased.', why: REQ_RESP_WHY('longer strings are rejected.', 'clients receive shorter strings, which is safe.'), fix: 'Keep the old maximum in requests.' },
  'min-length-increased': { description: '`minLength` increased.', why: REQ_RESP_WHY('shorter strings are rejected.', 'clients receive longer strings, which is safe.'), fix: 'Keep the old minimum in requests.' },
  'max-length-increased': { description: '`maxLength` increased.', why: REQ_RESP_WHY('more strings are valid.', 'clients may store values in buffers or columns sized for the old maximum.'), fix: 'Check that clients can store the longer values.' },
  'min-length-decreased': { description: '`minLength` decreased.', why: REQ_RESP_WHY('more strings are valid.', 'clients may receive shorter (e.g. empty) strings than they expect.'), fix: 'Check that clients handle the shorter values.' },
  'maximum-decreased': { description: '`maximum` or `exclusiveMaximum` decreased.', why: REQ_RESP_WHY('larger numbers are rejected.', 'clients receive smaller numbers, which is safe.'), fix: 'Keep the old maximum in requests.' },
  'minimum-increased': { description: '`minimum` or `exclusiveMinimum` increased.', why: REQ_RESP_WHY('smaller numbers are rejected.', 'clients receive larger numbers, which is safe.'), fix: 'Keep the old minimum in requests.' },
  'maximum-increased': { description: '`maximum` or `exclusiveMaximum` increased.', why: REQ_RESP_WHY('more numbers are valid.', 'clients may store values in types sized for the old maximum.'), fix: 'Check that clients handle the larger values.' },
  'minimum-decreased': { description: '`minimum` or `exclusiveMinimum` decreased.', why: REQ_RESP_WHY('more numbers are valid.', 'clients may receive values (e.g. negatives) they do not expect.'), fix: 'Check that clients handle the smaller values.' },
  'multiple-of-changed': { description: '`multipleOf` changed. Whether it narrowed or widened is worked out from the values.', why: REQ_RESP_WHY('values valid before may be rejected.', 'clients may receive values that are not multiples of the old step.'), fix: 'Keep the old step.' },
  'max-items-decreased': { description: '`maxItems` decreased.', why: REQ_RESP_WHY('longer arrays are rejected.', 'clients receive shorter arrays, which is safe.'), fix: 'Keep the old maximum in requests.' },
  'min-items-increased': { description: '`minItems` increased.', why: REQ_RESP_WHY('shorter arrays are rejected.', 'clients receive longer arrays, which is safe.'), fix: 'Keep the old minimum in requests.' },
  'max-items-increased': { description: '`maxItems` increased.', why: REQ_RESP_WHY('more arrays are valid.', 'clients may receive longer arrays than they handle.'), fix: 'Check that clients handle the longer arrays, or paginate.' },
  'min-items-decreased': { description: '`minItems` decreased.', why: REQ_RESP_WHY('more arrays are valid.', 'clients may receive shorter (e.g. empty) arrays than they expect.'), fix: 'Check that clients handle the shorter arrays.' },
  'unique-items-added': { description: '`uniqueItems: true` was added.', why: REQ_RESP_WHY('arrays with duplicates are rejected.', 'clients receive arrays without duplicates, which is safe.'), fix: 'In requests, deduplicate on the server instead of rejecting.' },
  'unique-items-removed': { description: '`uniqueItems` was removed.', why: REQ_RESP_WHY('more arrays are valid.', 'clients that treat the array as a set may mis-handle duplicates.'), fix: 'Keep returning unique items if clients rely on it.' },
  'pattern-added': { description: 'A `pattern` was added to a string schema.', why: REQ_RESP_WHY('values that do not match are rejected.', 'clients receive values in a narrower form, which is safe.'), fix: 'In requests, keep the value unconstrained.' },
  'pattern-removed': { description: 'A `pattern` was removed.', why: REQ_RESP_WHY('more values are valid.', 'clients that parse values by the old pattern may fail.'), fix: 'Keep the pattern in responses if clients rely on it.' },
  'pattern-changed': { description: 'A `pattern` changed. Until regular expressions can be compared, the direction is unknown.', why: 'The new pattern may reject old values or produce new ones; it can\'t be decided from the spec.', fix: 'Check the change by hand.' },
  'union-branch-added': { description: 'A branch was added to a `oneOf` or `anyOf`. Branches are matched by discriminator value, `$ref` target or structure, not by position. When the discriminator value for the branch was added with it, the finding names the value and no separate `discriminator-mapping-added` is reported.', why: REQ_RESP_WHY('more values are valid.', 'clients receive a variant they were not written to handle.'), fix: 'Only return the new variant to clients that support it.' },
  'union-branch-removed': { description: 'A branch was removed from a `oneOf` or `anyOf`. When the discriminator value for the branch was removed with it, the finding names the value and no separate `discriminator-mapping-removed` is reported.', why: REQ_RESP_WHY('clients sending that variant are rejected.', 'clients stop receiving it, which is safe.'), fix: 'In requests, keep accepting the variant.' },
  'union-kind-changed': { description: '`anyOf` became `oneOf` or the other way round.', why: 'On the wire, values matching several branches change validity. In generated SDKs, union types change shape.', fix: 'Keep the original keyword.' },
  'discriminator-property-changed': { description: '`discriminator.propertyName` changed.', why: 'Clients send or read the variant name in the old property.', fix: 'Keep the old discriminator property.' },
  'discriminator-mapping-added': { description: 'A new value in `discriminator.mapping` for a variant that was already there (an alias), or with no union beside it (a parent schema that children extend with `allOf`). A value added together with its `oneOf`/`anyOf` branch is reported as `union-branch-added` instead.', why: REQ_RESP_WHY('more values are valid.', 'clients receive a variant name they do not know.'), fix: 'Only return the new variant to clients that support it.' },
  'discriminator-mapping-removed': { description: 'A value was removed from `discriminator.mapping` while its schema stays a variant (an alias dropped), or with no union beside it. A value removed together with its `oneOf`/`anyOf` branch is reported as `union-branch-removed` instead.', why: REQ_RESP_WHY('clients sending that variant are rejected.', 'clients stop receiving it, which is safe.'), fix: 'In requests, keep accepting the variant.' },
  'discriminator-mapping-changed': { description: 'A discriminator value now maps to a different schema.', why: 'Clients send or parse the old shape for that value.', fix: 'Add a new discriminator value for the new schema.' },

  // 8. References and components
  'ref-target-changed': {
    description: 'A `$ref` points at a different component, e.g. `Customer` → `CustomerV2`. Field-level differences between the two are reported as their own findings.',
    why: 'If the schemas are identical, the wire format is unchanged, but generated SDKs use component names as type names, so code referring to the old type stops compiling.',
    fix: 'Keep the old component name, or keep it as an alias of the new one.',
  },
  'ref-inlined': {
    description: 'A `$ref` was replaced by an inline schema.',
    why: 'The named type disappears from generated SDKs (replaced by an anonymous one).',
    fix: 'Keep the `$ref`.',
  },
  'ref-extracted': {
    description: 'An inline schema was moved into a component and replaced by a `$ref`.',
    why: 'Generated SDKs get a new named type in place of an anonymous one; code may need updating. The wire format is unchanged.',
    fix: 'Usually nothing; check the SDK change is intended.',
  },
  'component-renamed': {
    description: 'A component was renamed: a component disappeared and one with the same structure (shape hash) and a new name appeared. Matches are one-to-one; when several components share a structure, they stay removed + added. A `$ref` that now points at the new name is part of the rename, not a separate `ref-target-changed`. Recursive schemas (one that refers to itself, or a group that refers to each other) are matched by a key in which references inside the group do not use names, so they are found too; members of a group that are identical apart from their names cannot be told apart and stay unmatched.',
    why: 'Generated SDK type names change.',
    fix: 'Keep the old name.',
    options: [{ name: 'match', default: 'exact', description: '`exact` (same shape hash; descriptions and examples may differ) or `similar` (also matches when the type and the property names and types are the same, e.g. only limits changed).' }],
  },
  'schema-title-changed': {
    description: "A schema's `title` changed.",
    why: 'Some SDK generators name types after the title.',
    fix: 'Keep the old title if SDK compatibility matters.',
  },
  'component-added': { description: 'A component that nothing uses was added.', why: 'It affects no operation.', fix: 'Nothing to fix.' },
  'component-removed': { description: 'A component that nothing used was removed.', why: 'It affected no operation.', fix: 'Nothing to fix.' },
  'component-unused': { description: 'A component changed, but no operation uses it.', why: 'The change affects no operation (it may be used by other specs or code generators).', fix: 'Nothing to fix; consider removing unused components.' },

  // 9. Lifecycle and versions
  'deprecated-added': { description: 'An operation, parameter, property or schema was marked `deprecated: true`.', why: 'Nothing breaks yet; it starts the deprecation period.', fix: 'Nothing to fix; announce it.' },
  'deprecated-removed': { description: 'A deprecation was withdrawn.', why: 'Nothing breaks.', fix: 'Nothing to fix.' },
  'sunset-moved-earlier': { description: 'A sunset date (from the configured extension, `x-sunset` by default) moved earlier.', why: 'Clients planning around the old date have less time.', fix: 'Keep the original sunset date.' },
  'stability-decreased': { description: 'A stability level went down, e.g. `stable` → `beta` (from the configured extension, `x-stability-level` by default).', why: 'Clients relying on stability guarantees lose them.', fix: 'Keep the stability level.', options: [{ name: 'levels', default: '[draft, alpha, beta, stable]', description: 'Order of stability levels, lowest first.' }] },
  'version-bump-too-small': {
    description: 'Under `semver`, the version went up by less than the findings need: any `error` finding needs a major bump, any other `wire` or `sdk` finding a minor bump, and `docs`-only changes a patch bump. Below 1.0.0 each need is one level lower (a breaking change needs a minor bump). Uses the final severities, after the policy. Not checked under `calver`; a version that isn\'t semver gives a `not-compared` notice instead.',
    why: 'Consumers relying on semantic versioning upgrade without expecting breakage.',
    fix: 'Bump the major version, or avoid the breaking change.',
    options: [{ name: 'scheme', default: 'semver', description: '`semver`, `calver` (this rule doesn\'t apply) or `none` (turns off both version rules).' }],
  },
  'version-unchanged': { description: "The spec changed (any finding except notices such as `spec-invalid` or `not-compared`) but the recorded version didn't. The version comes from the policy's `versions` section (`info.version` by default) or `--base-version` / `--revision-version`.", why: 'Consumers cannot tell versions apart.', fix: 'Bump the version.', options: [{ name: 'scheme', default: 'semver', description: '`semver`, `calver` or `none` (turns off both version rules).' }] },

  // 10. Docs
  'description-changed': { description: 'A `description` changed.', why: 'Documentation only.', fix: 'Nothing to fix.' },
  'summary-changed': { description: 'A `summary` changed.', why: 'Documentation only.', fix: 'Nothing to fix.' },
  'title-changed': { description: 'A `title` outside schemas changed (schema titles are `schema-title-changed`).', why: 'Documentation only.', fix: 'Nothing to fix.' },
  'example-changed': { description: 'An `example` or `examples` changed.', why: 'Documentation only.', fix: 'Nothing to fix.' },
  'external-docs-changed': { description: '`externalDocs` changed.', why: 'Documentation only.', fix: 'Nothing to fix.' },
  'tag-added': { description: 'A tag was added to the top-level `tags` list.', why: 'Documentation only.', fix: 'Nothing to fix.' },
  'tag-removed': { description: 'A tag was removed from the top-level `tags` list.', why: 'Documentation only (operation tags are `operation-tags-changed`).', fix: 'Nothing to fix.' },
  'tag-description-changed': { description: "A tag's description changed.", why: 'Documentation only.', fix: 'Nothing to fix.' },
  'info-changed': { description: '`info` changed: contact, license or terms of service.', why: 'Documentation only.', fix: 'Nothing to fix.' },
  'extension-changed-sdk': {
    description: "An `x-` extension that the policy's `extensions` section classifies as `sdk` changed, e.g. `x-enum-varnames` or `x-go-type`, which code generators read.",
    why: 'Generated SDK code changes (renamed constants, different types) even though the JSON on the wire is the same. `info` by default, `warn` under `--profile sdk`.',
    fix: 'Keep the extension value, or treat the change as an SDK release with notes.',
  },
  'extension-changed-wire': {
    description: "An `x-` extension that the policy's `extensions` section classifies as `wire` changed: one that changes what servers or gateways accept or send.",
    why: "The extension affects behaviour on the wire, but api-diff can't tell how, so it might break clients.",
    fix: 'Check what the extension controls; keep the old value if clients depend on it.',
  },
  'extension-changed': { description: 'An `x-` extension the policy does not classify as `wire` or `sdk` changed.', why: 'Treated as documentation unless the policy says otherwise.', fix: 'Classify extensions that affect clients or SDKs in the policy `extensions` section.' },

  // 11. Notices
  'spec-invalid': {
    description: "A document can't be parsed, isn't OpenAPI 3.0–3.2, or is invalid in a way that affects the comparison (e.g. a path parameter missing from its template, two templates for the same path).",
    why: "Parts of the spec can't be compared, so the result can't be trusted.",
    fix: 'Fix the document at the reported location.',
  },
  'ref-unresolved': {
    description: "A `$ref` points at a file or location that doesn't exist, or loops back on itself. The node it should provide is treated as absent, so related changes are reported too.",
    why: "The spec is broken there, and clients generated from it may be too.",
    fix: 'Fix the reference at the reported location.',
  },
  'discriminator-mapping-orphaned': {
    description: "A `discriminator.mapping` value beside a `oneOf`/`anyOf` points at a schema that isn't one of its branches, or that doesn't exist: usually a value left behind when its branch was removed. Checked on the revision only, whatever changed. Not checked for a discriminator with no union beside it (a parent schema that children extend with `allOf`), or when a branch is itself a union.",
    why: 'A payload with that value is routed to a schema the union rejects, so it can never be valid; generated clients may still offer the value.',
    fix: 'Remove the mapping value, or add its schema back as a branch.',
  },
  'cycle-not-productive': {
    description: 'A schema cycle that never passes through a property, `items` or `additionalProperties`, e.g. `A: allOf [$ref A]`. It describes no valid value.',
    why: 'Tools that expand it loop forever; the schema is meaningless.',
    fix: 'Break the cycle with a property or array step.',
  },
  'documents-unrelated': {
    description: "The two documents share almost nothing, so they look like different APIs rather than two versions of one. The check runs before the diff and compares three signals: operations (method plus path, with version-like segments, server base paths and parameter names normalised), `operationId`s and component schema names. Each is measured as shared items divided by the size of the smaller document, so an API that grew a lot still counts as related. It fires only when every usable signal is below `min-overlap` and the `info.title` or every server host also differs. When it fires, the diff stops and this is the only finding.",
    why: 'Comparing two unrelated APIs reports every operation as removed and added: hundreds of errors that hide the real mistake, usually a wrong path on the command line.',
    fix: 'Check that both inputs point at the same API. For an intentional rewrite, set `documents-unrelated: off` in the policy, or lower `min-overlap`.',
    options: [
      { name: 'min-overlap', default: '0.1', description: 'The documents count as related if any signal reaches this share (shared items divided by the size of the smaller document).' },
      { name: 'signals', default: '[operations, operation-ids, schemas]', description: 'Which overlaps to measure. One signal at or above `min-overlap` is enough. A signal that is empty on either side is skipped.' },
      { name: 'min-size', default: '5', description: 'Skip the check when the smaller document has fewer operations and fewer schemas than this, since a tiny overlap means little there. An empty base is always skipped.' },
      { name: 'ignore-path-segments', default: "['^v\\d+((alpha|beta|rc)\\d*)?$', '^\\d{4}-\\d{2}-\\d{2}$']", description: 'Regular expressions for path segments dropped before comparing paths, anywhere in the path (by default `v1`, `v2beta1`, `v3rc2`, `2024-01-01`). Works with any number of different prefixes.' },
      { name: 'strip-prefixes', default: '[]', description: 'Extra path prefixes removed before comparing, e.g. `[/api, /internal]`.' },
      { name: 'when', default: 'manual', description: '`manual` skips the check when both inputs are the same path at two git revisions. `always` checks those too.' },
    ],
  },
  'acknowledgement-stale': {
    description: 'An entry in the acknowledgements file names a finding ID that no longer appears: the change was fixed, or the finding changed and got a new ID.',
    why: 'Notice only: the file should be cleaned up so it lists only accepted findings.',
    fix: 'Remove the entry, or acknowledge the finding under its new ID.',
  },
  'acknowledgement-expired': {
    description: "An acknowledgement's `expires` date has passed (as of today, or `--as-of`), so its finding counts again and can fail CI.",
    why: 'Notice only: it explains why a previously accepted finding is back.',
    fix: 'Fix the change, or renew the acknowledgement with a new `expires` date and reason.',
  },
  'acknowledgement-not-owner': {
    description: "With `acknowledgements.require-owner: true` in the policy, an acknowledgement whose `owner` isn't one of the finding's owners (or that has no `owner`) doesn't apply: the finding counts as if it weren't acknowledged.",
    why: 'Notice only: it explains why an acknowledged finding still counts. Only a team that owns the affected operations should accept a change to them.',
    fix: "Have an owner of the finding acknowledge it (set `owner` to one of the teams listed), or fix the finding's owners (`x-owner` or `owners.assign`).",
  },
  'not-compared': {
    description: "Notice for parts of the spec that weren't compared: webhooks, callbacks, `$ref`s to external URLs, and ignored exclusions.",
    why: 'So nothing is skipped silently.',
    fix: 'Nothing to fix.',
  },
};
