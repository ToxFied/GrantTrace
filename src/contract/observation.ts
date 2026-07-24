import { z } from "zod";

import { PermissionDNFSchema, ScenarioNameSchema } from "../permissions/schema.js";
import { isSyntacticallySafeTemplate } from "../routes/canonical.js";
import type { PermissionDNF } from "../permissions/types.js";

export const ObservationFindingSchema = z.enum([
  "unresolved_route",
  "missing_evidence",
  "malformed_header",
  "evidence_contradiction",
  "unsupported_api",
]);

export type ObservationFinding = z.infer<typeof ObservationFindingSchema>;

export const ObservationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    scenario: ScenarioNameSchema,
    method: z.enum([
      "DELETE",
      "GET",
      "HEAD",
      "PATCH",
      "POST",
      "PUT",
      "UNKNOWN",
    ]),
    routeTemplate: z
      .string()
      .min(1)
      .max(256)
      .startsWith("/")
      .refine(isSyntacticallySafeTemplate)
      .nullable(),
    status: z.number().int().min(100).max(599).nullable(),
    requirements: PermissionDNFSchema.nullable(),
    evidenceSource: z.enum([
      "runtime_header",
      "pinned_catalog",
      "none",
    ]),
    finding: ObservationFindingSchema.nullable(),
  })
  .superRefine((observation, context) => {
    if (
      observation.requirements !== null &&
      observation.evidenceSource === "none"
    ) {
      context.addIssue({
        code: "custom",
        message: "Requirements need an evidence source.",
        path: ["evidenceSource"],
      });
    }
    if (
      observation.evidenceSource !== "none" &&
      observation.requirements === null
    ) {
      context.addIssue({
        code: "custom",
        message: "An evidence source needs requirements.",
        path: ["requirements"],
      });
    }

    if (observation.finding === null && observation.requirements === null) {
      context.addIssue({
        code: "custom",
        message: "A classified observation needs permission evidence.",
        path: ["requirements"],
      });
    }

    if (
      observation.finding !== null &&
      (observation.requirements !== null ||
        observation.evidenceSource !== "none")
    ) {
      context.addIssue({
        code: "custom",
        message: "A finding cannot also carry resolved evidence.",
        path: ["finding"],
      });
    }

    const routeMustBeAbsent =
      observation.finding === "unresolved_route" ||
      observation.finding === "unsupported_api";
    if (routeMustBeAbsent && observation.routeTemplate !== null) {
      context.addIssue({
        code: "custom",
        message: "An unresolved or unsupported observation cannot retain a route.",
        path: ["routeTemplate"],
      });
    }
    if (
      !routeMustBeAbsent &&
      observation.routeTemplate === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A route-specific observation needs a safe template.",
        path: ["routeTemplate"],
      });
    }
  });

export type Observation = {
  schemaVersion: 1;
  scenario: string;
  method:
    | "DELETE"
    | "GET"
    | "HEAD"
    | "PATCH"
    | "POST"
    | "PUT"
    | "UNKNOWN";
  routeTemplate: string | null;
  status: number | null;
  requirements: PermissionDNF | null;
  evidenceSource: "runtime_header" | "pinned_catalog" | "none";
  finding: ObservationFinding | null;
};
