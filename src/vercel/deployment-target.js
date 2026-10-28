// The provider encodes a deployment's target in its own vocabulary: the
// vendored OpenAPI deployment object carries target as a nullable string —
// "production", "staging", or null — and documents that null indicates a
// preview deployment. Tools ask in the caller's vocabulary ("preview" /
// "production"); this matcher is the single place the two meet, so a
// provider response in its real shape is recognized everywhere the
// deployment-create segment checks identity (AUD-H / VMCP-023).
export function deploymentTargetMatches(actual, expected) {
  if (expected === 'preview') {
    return actual === null || actual === undefined || actual === 'preview';
  }
  if (expected === 'production') return actual === 'production';
  return false;
}
