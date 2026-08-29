# Learnings from the repository-wide guard review cycle

Recorded per `AGENTS.md`: when compiling review feedback, record learnings in `documentation/learnings/` and update relevant rules. Source is the review cycle on [#327](https://github.com/stevekinney/tribunal/pull/327) (banning `bun:test` by lint rule, TRI-34). Twelve rounds and roughly fifty findings, every one legitimate. The ticket asked for a lint rule; what the rounds were actually about was the repository-wide backstop added because a lint rule cannot reach workspaces that declare no `lint` script.

## Matching a language versus parsing it

- **A regular expression cannot answer a question about a lexical grammar, and rounds of patching will not change that.** Five consecutive rounds each found a construct the matcher missed: multiline imports, block comments between tokens, line comments between tokens, template-literal specifiers, `import(spec, options)`, and finally a semicolon inside a comment inside a static import — which defeats `[^;]*?` by construction. Each fix was correct and the next construct still got through. Two reviewers independently wrote "or parse the import expression"; that was the finding, not the workaround.
- **The same lesson arrives twice if you only learn it once.** After moving to `ts.createSourceFile`, the Svelte reader was still hand-rolled, and it broke three more times in the same shape — comment delimiters as script data, then as a markup expression, with attribute strings plainly next. Svelte's own parser ended it. If a checker must decide "which of these is really code", use the language's parser; there is one for every language in this repository.
- **Parsing removes the allowlist, not just the bugs.** The regex version had to exempt its own test file, whose fixtures are necessarily real-looking import syntax — and an allowlist inside a check that exists to prevent recurrence is a hole in its purpose. A parser sees those fixtures as string literals, so no file needs exempting at all.
- **A filter should list what it excludes, not what it accepts — and then this was reversed, which is the more useful lesson.** The argument for a blocklist was that an allowlist cannot be complete: `bun bin/run-tests.task` executes JavaScript and a case-sensitive list misses `.TS`. That argument was sound and rested on a false premise — that parsing a non-module is harmless. It is not, because TypeScript's parser recovers rather than failing. See "An exclusion list that grows each round is the wrong shape" below for what replaced it, and note what settled it: not a better principle, but checking the repository's actual extension inventory.

## Resolving scope by the language's rules

- **Three attempts, each correct in one half.** Classifying a call by identifier spelling alone reported a caller's own `require`. Resolving bindings by ancestor walk then descended into nested functions' parameters, so a nested `function helper(require)` shadowed a genuine outer call. Pruning functions but not blocks then let `{ const require = x; }` shadow a call after the block. Each fix converted a false positive into a false negative, which is the worse direction for a ban.
- **The rules are not a heuristic and should not be approximated.** `let`, `const`, and `class` bind only within their block; `var` is function-scoped and hoisted; a function declared inside a block is block-scoped in a module — verified by running `{ function f(){} } f()` under Node, which throws `ReferenceError`. Class static blocks and namespace bodies are their own `var` scopes. Ambient `declare` bindings are erased and bind nothing at runtime. Every one of those was a separate round.
- **Transparency is a property of the node, not of the position it appears in.** Unwrapping parentheses around a module specifier and stopping there left them unhandled around the callee, and left `as const`, angle-bracket assertions, `satisfies`, `!`, and the comma operator unhandled in both. One `unwrapTransparent` applied wherever identity matters, rather than a check bolted onto one call site.

## What a pre-commit gate actually inspects

- **A hook must read what git will commit, not what is on disk.** Pairing filenames from `git ls-files --cached` with worktree reads meant a partially staged file — banned import staged, working copy already corrected — passed the hook while git committed the banned blob. The gate would have been green on precisely the commit that reintroduces what it exists to stop. Scanning both the index blob and the worktree removes the mode flag and the chance of choosing the wrong one.
- **`timeout` on a synchronous spawn is not a deadline.** `Bun.spawnSync` signals the child and then waits for it to exit, so a child that traps SIGTERM is unbounded: measured at 4019ms against a 400ms timeout, versus 403ms with `killSignal: 'SIGKILL'`. In an always-on hook that is the difference between a deadline and a suggestion.
- **An always-on unscoped hook makes false positives expensive.** Descending into gitignored artifact paths would have rejected unrelated commits over a stale checkout in `.tmp/`, and a nested `.worktrees/` copy would have made every scan traverse a duplicate repository. Enumerating through `git ls-files --cached --others --exclude-standard` honours `.gitignore` exactly, with no list to maintain.
- **Consume every response from a batch protocol, do not abort on the first surprise.** `git cat-file --batch` answers a submodule gitlink with a `commit` object; aborting there discarded every remaining entry, and since a missing blob is treated as a bug in the check, one submodule at an extensionless path would have failed every commit in the repository.

## Guarding the guard

- **A rule written to prevent a class of bug can have the same blind spot as the bug.** The invariant test added to stop unbuilt-dependency breakage scanned only `scripts/*.ts`, and passed while a root command was broken. Widened to direct mentions anywhere, it still missed the common case, which is transitive: a test file imports a module that imports the package and mentions it nowhere. Widened again to follow imports, it still followed only `.`-relative specifiers and missed alias hops. Three narrownesses, each found by review while the guard reported success.
- **Precision is what makes an invariant survive.** The blunt version — "any script touching workspace source must build first" — would have covered 53 scripts, most of which never reach the package. An invariant that noisy gets routed around rather than obeyed. Following the real import graph flagged twenty, all genuinely broken.
- **An exemption must name the mechanism, and be checked for existence.** Exemptions carry the reason they resolve the dependency another way, and a test rejects an exemption naming a script that no longer exists — otherwise a deleted target leaves a permanent hole that reads as a decision.

## Trusting your own reports

- **An unasserted string replacement can silently do nothing.** A fix for the subprocess deadline was described in a commit message and reported on the review thread with a measurement table, and `git log -S` later showed no commit had ever contained it. The patch's anchor had not matched, and the result was not checked. The measurement was verified; the edit was not. **Verify the edit landed, not only that the reasoning was right.**
- **A green coverage gate can hide a test that proves nothing, and a red one can be reporting a correctness bug.** A fallback test asserting a single finding never invoked the sort comparator, so it passed identically with the ordering deleted — visible only as a function-coverage gap while lines stayed at 100%. Separately, an unreachable branch flagged by the gate turned out to be unreachable _because it was wrong_: it treated block-scoped function declarations as hoisted. Writing a test for that branch would have pinned incorrect behaviour.
- **Gate the commit on the checks, not alongside them.** Running lint, coverage, and the validator in the same command block as the push meant a red coverage result scrolled past and the push happened anyway. Making the commit conditional on the exit codes — and including every gate CI runs, `check` included — is what actually stops it.
- **A background task's completion notification reports the wrapper's status, not the command's.** A coverage run that had failed was announced as "exit code 0"; the real code was captured only because the command echoed it explicitly.

## A converted test is not a running test

- **Check that something collects the file before believing the conversion did anything.** The two `bun:test` files this cycle converted to Vitest were the whole point of the exercise, and neither was collected by any project: `applications/web`'s server project includes `src/**` and `test/**`, and `packages/database`'s config includes `src/**/*.test.ts`. Both files live under `scripts/`. Naming the file explicitly on the command line does not help — `vitest run --project server <path>` still answers `No test files found, exiting with code 1`, because the include filter is applied to the argument too. That exit code is the cheap check: run the file directly and see whether the runner admits it exists.
- **Converting the imports can expose that the subject is unportable, not just the test.** Once collected, `applications/web/scripts/lib/__tests__/repository-root.test.ts` failed on `resolve(undefined, …)`, because `import.meta.dir` is a Bun extension that Vite never populates. That is not a defect to fix in the helper: fifteen call sites across the repository use `import.meta.dir`, and `scripts/lib/repository-root.test.ts` already asserts the throw deliberately. The established answer was a dual-runtime test, so the fix was to adopt it rather than rewrite the subject.
- **The nearest existing pattern still has to clear the local configuration.** That sibling expresses the inapplicable runtime as an early `return`. Copied into `applications/web`, it fails: that workspace sets `expect: { requireAssertions: true }`, under which returning before asserting is a defect rather than a pass. `test.runIf` reports the case as skipped instead. A vacuous pass and a skip occupy the same line in a summary; only one of them is true.

## Reading a tracker's state as evidence

- **An issue reaching Done within seconds of a pull request merge, having skipped In Progress, is an automation close.** TRI-37 was closed three seconds after a documentation-only pull request merged, and its own description said criteria 1 through 6 remained. Its verification command was absent from `package.json`, no route it specified existed, and two of its native blockers were still unstarted. Nothing in the thread recorded a decision. While it sat closed it was falsely unblocking six downstream issues.
- **Confirm the delivery boundary before trusting a status.** The check is mechanical: does the attached pull request contain code, and does the issue's own verification command exist? A `type:decision` issue closed by a documentation pull request is correct; a `type:feature` issue closed the same way is not. Sweeping every recently merged pull request for that signature found exactly one casualty, which is the point of sweeping rather than assuming.

## A shadow has a position, not just a scope

- **Hoisting moves the binding, not the value.** `var require = custom;` makes the name exist for the whole function, but until that line executes the CommonJS wrapper's `require` is still what a call reaches. Verified under Node: before the assignment `typeof require` is `'function'` and the call loads; after it, the replacement wins. So `require('bun:test'); var require = custom;` loads the runner, `var require = require('bun:test');` loads it from its own initializer, and `require('bun:test'); for (var require of loaders) {}` loads it because a `var` loop header assigns on entry. Treating any initialized `var` as a scope-wide shadow suppressed all three.
- **The same fix can reintroduce the bug it fixes, one branch over.** The first version made initialized `var` positional but left the `for...of` / `for...in` branch returning true unconditionally — a fresh false negative of exactly the kind being fixed. Every `var` case is positional; `let` and `const` are not, because an access before them is a temporal-dead-zone `ReferenceError` rather than a load, so suppressing them cannot hide an import.
- **Say what you are deliberately not handling.** Plain reassignment (`require = custom;`) is the remaining member of this family and is not treated as a shadow, because following it needs dataflow analysis and not following it fails toward reporting. Writing that down turns the next review finding into a settled question instead of a new round.

## Check the direction a fix fails in, not just whether it fixes

- **A fix can satisfy a review and invert a security gate's contract.** The Svelte textual fallback runs only for a component the real parser rejected, and its documented contract is to fail _closed_: a false positive on an unreadable file is cheaper than a missed import in a ban. Blanking HTML comment spans to stop a commented-out script being reported quietly inverted that, and the resulting false negative was live — `{'<!--'}` and `{'-->'}` written either side of a real script blank the script itself.
- **A warning recorded in the file counts as evidence.** The comment above the parse call had already named that exact spelling as the anticipated next failure of deriving Svelte's grammar from successive review findings. The masking was that next increment. Reading the surrounding comments before adding a heuristic would have settled it without the round trip.
- **Not every reported premise reproduces.** The finding that prompted the masking described a component needing preprocessing before it would parse; the probe for it parsed fine, and only deliberately malformed components ever reached the fallback. The false positive being fixed was reachable only in already-broken files, while the false negative introduced was reachable in exactly those files. Reproducing the premise, not just the symptom, is what makes that visible.

## Position is not execution

- **Lexical order does not prove control-flow dominance.** Making a `var` shadow positional fixed three false negatives and created a fourth: `if (false) { var require = custom; } require('bun:test')` has the initializer before the call and never executes it. Two successive rounds each replaced one wrong proxy for "has the assignment happened" with another — first scope membership, then source position.
- **When the honest answer needs analysis you are not doing, take the free half.** Suppression now requires the declaration to be a direct statement of a scope enclosing the call, so the two share one statement list and run in order. That is real dominance rather than an approximation of it, and everything nested reports instead. The cost is a genuine false positive on `{ var require = x; } require(...)`, where the bare block does always run — worth naming rather than glossing, because the reason to accept it is that nothing distinguishes it lexically from the conditional case.
- **A guard whose every case is now unreachable should be deleted, not left.** The hoisted-`var` search could only ever match declarations the new rule refuses to trust, so it was removed rather than kept as reassuring dead code.

## Look at the shape of the call, not only its callee

- **`require.call(undefined, 'bun:test')` loads the module, and the specifier is not the first argument.** Every earlier fix treated the callee as the thing to identify, because every earlier evasion left the loader _as_ the callee — parentheses, `as` casts, the comma operator. `Function.prototype.call` and `.apply` make the loader the **receiver** of the invocation method instead, so unwrapping the callee only ever reaches `call`, and the specifier moves to the second argument or inside a literal array.
- **Read only what is statically knowable.** `.apply` with a variable argument array is left alone: guessing would report calls that load something else, and the shape carries no evidence either way.

## Scopes the grammar creates that the tree does not name `Block`

- **A `switch` body is a `CaseBlock`**, and its clauses share one block scope, so `case 'a': const require = x;` binds for every later clause too. A braced `case 'x': { ... }` already worked because that introduces a real `Block`; the bare, far more common spelling had no node the ancestor walk recognised. When enumerating scopes, enumerate the grammar's scopes rather than the node kinds that happen to be named after them.

## State the governing rule once, or keep discovering positions

- **Four rounds each found another place a `var` assignment might not have run**: before the declaration, in its own initializer, before a loop header, inside a dead branch, in a different `switch` clause, in a loop's iterable expression. Each fix was correct and each was a position, not a principle. The rule is now written once, as a rule: a `var` suppresses only when its assignment provably executes before the call, which holds in exactly two shapes — one executed statement sequence with the call after the initializer, or the body of a loop whose header assigns on entry. A finding now has to break the principle rather than name an unlisted position.
- **Sharing a scope is not sharing control flow.** `switch` clauses share one block scope, so a `const` in any clause binds for all of them — but control flow enters at one clause, so a `var` initializer in another need never have run. Flattening the clauses was right for the lexical question and wrong for the temporal one. Same-clause dominance is sound because there is no `goto`: fall-through enters a clause at its top.

## An exclusion list that grows each round is the wrong shape

- **Three rounds added hash-comment languages** — `.py` and `.sh`, then `.ps1` and `.r` — and the tail does not end. Lua settles it: `require('bun:test')` is _valid Lua_ that parses as a JavaScript call, so no comment-based rule would catch it either. The blocklist was replaced with an allowlist of JavaScript and TypeScript extensions, plus extensionless files whose shebang decides.
- **The argument that kept the blocklist was about a hypothetical file.** It defended `bun bin/run-tests.task`; the repository tracks no exotic-but-JavaScript extension at all, while the false positives were live and blocked every commit. Checking the actual inventory turned a stand-off between two plausible principles into a one-command decision.
- **A rule's purpose bounds its acceptable false negatives.** This one bans a runner whose suites silently do not run under vitest — so a file no runner collects cannot be a silently-skipped suite, and skipping unknown extensions costs little by the rule's own measure.

## Following a name means resolving the innermost binding

- **`const load = require; load('bun:test')` is ordinary code, not evasion**, and a name-only check never saw it. But "an enclosing `const load = require` exists" is the wrong question: `{ const load = somethingElse; load(...) }` would then report valid code. The walk stops at the **first** scope binding the name — parameter, function declaration, or variable — and answers only for a `const`.
- **`const` needs no ordering check where `var` does.** It is in its temporal dead zone before the declaration, so a call above it throws rather than loads.
- **Naming a boundary is worthless if the claim about it is wrong — and this one was.** The note said `let` aliases, destructured aliases, and property aliases are not followed "and each fails toward reporting". For `let` that was exactly backwards: `let load = require; load('bun:test')` is ordinary JavaScript that loads the runner, so declining to follow it is a false _negative_. The sentence was self-contradictory on its face — not following an alias cannot make a call more likely to be reported — and it survived because it was written to sound like a considered trade-off rather than checked against a probe. `let` aliases are followed now. A later reassignment is still untracked, which really does fail toward reporting; destructured and property aliases remain unfollowed, which really does not. **Check which way a stated boundary actually fails before writing it down as reassurance.**

## A guard nobody's test distinguishes is not guarded

- **A removal proof that passes is a finding, not a formality.** Flipping the alias resolver's `ignoreOrder` flag left the whole suite green, which meant no test told the two behaviours apart — six tests exercised the resolver and every one of them happened to use a block-scoped binding, where the flag makes no difference. The case that distinguishes them is a hoisted local: `const load = require; function f() { load('bun:test'); var load = other; }`, where `var` hoists through the function so the name refers to the local wherever the call sits. Verified under Node, the call throws `TypeError` rather than loading, so staying silent is correct.
- **Two nearly-identical questions need different answers.** Shadow resolution asks whether an assignment has executed; alias resolution asks only whether a binding exists, because that is what the call names either way. Running one resolver with a flag makes the difference explicit; keeping two partial copies of scope resolution is what produced the loop-header and catch-parameter false positives in the first place.
- **Verify the mutation is in the file before reading an exit code.** One proof this round reported failure from the patch script rather than the test suite, because its anchor did not match and `&&` short-circuited. Every proof now greps for a sentinel before running anything.

## Rules and learnings are part of the change, not a postscript

- **A canonical rule that outlives the code it describes directs the next person to undo the fix.** `.claude/rules/scripts.md` still said to name what is _not_ source so unrecognised files are inspected, after the implementation had been reversed to an allowlist. Both the rule and the earlier learning bullet now record what they originally asserted and why the premise was wrong, rather than being silently rewritten — a reader who finds the old reasoning persuasive needs to see why it lost.
- **Writing a rule is not the same as following it.** This document already said "always pair `timeout` with `killSignal: 'SIGKILL'`", and both Bun fixture runners were then written with `timeout` alone. The rule is now backed by a test that reads those files and fails without the pairing, because prose in a rules file does not fail a build.

## Identify a symbol by where it came from, not what it is called

- **A name check fails in both directions at once.** Recognising Node's loader factory by the literal identifier `createRequire` missed `import { createRequire as makeRequire }`, and accepting any `.createRequire` member reported an unrelated `helpers.createRequire` as a loader. One round shipped both mistakes, because half the check asked about provenance and half asked about spelling. Resolving the import — module specifier plus the _imported_ name rather than the local one — answers both.
- **"Is this name bound?" can be exactly the wrong question.** A first attempt guarded `createRequire` with the shadow check used everywhere else, and both cases went silent: the name is _always_ bound, since it must be imported to be used, and that import is precisely what identifies it. The binding has to be inspected, not counted.

## The same source is a different program under a different extension

- **The positional `var` rule is a CommonJS rule**, and it was being applied to every file. CommonJS supplies `require` as a wrapper _parameter_, so a `var` redeclaration leaves a live loader until its assignment runs. An ES module has no wrapper, so the hoisted `var` is `undefined` from the start and the call throws instead of loading — the same source reports correctly as `.cjs` and was a false positive as `.mjs`.
- **Only unambiguous extensions get the ESM reading.** `.ts` and `.js` depend on the nearest `package.json` `type`, which this validator does not read, so they keep the CommonJS reading — the one that reports. Naming the ambiguity in the code is what stops the next reader from "fixing" it.
- **A hashbang is a valid JavaScript comment.** Skipping any file whose shebang names a foreign interpreter was right for extensionless paths, where the shebang is the only evidence, and wrong once the extension already settles the language: `probe.test.mjs` beginning `#!/bin/sh` is still JavaScript that Bun runs and vitest collects. A filter written for one lane had been applied to every lane.

## Check which way a boundary fails before writing it down as reassurance

- **A stated limitation was backwards, and read as considered because it was phrased that way.** The note "`let` aliases … are not followed, and each fails toward reporting" is self-contradictory on its face — declining to follow an alias cannot make a call _more_ likely to be reported — and it was wrong in the direction that matters: `let load = require; load('bun:test')` loads the runner, so refusing to follow it is a false negative. It survived several rounds because it was written to sound like a trade-off rather than checked against a probe.
- **Mutability was the wrong criterion.** Following only `const` protected against a reassignment that could invalidate the alias, at the cost of missing every mutable one. Reassignment is still untracked — which genuinely does fail toward reporting — while the alias itself is now followed however it was declared.

## A traversal only sees what the traversal visits

- **`ts.forEachChild` does not descend into JSDoc.** So `/** @import { test } from 'bun:test' */` — TypeScript's supported syntax for what `import type` expresses, and the natural spelling in a plain `.js` file — was not merely unhandled by a missing visitor branch; no branch could have reached it. The tags have to be asked for with `getJSDocTags`, and only on nodes that own one, which keeps it off the hot path.
- **A loop header that always runs is not the same as one that might not.** `for (var require = custom; false; ) {}` never enters its body, but the initializer has already executed and its `var` outlives the loop — so treating every loop uniformly reported valid code. Classic-`for` initializers execute exactly once, before the condition is first tested; `for…of` and `for…in` headers assign on entry. Both are knowable statically, and neither is the same rule.

## Do not merge on the first green reading

- **Four findings landed in the four minutes between two readings.** A settle window after the checks went terminal reported zero unresolved threads; a re-fetch before merging reported four. The rule that a first green reading is not merge authority is not a formality — this pull request would have merged with four unaddressed findings, two of them P1.

## Ask the runtime which declarations emit a value

- **`enum` and `const enum` differ, and the difference decides the answer.** Verified under Bun: a plain `enum require { A }` makes `typeof require` `'object'` — a real binding that shadows — while a `const enum` inlines its members and leaves `typeof` as `'undefined'`, so it binds nothing and a call still reaches the loader. Treating both as declarations would have suppressed a genuine finding; treating neither reported valid code. Running the two-line probe cost less than reasoning about emit semantics.
- **A namespace is a value declaration when it has a body.** `namespace module { export function require(...) {} }` emits an object holding its value members, so it shadows; an ambient one is erased and does not. The same body-versus-signature distinction as a bodyless function overload, one node kind over.

## The same import has several syntaxes, and one of them is not a call

- **`import M = require('node:module')` is TypeScript syntax, not a call expression.** Its `ExternalModuleReference` holds the specifier directly, so code written to unwrap a `CallExpression` finds nothing there — the first version of this fix handled `const M = require(...)` correctly and silently missed the `import =` form beside it. `const M = require(...)` really is a call, and its callee still has to be verified as a loader, which the probe `const M = load('node:module')` pins.

## Verify the case, not a case that resembles it

- **The evidence was real and about the wrong thing.** A round established that a plain `enum` emits a runtime object by checking `typeof E`, and concluded that `enum require { A }` therefore shadows the loader. It does not. TypeScript emits `(function (X) { … })(X || (X = {}))`, so the declaration **merges** with an existing binding — and in CommonJS `require` is already a truthy wrapper parameter, so the enum augments the loader and the call still loads. The probe used a different name than the case, which is exactly where it stopped being evidence:

  ```
  .cts  typeof require after enum: function   STILL LOADS
  .mts  typeof require after enum: object     throws TypeError
  ```

- **The correction lands on a rule that already existed.** Enums and namespaces shadow only where there is nothing to merge with, which is the same module-format split the `var` rule needed, for the same reason: CommonJS supplies a live binding that survives, an ES module does not. Ambiguous extensions keep the reading that reports.

## A test routed around the code under test pins nothing

- **A removal proof passed because the test never reached the changed function.** Reordering `isScannableFile` so a recognised extension outranks a basename heuristic left the suite green, because the test exercised `findBannedImportsForPath` — which never consults `isScannableFile`. The candidate filter is what decides whether a path is read at all, so asserting through a different entry point proved only that the other entry point still worked.
- **Non-language heuristics keep outranking the language.** First a foreign shebang skipped a `.mjs` file, then a recipe-like basename skipped `runner/Dockerfile.test.mjs` — a file `runner/vitest.config.mjs` really does collect as a suite. Both heuristics exist for files whose format nothing else names; both were being consulted before the extension that already named it.

## Source order is only evidence inside one function body

- **A hoisted function can run before an assignment written above its call site.** `invoke(); var require = custom; function invoke() { require('bun:test'); }` reaches the real loader, because `invoke` is hoisted and runs first — while the call node sits textually _below_ the assignment. Every positional comparison this validator makes had been treating AST order as execution order, which holds within one function body and holds nowhere else. The comparison is now refused when the call and the declaration live in different functions, which over-reports the common case where the function is called afterwards; that is the safe direction and it is stated as a choice.

## Merging is not all-or-nothing

- **A namespace merged onto the CommonJS wrapper leaves `module.require` intact only when it exports something else.** Exporting `require` assigns that property, and the call then invokes the namespace's own function — verified under Bun, where `module.require('node:path')` returns it. The previous round's correction ("a namespace never shadows in CommonJS") was right about the general case and wrong about the one that matters, which is the mirror of the mistake it was fixing.
- **Ask the question the caller is actually asking.** The namespace check walks scopes itself rather than going through `innermostBinding`, because that function deliberately reports a CommonJS namespace as _not_ binding the name `module` — the right answer for shadowing and the wrong one for "does this rewrite `module.require`".

## A local environment can hide a finding

- **A probe came back clean because of a personal global gitignore.** `.envrc` was reported as a false positive; the probe did not reproduce it, because `~/.gitignore` excludes `.envrc` and the collector enumerates through git. Calling `isScannableFile('.envrc')` directly showed the defect immediately. When a probe disagrees with a finding, check whether the probe reached the code at all before concluding the finding is wrong.
- **A lone leading-dot name is a named format, not an extensionless one.** `.envrc`, `.babelrc`, and `.bashrc` announce what they are; treating them as extensionless entrypoints handed hash-commented files to the TypeScript parser. `.eslintrc.js` still scans, because its second dot names a real extension.

## When a fix generates its own findings, question the fix

- **Four rounds on one construct, and the answer was to delete it.** A `namespace module` re-exporting `require` was reported as a false positive; suppressing it produced, in the very next round, two false _negatives_ — the suppression was scope-wide, so it also silenced calls written above the namespace, and it recognised only functions and variables, so an exported class still reported. A feature added to prevent one false positive on code nobody writes had inverted the gate's failure direction, and its remaining tail ran on through getters and `declare global` merges.
- **Sweeping the class means asking whether the fix belongs, not only whether it is complete.** Each round swept a class _of the previous round's fix_. The class-level answer was that a CommonJS namespace should never suppress `module.require` at all: the cost is a false positive on a construct that is not written by accident, and this validator is a lint against accidents. Doing it properly needs emit-order reasoning — the position of a generated initializer against the call — which is the same analysis refused for hoisted function invocations one rule over.
- **Three dispositions of one assertion deserve the whole history in the test.** Round 21 said namespaces shadow; round 23 said they shadow when they export `require`; round 24 says they never do. A reader arriving at any one of those needs to know why the other two lost.

## Markup is executable

- **Reading only `<script>` blocks missed a category, not an edge.** `{#await import('bun:test') then suite}` and an event handler calling `require(...)` are real loads that live in neither script block. The template AST holds ESTree nodes with source offsets, so each call can be handed to the existing detector as text and every rule already written applies to it unchanged.
- **Collect by what a node _is_, not by enumerating the container grammar.** Only `import(...)` and `require(...)` are gathered — the sole banned shapes reachable from markup, since a static import declaration cannot appear there. Enumerating Svelte's node kinds is precisely the enumeration this module has repeatedly got wrong, and matching on the call itself sidesteps it.
- **Name the residual.** The regex fallback for components the parser rejects still reads `<script>` blocks only, so a template-expression import in a malformed component stays invisible. Recovering it would need the grammar that fallback exists because it could not use; that limit is now written where someone will find it rather than rediscover it.

## Analyse the program, not fragments of it

- **Handing each call to the detector on its own strips it of the bindings that give it meaning.** A Svelte component with `const runner = 'bun:test'` in its instance script and `{#await import(runner)}` in markup was analysed as two disconnected texts, so the alias had no declaration to resolve. Composing both scripts and every markup expression into one source restores every rule already written — shadowing, aliases, `createRequire`, constant folding — instead of re-implementing them per region.
- **Compose by masking, not by concatenating.** Everything outside a code region becomes a space and newlines are kept, so byte offsets never move: line numbers need no mapping back and cannot drift. The composed version is also shorter than the per-region loop it replaced.

## An exception is scoped to the thing it excepts

- **The CommonJS merge rule is about the wrapper, so it only applies where the wrapper binding is.** Inside a nested function there is no wrapper parameter to merge with, so `function f() { enum require { A }; require('bun:test'); }` really does shadow — verified under Bun, where `typeof require` is `object` inside the function and `function` at the top level. The exception had been written as a property of the _file_ when it is a property of the _scope_.

## One binding can have several initializers

- **`var` allows the same name to be declared more than once, with separately ordered assignments.** `var load = require; load('bun:test'); var load = custom;` shares one binding; taking the innermost declaration returned the _last_ one and hid a loader that was active at the call. Every initializer of the name is now considered and any match is a match — which fails toward reporting, and avoids the "which assignment is live here" analysis refused everywhere else in this file.

## Two indexes into the same string are not the same index

- **`[...contents]` iterates code points; Svelte's `start`/`end` count UTF-16 code units.** One astral character before a region shifted every later offset by one, so the mask clipped the first character off the executable text — `import` became `mport` and the import vanished. A masking scheme chosen _because_ it preserves offsets was silently not preserving them. Index by `charAt` over `contents.length` when the offsets come from a UTF-16 producer.

## An `if` before an `else if` swallows the chain

- **A branch added at the top of an if/else chain made every later branch its alternate.** The JSDoc check was inserted as `if (...) { ... }` directly above `else if (ts.isImportTypeNode(node))`, so any node that merely _owned_ a documentation comment skipped the remaining branches: `/** ... */ import suite = require('bun:test')` went unreported purely because it was documented. Adding a statement to a chain is not the same as adding a link to it, and the compiler is content either way.

## An exception is scoped to what actually survives

- **Only `var` outlives a loop.** The classic-`for` initializer rule hoisted every header declaration into the enclosing scope, but a `let` or `const` binding ceases to exist at the closing brace, so a call after the loop still reaches the loader. The rule was written for `var` semantics and then applied to all three declaration kinds — the same shape of error as applying the CommonJS merge exception to nested scopes.

## Composing half a program is not composing it

- **Template _declarations_ belong in the composed source, not only template calls.** `{@const runner = 'bun:test'}` defines a binding a markup call uses; keeping only call ranges masked the definition, so the composed program held the alias and not its declaration — the precise problem composition was introduced to fix, one scope further in. When the fix is "analyse it as one program", every part that binds a name has to be in it.

## A value arrives by more routes than a declaration

- **`let load; load = require;` splits declaration from initialization**, so a resolver that reads only declaration initializers found nothing and reported nothing. A classic-`for` header is a third route: its `var` initializer always runs and outlives the loop, so it is one of the assignments the binding receives. All of them are gathered and any match is a match — the same fail-toward-reporting rule already used for redeclared `var`, extended rather than duplicated.
- **A stated boundary can be wrong about its own failure direction — again.** The scope note posted on the pull request said unmodelled reassignment fails toward reporting. For a deferred _initializing_ assignment it failed toward silence, which is the second time a boundary claim has been backwards in the direction that matters. Claims about which way something fails need the same probe as the behaviour itself.

## Match the token, not the line

- **`#!/bin/sh # invoke node below` is a shell script.** Searching the whole shebang line for `node`, `bun`, or `deno` classified it as JavaScript, and the recovery parser then turned its ordinary hash comments into imports — blocking every commit containing the file. The interpreter is a token in a known position: the command after `#!`, or the first non-option argument when that command is `env`. Parsing it is barely more code than the regex and cannot be fooled by a comment.

## A guard's CI step needs its own guard

- **Enforcement that lives in one workflow step can be removed by deleting that step.** The repository already had an invariant asserting that each workflow-security command stays wired into `ci.yml`, precisely so a check cannot be switched off by editing the workflow — and the new validator step was not on that list. Adding it there is the difference between a guard and a guard that happens to be running. Verified by deleting the step: `audit:workflows` exits 1 with it gone and 0 with it present.

## Two resolvers cannot share a rule

- **The same rule written twice is the drift engine, not the bug.** The specifier resolver and the loader resolver each carried their own copy of "a value can come from either branch". When the ternary case was reported it went into both copies by hand — and `||`, `&&`, and `??` make exactly the same choice, so they went into neither. Three separate findings on one branch trace to that duplication: an `isCreateRequire` source check that took an identifier the member path already resolved, a `text === 'module'` shortcut that pre-empted the resolver written for that case, and this one. The fix each time was deleting the second path, not extending it. When a finding says "this route handles X but that route does not", the defect is that there are two routes.

## The filter in front of a guard is part of the guard

- **A cheap pre-filter can be the entire hole.** The subprocess-deadline invariant parsed carefully and inspected each call individually, and none of that ran for a file selected by `text.includes('spawnSync')` — a module that re-exports the spawner under another name leaves its caller mentioning the spawner nowhere. Every fix to the parser was invisible to the files the filter dropped. A guard's enumeration deserves the same adversarial reading as its logic, and "which inputs never reach this code" is the question that finds it.
- **Two spawners, two signatures.** Node's is `spawnSync(command, args, options)` and Bun's is `Bun.spawnSync(command, options)`. Reading argument index 2 unconditionally meant the guard never inspected this repository's own spawner, which is the file the invariant was written to protect. A check can be green because it is looking in the wrong place.

## Scraping output for pass/fail fails in ways you will then misdiagnose

- **The wait script guarding the merge gate broke the first rule this repository operates by.** It decided whether CI was still running by counting lines matching `^[^\t]+\t(pending|in_progress|queued)` in `gh pr checks` output. It read zero while a check was plainly pending, declared the run terminal, and took a merge-gate reading five minutes early. `gh pr checks` documents exit code 8 for pending, 0 for all-pass, 1 for a terminal failure, and `--json name,bucket` returns the state as data. Either is unambiguous, and neither depends on how a table happens to be rendered.
- **Two confident diagnoses of that failure were both wrong, and the first "confirmation" was a non-discriminating test.** The theory was that BSD's ERE treats `\t` inside `[^\t]` as the literal characters `\` and `t`, so every check name containing a lowercase `t` escaped the filter — a theory that fit the evidence exactly, since the only two rows the filter did remove, `Build` and `Type Check`, are the only two names with no lowercase `t`. The verifying command used `Coverage Gates`, which _also_ contains a lowercase `t` and therefore could not tell the two theories apart; it matched, and that was reported as confirmation. Re-run against `Build` and `Type Check` the pattern matches too, and against real output the filter works. A test that cannot fail if the hypothesis is false confirms nothing, and a hypothesis that explains the evidence perfectly is not thereby established.
- **The fix did not depend on the diagnosis.** The root cause of the original misread is still unestablished — it reproduces only against a pending check, and the state has since gone terminal. That does not block the correct change, because scraping was the wrong mechanism whether or not the pattern was also wrong. When the remedy is sound for reasons independent of the root cause, ship it and say the cause is unknown rather than shipping a story about it.

## Hoisting a range hoists a scope

- **Flattening the template into one program flattened its scopes.** Retaining a `{@const}` as a top-level range put a block-local binding where markup outside the block could see it, and because the resolver deliberately prefers a banned value, a valid component was rejected by an always-on hook. A declaration is retained only when a call inside its own block reads it — the test the each-block binding already applied, for the same reason and one node kind later. Composition that preserves offsets does not preserve lexical extent, and the second is what a resolver reads.

## A declined case still needs a probe, and an honest one

- **The boundary of a resolver is a decision or it is an oversight, and only a test tells them apart.** The member reader resolves object literals, names bound to them, and class property initializers; it declines constructor side effects, factory returns, `Object.assign`, and non-foldable keys. Each declined shape has a probe asserting silence, so a later widening has to confront them deliberately.
- **Do not file a true negative under the same heading as a safe one.** `{ get load() { return require } }` really does make `h.load` the loader, so that silence is a genuine miss, not a safe decline — grouping it with the harmless cases would have made the test read as proof of correctness. It is declined because resolving it means reading a function body for its return value, at which point `function make() { return require }` is the same question and a far larger surface. That is a change to make on its own evidence, and the test says so in those words.

## Probe the surface a fix opens, in the round that opens it

- **A new resolver arrives with its own shape space, and eleven of its holes were findable the same hour it landed.** The member reader added for `holder.load` and `modules.tests` did not resolve a _nested_ receiver (`container.holder.load`), a spread into the object it reads (`{ ...base }`), or a static property (`C.load`). The subprocess guard's options reader, extended for spreads in the same commit, still called `{ timeout, killSignal }` unbounded when the signal was written in shorthand or held in a name — a **false positive**, which fails the suite over correct source and is the failure that teaches people to route around a guard. None of these came from review; they came from asking, of the helper just written, what else is in its class. Adding a resolver and probing only the shape that prompted it is how a single finding becomes four rounds.
- **The any-match rule belongs to branches, not to overrides.** `useBun ? require : other` is a control-flow question this module declines, so either operand counts. `{ ...base, load: other }` is not: the override is deterministic and statically visible, so the value is `other` and preferring the banned one would report a loader the code never holds. Two rules that look alike, applied to the same data structure, distinguished by whether the unknown is control flow. Both directions are tested.

## Documented exit codes are a hypothesis until you watch them

- **Neither spelling of `gh pr checks` reports pending through its exit code, and the documentation says otherwise.** The plain form is documented as 8-for-pending, 0-for-all-pass, 1-for-terminal-failure; observed against this repository it returned **1 while seven checks were pending**. The `--json` form returns **0 while pending**, because the payload is the answer there. Two successive rewrites of the merge-gate wait script were built on the documented codes and both exited the poll loop early — the second one after the first had already been called out for scraping text instead of reading status. The working version counts rows whose `bucket` is `pending` and treats an empty response as pending, since the check suite for a just-pushed commit does not exist yet.
- **"Read status as data, not text" is not the same as "read the exit code".** The original rule was right and the first two fixes obeyed its letter while missing it: an exit code is a status _summary_, and a summary can be wrong about a mixed state in ways a per-row field cannot. When several things are in flight and any one of them gates the decision, poll the rows.
- **`gh api --paginate --jq` applies the filter to each page separately.** A filter written as `if length == 0 then "(none)" else … end` printed "(none)" for the first page and the findings for the second, which reads at a glance like a contradiction. Put the emptiness check outside the pagination, or accept that the marker is per-page.

## Ask the same question from both ends

- **A resolver that folds a key on the read side and not on the write side is one bug, not two.** `h['load']` and `h[0]` were folded; `{ ['load']: … }`, `{ 'load': … }`, and `{ 0: … }` were not, because the property-name match tested only for an identifier. Reading a key and writing one are the same question asked from opposite ends, and answering it in one direction is the asymmetry this file has now been corrected for in four separate shapes. The same applies to the boundary: the access side declines `h[key]` when `key` does not fold, so the declaration side declines `{ [key]: … }` for the same reason and with the same test.
- **`Object.freeze` is a wrapper, not a producer.** It returns the object handed to it, and freezing a holder is how one is idiomatically written — so it belongs with the parenthesis and the `as const` in `unwrapTransparent`, where the loader position, the specifier position, and the receiver of a member read all get it at once. Adding it to any single resolver would have fixed a third of it. `Object.assign` stays out on purpose: it merges into a target and genuinely is a different value.
- **Four self-audit passes found twenty-nine gaps and the fourth was not the smallest.** Passes found seven, eleven, five, and six. The count is not decaying the way "diminishing returns" would predict, because each fix opens its own shape space: the member reader created the nested-receiver, spread, static-property, inheritance, and computed-key questions, none of which existed before it. The honest read is that the space is large rather than nearly exhausted, and the convergence signal to wait for is a pass that finds only shapes already declined and documented — not a pass that finds fewer.
