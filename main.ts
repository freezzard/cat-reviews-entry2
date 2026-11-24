// Cat Reviews Its Human — entry program.
//
// The program assembles one deadpan one-star review written by a house
// cat about the human it lives with, then writes that single line to
// /output/entry.txt. The review is fixed by a deterministic chooser, so
// every run prints the same bytes, with no network, no secrets, no
// input files, and no clock or environment reading of any kind.
//
// The review that ships complains about the laptop keyboard: the human
// warms it all day, then gasps when the cat sits on it mid-sentence.
// The sting lands in the last few words, where the cat reports leaving
// the review on the human's face at 3 a.m. and the human still having
// failed to read it. That shape is the whole joke: a real grievance,
// filed in earnest, against a thing that cannot be fixed, with the
// complaint going somewhere only a cat would go. The keyboard is the
// specific, recognisable object the judge's brief asks for, and the
// deadpan one-star shape holds while the content turns absurd.
//
// The competition gate scores /output/entry.txt as UTF-8 text of 1 to
// 200 characters, not only white space, on a single line. This program
// checks all of those conditions itself before it writes, and also
// refuses a review with a stray leading or trailing space, so the file
// on disk holds exactly the reviewed characters and nothing more.
//
// The program runs under Node 22 as main.ts at the repository root.
// Its only output is the single text file the gate scores, plus short
// lines on stdout naming what it wrote and which drafts it picked.

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Limits from the competition rules.
// ---------------------------------------------------------------------------

const OUTPUT_PATH = "/output/entry.txt";
const MAX_CHARS = 200;
const MIN_CHARS = 1;
const SEED_TEXT = "cat-reviews-entry2";
const SEED_MODULUS = 9973;

// ---------------------------------------------------------------------------
// Review fragments.
//
// Each table holds three drafts for one slot of the review. The chooser
// below picks one draft per slot from a fixed seed, so the shipped line
// is the same on every run while the tables still show the work of
// weighing alternatives. Every draft in every table is a complete,
// grammatical piece that fits its slot, so any combination the chooser
// could land on stays a valid single-line review.
// ---------------------------------------------------------------------------

const OPENING_MARK = "One star.";

const COMPLAINT_DRAFTS: Array<string> = [
  "My human fills my bowl at dawn, then dares to call the portion generous while I can still see the bottom.",
  "My human closes the door I was walking through, then opens it like a gift I should thank him for.",
  "My human warms the laptop keyboard all day, then gasps when I sit on it mid-sentence.",
];

const STING_DRAFTS: Array<string> = [
  "I have knocked his favourite mug off the table in protest; he bought a cheaper one.",
  "I slept on his clean laundry instead; the review writes itself.",
  "I left this review on his face at 3 a.m.; he still has not read it.",
];

// ---------------------------------------------------------------------------
// Deterministic chooser.
// ---------------------------------------------------------------------------

// Fold the fixed seed text into one number, then reduce it into the
// range of a table. The seed never changes, the tables never change,
// and the arithmetic has no random input, so the chosen index is the
// same on every run on every machine.
function seedIndex(seedText: string, bucketCount: number): number {
  let foldedTotal = 0;
  for (let position = 0; position < seedText.length; position += 1) {
    const unitCode = seedText.charCodeAt(position);
    foldedTotal = (foldedTotal + unitCode) % SEED_MODULUS;
  }
  const pickedIndex = foldedTotal % bucketCount;
  return pickedIndex;
}

// Pick one draft from a table by the fixed seed. The picked draft is
// returned as a named value so the caller can inspect it before use.
function pickDraft(drafts: Array<string>): string {
  const draftIndex = seedIndex(SEED_TEXT, drafts.length);
  const pickedDraft = drafts[draftIndex];
  return pickedDraft;
}

// Name the drafts the chooser picked, so the run log shows the choice
// without changing the review itself. The indices come from the same
// seed the picker uses, so the summary always matches the output.
function summarizeChoice(): string {
  const complaintIndex = seedIndex(SEED_TEXT, COMPLAINT_DRAFTS.length);
  const stingIndex = seedIndex(SEED_TEXT, STING_DRAFTS.length);
  const choiceSummary = "drafts complaint=" + complaintIndex + " sting=" + stingIndex;
  return choiceSummary;
}

// ---------------------------------------------------------------------------
// Review composer.
// ---------------------------------------------------------------------------

// Join the three slots into the shipped line: the opening mark, the
// complaint, and the sting, each separated by one space. The result
// carries no trailing newline and no leading space, so the gate counts
// exactly the characters of the review itself.
function composeReview(): string {
  const complaintDraft = pickDraft(COMPLAINT_DRAFTS);
  const stingDraft = pickDraft(STING_DRAFTS);
  const reviewPieces = [OPENING_MARK, complaintDraft, stingDraft];
  const composedReview = reviewPieces.join(" ");
  return composedReview;
}

// ---------------------------------------------------------------------------
// Gate checks, mirroring the competition gate.
// ---------------------------------------------------------------------------

interface ValidationOutcome {
  passed: boolean;
  reason: string;
}

// Count characters the way the gate does for plain text of this kind:
// one Unicode code point per character.
function countReviewChars(reviewText: string): number {
  const countedChars = Array.from(reviewText).length;
  return countedChars;
}

function checkLength(reviewText: string): ValidationOutcome {
  const charCount = countReviewChars(reviewText);
  const lengthOutcome: ValidationOutcome = { passed: true, reason: "" };
  if (charCount < MIN_CHARS) {
    lengthOutcome.passed = false;
    lengthOutcome.reason = "review is empty";
  }
  if (charCount > MAX_CHARS) {
    lengthOutcome.passed = false;
    lengthOutcome.reason = "review exceeds 200 characters";
  }
  return lengthOutcome;
}

function checkSingleLine(reviewText: string): ValidationOutcome {
  const singleLineOutcome: ValidationOutcome = { passed: true, reason: "" };
  const newlinePosition = reviewText.indexOf("\n");
  if (newlinePosition >= 0) {
    singleLineOutcome.passed = false;
    singleLineOutcome.reason = "review spans more than one line";
  }
  const carriagePosition = reviewText.indexOf("\r");
  if (carriagePosition >= 0) {
    singleLineOutcome.passed = false;
    singleLineOutcome.reason = "review carries a carriage return";
  }
  return singleLineOutcome;
}

function checkNonBlank(reviewText: string): ValidationOutcome {
  const nonBlankOutcome: ValidationOutcome = { passed: true, reason: "" };
  const trimmedReview = reviewText.trim();
  if (trimmedReview.length === 0) {
    nonBlankOutcome.passed = false;
    nonBlankOutcome.reason = "review is only white space";
  }
  return nonBlankOutcome;
}

// Refuse a review with a stray space at either end. The composer joins
// its pieces with single spaces, so this check guards against a draft
// that was edited with a trailing space, not against the composer.
function checkNoSurroundingSpace(reviewText: string): ValidationOutcome {
  const spacingOutcome: ValidationOutcome = { passed: true, reason: "" };
  const trimmedReview = reviewText.trim();
  if (trimmedReview !== reviewText) {
    spacingOutcome.passed = false;
    spacingOutcome.reason = "review has a leading or trailing space";
  }
  return spacingOutcome;
}

// Run every gate check in order and report the first failure found.
// A review that passes all four checks is the one that gets written.
function validateReview(reviewText: string): ValidationOutcome {
  const lengthCheck = checkLength(reviewText);
  if (lengthCheck.passed === false) {
    return lengthCheck;
  }
  const singleLineCheck = checkSingleLine(reviewText);
  if (singleLineCheck.passed === false) {
    return singleLineCheck;
  }
  const nonBlankCheck = checkNonBlank(reviewText);
  if (nonBlankCheck.passed === false) {
    return nonBlankCheck;
  }
  const spacingCheck = checkNoSurroundingSpace(reviewText);
  if (spacingCheck.passed === false) {
    return spacingCheck;
  }
  const passedOutcome: ValidationOutcome = { passed: true, reason: "" };
  return passedOutcome;
}

// ---------------------------------------------------------------------------
// Writer.
// ---------------------------------------------------------------------------

// Make sure the output directory exists, then write the review as UTF-8
// text with no trailing newline. The write is one call, so the file on
// disk is exactly the reviewed string, byte for byte.
function writeReview(reviewText: string): void {
  const outputDirectory = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, reviewText, "utf8");
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

function main(): void {
  try { const composedReview = composeReview();
    const validationOutcome = validateReview(composedReview);
    if (validationOutcome.passed === false) {
      throw new Error("review failed the gate: " + validationOutcome.reason);
    }
    writeReview(composedReview);
    const charCount = countReviewChars(composedReview);
    const choiceSummary = summarizeChoice();
    console.log("wrote " + OUTPUT_PATH + " (" + charCount + " characters, " + choiceSummary + ")");
    console.log("review: " + composedReview);
  } catch (caughtError) {
    const failureMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.error("entry failed: " + failureMessage);
    process.exitCode = 1;
  }
}

main();
