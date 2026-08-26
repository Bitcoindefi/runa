# Contributing

Thanks for being here. This document exists so you never have to guess how things
work in this repository.

## How work gets picked up

1. **Comment on the issue** you want, with a concrete plan: which file, which
   function, and how you will verify the change.
2. **Wait to be assigned.** Issues are handed out on the quality of that plan, not on
   who asked first. A short comment that names `lib/render.js` and the exact symptom
   beats a long one that says "I would love to work on this".
3. **Then open the pull request**, with `Closes #N` in the body.

Opening a pull request for an issue that is assigned to someone else wastes your time
and theirs. If an issue has been assigned for a while with no movement, say so in the
issue and ask; do not just start working.

## What makes a pull request mergeable

- It **builds and passes**. Run whatever the repository runs in CI before you push.
- It is **focused**. One issue per pull request. A change that fixes three unrelated
  things is three pull requests.
- It **does not stack on your own previous branches**. If pull request B contains all
  of pull request A plus one file, they cannot be reviewed or merged independently.
- The **tests you add actually protect something**. A test that passes with and
  without your fix is not a test.

If CI has not run on your pull request, it is usually because GitHub asks a maintainer
to approve workflow runs from first-time contributors. Say so in the pull request and
someone will approve it. A pull request with no checks is not a pull request that
passed; it is one that never ran.

## About payment

Some issues here are part of an open-source campaign, and carry labels saying so.

**Payment is handled entirely through that campaign's platform. It is never arranged
in this repository.** Concretely:

- **Do not post a wallet address** in an issue or a pull request. It does not register
  you for anything, it does not speed anything up, and it is not how any payment
  reaches you.
- Posting an address does not count as claiming an issue. Only a comment with a plan
  does, followed by being assigned.
- Nobody from this project will ever ask you to send funds, sign a transaction, or
  connect a wallet in order to contribute. If someone does, they are not us.

None of this is a complaint about anyone. It is written down because it was not
written down before, and people reasonably guessed.

## What gets an account blocked

Not etiquette. Only this pattern: **claiming many issues and delivering nothing.**

Blocks so far have gone to accounts that commented on a dozen issues within a minute
claiming solutions, with zero code, citing files that do not exist in this repository.
That is the line. Writing a rough plan, getting something wrong, or opening a pull
request that needs changes are all normal parts of contributing and cost you nothing
here.
