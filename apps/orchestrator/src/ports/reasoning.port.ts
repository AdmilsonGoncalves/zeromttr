import type { CollectedEvidence, RcaAndPatchSynthesis } from '@zeromttr/contracts';

export type { CollectedEvidence, RcaAndPatchSynthesis };

export interface ReasoningPort {
  synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis>;
}

/**
 * Port for validating syntactic validity of a generated source-code patch.
 */
export interface PatchSyntaxValidatorPort {
  isValidSyntax(filePath: string, content: string): boolean;
}
