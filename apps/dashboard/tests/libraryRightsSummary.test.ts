import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLibraryRightsSummary,
  deriveSplitStateFromLatestVersion
} from "../src/lib/libraryRightsSummary.js";

test("solo owned work resolves 100% owner readiness", () => {
  const splitState = deriveSplitStateFromLatestVersion({ latestVersionStatus: "locked", participantCount: 1 });
  const summary = buildLibraryRightsSummary({
    isOwner: true,
    isCollaboration: false,
    isDerivative: false,
    contentStatus: "published",
    storefrontStatus: "LISTED",
    priceSats: "1000",
    splitState,
    participantCount: 1
  });

  assert.equal(summary.ownershipKind, "owned");
  assert.equal(summary.splitState, "solo");
  assert.equal(summary.commercialReadiness, "ready");
});

test("shared owned work resolves shared split state", () => {
  const splitState = deriveSplitStateFromLatestVersion({ latestVersionStatus: "locked", participantCount: 3 });
  const summary = buildLibraryRightsSummary({
    isOwner: true,
    isCollaboration: false,
    isDerivative: false,
    contentStatus: "published",
    storefrontStatus: "LISTED",
    priceSats: "0",
    splitState,
    participantCount: 3
  });

  assert.equal(summary.ownershipKind, "owned");
  assert.equal(summary.splitState, "shared");
  assert.equal(summary.participantCount, 3);
});

test("collaborator work does not imply seller ownership", () => {
  const summary = buildLibraryRightsSummary({
    isOwner: false,
    isCollaboration: true,
    isDerivative: false,
    contentStatus: "published",
    storefrontStatus: "LISTED",
    priceSats: "1500",
    splitState: "shared",
    myRole: "writer",
    mySplitBps: 2500
  });

  assert.equal(summary.ownershipKind, "collaboration");
  assert.equal(summary.sellerOfRecord, false);
  assert.equal(summary.myRole, "writer");
  assert.equal(summary.mySplitBps, 2500);
});

test("derivative awaiting clearance is not commercially ready", () => {
  const summary = buildLibraryRightsSummary({
    isOwner: true,
    isCollaboration: false,
    isDerivative: true,
    contentStatus: "published",
    storefrontStatus: "LISTED",
    priceSats: "2000",
    derivative: {
      status: "PENDING",
      approvedApprovers: 1,
      requiredApprovers: 2,
      approvedWeightBps: 5000,
      approvalBpsTarget: 6667
    }
  });

  assert.equal(summary.ownershipKind, "derivative");
  assert.equal(summary.derivative?.clearanceStatus, "partial");
  assert.equal(summary.commercialReadiness, "awaiting_clearance");
});

test("cleared derivative becomes ready", () => {
  const summary = buildLibraryRightsSummary({
    isOwner: true,
    isCollaboration: false,
    isDerivative: true,
    contentStatus: "published",
    storefrontStatus: "LISTED",
    priceSats: "2000",
    derivative: {
      status: "APPROVED",
      approvedApprovers: 2,
      requiredApprovers: 2,
      approvedWeightBps: 10000,
      approvalBpsTarget: 6667
    }
  });

  assert.equal(summary.derivative?.clearanceStatus, "cleared");
  assert.equal(summary.commercialReadiness, "ready");
});
