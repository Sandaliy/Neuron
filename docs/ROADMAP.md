# Neuron Product & Engineering Roadmap

## 1. Product north star

Neuron should make a large body of learning material feel finite, useful, and compatible with ordinary
life. A learner chooses how much time is available. The application uses evidence-based scheduling,
measured answer speed, and future-load forecasting to decide what fits. Returning after an absence should
produce a recovery plan, not a wall of overdue cards.

Vocabulary is the first proving ground, with English and German as the initial language priorities. The
same note-and-card model should also handle definitions, theory, formulas, dates, and contextual sentence
tasks. Material should move from an arbitrary source into clear notes, then into one or more study cards,
then through independent schedules without losing its history.

The intended experience is fast on a phone, understandable without studying a manual, reliable without a
network, and consistent across devices. Defaults should solve the common case. Deeper control should exist
when it earns its place, but the interface should not reproduce Anki's configuration burden.

## 2. Product principles

- **Mobile-first learning.** Core study and capture flows must work comfortably in transport, with one
  hand, a small screen, safe-area constraints, and an on-screen keyboard.
- **Fast local interaction.** Reveals, grades, navigation, and edits should respond locally. Network work
  must not make a study session feel remote.
- **Predictable workload.** Users choose minutes. New material enters only when its forecast cost fits.
- **Evidence-based scheduling.** FSRS remains the memory model unless real evidence supports a change.
  Product policy may shape workload without pretending to improve memory mathematics.
- **Graceful backlog recovery.** Absences pause new material and produce a bounded plan. Existing progress
  is not reset as punishment for returning.
- **Offline-first direction.** The browser should eventually hold the working collection and an outbound
  change queue, then synchronize safely when the network returns.
- **Reliable synchronization.** IDs, revisions, immutable reviews, replay, and conflict records must
  preserve facts and learning history across devices.
- **Strong data integrity.** User context, RLS, strict validation, append-only reviews, soft deletion, and
  transactional projections are product requirements.
- **Strong defaults without configuration overload.** Common study modes and progressive card directions
  should work without setup. Advanced controls should stay out of the main path.
- **Accessible and calm UX.** Both themes, keyboard access, visible focus, clear recovery text, reduced
  motion, and non-color cues are part of completion.
- **Performance is behavior.** Large decks, long lists, glass, and motion must stay within measured phone
  budgets. Visual effects yield when they make interaction worse.
- **Clean product language.** A deck is also a folder, a note is a fact, and a card is one way to test it.
  Terms should remain stable in English and Russian.
- **Extensibility without premature complexity.** Preserve boundaries that are costly to retrofit. Do not
  build billing, enterprise, collaboration, or speculative scale systems before they are needed.

## 3. Completed foundation

- **Repository and deployment foundation:** a pnpm/Turborepo monorepo, shared configuration, protected
  pull-request delivery, CI gates, two Vercel applications, and isolated preview data.
- **Learning core:** a pure deterministic FSRS-6 implementation, replay, local-day handling, seeded date
  placement, property and differential checks, and a simulation harness.
- **Workload policy:** measured answer time, forward forecast, time budgets, new-card admission, nearby-day
  balancing, backlog detection, recovery plans, and session assembly.
- **Data and API:** Neon Postgres, Drizzle migrations, user-bound repositories, RLS, immutable reviews,
  revision-based synchronization, and shared Zod wire contracts.
- **Account security:** email/password sessions, account recovery codes, optional TOTP, delayed erasure,
  database-backed rate limiting, and tested seams for later mail delivery.
- **Application shell:** authentication and recovery screens, Today, Library, settings, two languages,
  themes, and same-origin API access.
- **Visual system:** semantic tokens, reusable components, centered dialogs, phone viewport handling,
  reduced motion, adaptive glass, a component gallery, and visual regression infrastructure.

## 4. Current milestone: Phase 6

Phase 6 makes the collection writable and gives users a safe path from raw material to validated notes and
cards. It is the prerequisite for studying real personal vocabulary rather than seeded examples.

The completed portion on the active branch includes writable deck operations, inherited language and
level settings, schemas and conditional editors for three note types, shared card planning, note browse and
bulk APIs, a virtualized note list, chunked imports, format parsing, preview warnings, duplicate lookup,
import batches and undo, and the canonical card-generation prompt flow.

The unfinished portion includes list performance, complete phone/desktop browser coverage, screenshot
baselines, direct keyboard checks, and several behavior gaps found during reconciliation: source filtering
is not exposed in the list, row summaries omit card state, duplicate choices are global rather than per row,
merge does not yet fill only empty fields, note-type changes from the editor normally fail strict field
validation, full card-direction controls are absent, and deleted decks/notes lack a working restore path in
the UI.

Phase 6 is complete when the original note/import acceptance flows work with real material, all destructive
or history-affecting actions tell the truth, a 5,000-note list meets the 55 fps budget, large imports recover
from interrupted requests without duplicate rows, note and import screens pass browser and visual checks at
375 px and 1440 px in both themes, the on-screen keyboard does not hide the active control, all repository
gates pass, and the milestone is delivered through a pull request.

## 5. Remaining committed roadmap

### Milestone 7: Daily study

**Purpose**

Turn the scheduling, workload, data, and interface foundations into the first complete learning loop.

**Core deliverables**

- Build the study session screen and card reveal flow.
- Record Again, Hard, Good, and Easy with immediate local feedback and server verification.
- Show honest next intervals and allow a recent answer to be undone without rewriting review history.
- Support a small set of useful presets such as recognition, recall, typed production, context, course,
  listening where content permits it, and a cram mode that does not alter the schedule.
- Implement typed-answer normalization and feedback for case, whitespace, accepted variants, small typos,
  and language-specific rules.
- Add keyboard shortcuts, touch gestures where they remain discoverable, and speech synthesis with clear
  fallback behavior.
- Assemble sessions from the workload manager, including related-card separation, difficulty spacing,
  review priority, and whole-card budget completion.

**Dependencies**

Phase 6 must provide reliable real notes and cards. Review APIs, study presets, FSRS, and session assembly
already exist as foundations.

**Non-goals**

Offline synchronization, a full statistics area, automatic large-list triage, custom note types, and paid
content are outside this milestone.

**Definition of done**

A learner can open a real deck, complete a time-bounded session on phone or desktop, leave and return, and
see schedules and review history remain correct. All response modes used by the milestone have unit,
integration, keyboard, browser, and visual coverage.

**Risks / decisions intentionally deferred until implementation**

The exact preset set, gesture vocabulary, browser speech quality, typed-answer tolerance, and undo event
model require focused design and tests. They should not be frozen from historical planning text.

### Milestone 8: Offline collection and synchronization

**Purpose**

Make mobile study dependable without a connection and reconcile work across devices when connectivity
returns.

**Core deliverables**

- Store the working collection, schedules, settings needed for study, and sync cursor in IndexedDB.
- Cache the application shell and required static assets with a service worker.
- Queue local creations, edits, deletes, and reviews with stable IDs.
- Pull and push revisioned changes in bounded batches, preserving transaction boundaries.
- Replay merged review logs deterministically and surface resync when server and client projections differ.
- Show clear online, offline, pending, retrying, conflict, and authentication-expired states.
- Install cleanly as a PWA and recover from browser storage loss without losing server data.

**Dependencies**

The daily study flow and Phase 6 collection operations must have stable wire contracts. Existing sync APIs,
client-generated IDs, immutable reviews, and replay are the starting point.

**Non-goals**

General-purpose CRDTs, real-time collaboration, background behavior unsupported by the platform, and a
desktop-native application are not required.

**Definition of done**

A learner can install Neuron, start with a synchronized collection, study and edit with networking off,
restart the application, sign in again if required, reconnect, and reach the same correct state on a second
device without duplicated reviews or missing notes.

**Risks / decisions intentionally deferred until implementation**

IndexedDB schema evolution, service-worker update policy, queue compaction, conflict UX, browser storage
eviction, and long-offline session expiry need prototypes and failure testing before their final shape is
chosen.

### Milestone 9: Large collection workflow

**Purpose**

Make sources such as Oxford 3000/5000, TOEFL vocabulary, professional terminology, and large theory sets
manageable after import.

**Core deliverables**

- Add a fast triage sweep for Known, Unsure, and New decisions.
- Admit new material in visible finite waves ordered by rank or source order.
- Release additional card directions progressively from demonstrated stability and deck policy.
- Explain when new material is paused and when capacity is likely to return.
- Build a problem-card review area from lapse history, with editing, mnemonic/context improvements, splitting,
  and temporary suspension.
- Preserve a useful manual alternative for every automated decision.

**Dependencies**

Real imports, the study loop, measured answer times, stable offline synchronization, and enough review
history to make progression meaningful.

**Non-goals**

Claiming a language level from a small sample, generating frequency ranks without a trusted source,
automatically deleting difficult material, or exposing every scheduler parameter.

**Definition of done**

A learner can import a multi-thousand-item source, remove already-known material quickly, see a finite next
wave, study within the time budget, gain harder directions gradually, and repair problem cards without
losing history.

**Risks / decisions intentionally deferred until implementation**

Wave size and completion thresholds, handling Unsure cards, the evidence required for a new direction, and
problem-card thresholds need simulation plus user testing. Historical numbers are hypotheses, not contracts.

### Milestone 10: Progress and workload insight

**Purpose**

Help learners understand what they retain, what their plan costs, and whether the workload policy is doing
what it promised, without turning study into gamified clutter.

**Core deliverables**

- Show recent study time, review volume, new material admitted, and actual retention.
- Show the useful part of the forward workload forecast with clear uncertainty.
- Explain backlog recovery progress and expected return to normal work.
- Show progress by deck, source, wave, note type, and card direction where the data supports it.
- Provide card-history views useful for understanding and repairing a specific problem.
- Keep derived statistics reproducible from immutable review data.

**Dependencies**

The daily study loop, offline synchronization, large-collection policy, and enough real usage data.

**Non-goals**

Leaderboards, social comparison, manipulative streak pressure, decorative dashboards, and claims of learning
effectiveness unsupported by observed data.

**Definition of done**

The main progress views answer practical questions about workload, retention, and collection advancement,
remain readable on a phone, explain incomplete data, and reconcile with the review log and forecast code.

**Risks / decisions intentionally deferred until implementation**

The minimum sample for trustworthy retention, how much forecast detail helps rather than alarms, and which
statistics deserve the home screen should be decided from real use.

### Milestone 11: Product readiness and public presentation

**Purpose**

Close cross-cutting gaps after the full personal learning loop exists, then present the project credibly to
users and technical reviewers.

**Core deliverables**

- Complete an accessibility and performance pass over all shipped flows.
- Configure a real mail sender, enable email verification and link-based password reset, and remove temporary
  registration guards that are no longer needed.
- Add user data export and finish the product and operational surfaces around the existing account deletion
  lifecycle.
- Finish conflict recovery UX and operational cleanup scheduling.
- Resolve relevant dependency alerts and add measured code splitting where it improves startup.
- Review API/database region placement and preview-database automation from observed needs.
- Refresh public README material, screenshots, architecture/algorithm explanations, and operator guidance.
- Validate production health and recovery procedures.

**Dependencies**

The study, offline, large-collection, and progress milestones must be stable enough that a finishing pass is
not polishing a moving target.

**Non-goals**

Billing, enterprise administration, speculative multi-region architecture, a public deck marketplace, or a
marketing program.

**Definition of done**

The complete personal product works on supported phone and desktop browsers, handles expected failure
states, meets documented accessibility and performance budgets, protects and exports user data, deploys
through repeatable checks, and has public documentation that matches the application.

**Risks / decisions intentionally deferred until implementation**

Mail provider, production region, per-pull-request database automation, supported browser floor, and public
launch scope should be selected from current costs and actual users at that time.

## 6. Product backlog outside the committed roadmap

### Learning experience

- Better onboarding around time budgets and target retention.
- Placement sampling when a source contains trustworthy frequency ranks.
- Exam-specific review without corrupting the long-term schedule.
- Custom note types only if the three built-in types fail real material.
- Personal FSRS parameter fitting after enough review history exists.

### Study modes

- Multiple choice or letter assembly for narrow beginner use cases.
- Better listening tasks and offline voice selection.
- User-supplied images or audio when browser speech and text are insufficient.
- Advanced preset composition kept behind simple defaults.

### Card generation and assisted authoring

- Optional in-app generation using a user-supplied provider key.
- Targeted actions such as add an example, improve a mnemonic, or compare near-synonyms.
- Direct `.apkg` import after the stable text/JSON paths are proven.
- Quality evaluation of generated examples and grammar against real lessons.

### Statistics and progress

- Cohort-style comparisons only against the learner's own history.
- Exportable reports for study planning.
- Better explanations of forecast uncertainty and direction-specific skill growth.

### Quick capture and Telegram helper

A Telegram helper may later capture words and send reminders. It is an optional companion, not the primary
platform. Captured material should enter as a draft and use the same validation and card-planning rules as
manual and imported notes.

### Sharing and collaboration

- Share a deck with a friend by link.
- Preserve author/version provenance if subscribed decks are ever added.
- Avoid feeds, social scoring, group administration, and marketplace work until there is demand.

### Portfolio and public-product readiness

- Focused technical write-ups of replay, RLS, workload simulation, and offline failure handling.
- Reproducible demos and screenshots tied to shipped behavior.
- Operational evidence that CI, previews, migrations, and production checks work as documented.

### Future commercial possibilities

- Paid hosting or migration away from non-commercial hosting terms if revenue exists.
- Usage accounting, limits, and billing only after a product decision requires them.
- A deck catalogue, managed generation, or team features only after observed demand.

## 7. Future-commercialisation boundary

Engineering worth doing now protects user data and keeps future choices open: portable core logic,
standards-based Postgres, clear application/package boundaries, tenant isolation, exportable data,
deterministic synchronization, platform-independent API logic, migration discipline, and explicit ownership
of authored material.

Engineering not worth doing now includes Stripe integration, pricing pages, trials, referrals, enterprise
roles, organization tenancy, audit products, a marketplace, usage metering without a real limit, speculative
multi-region replication, and infrastructure designed for traffic the product does not have. A possible
future business is a constraint on avoiding traps, not permission to build an imaginary business today.

## 8. Roadmap maintenance policy

This order is a working commitment, not an excuse to ignore evidence. A milestone may move when tests
invalidate an assumption, user testing exposes a blocking UX problem, implementation reveals a prerequisite,
or the architecture makes another order clearly safer.

When direction changes, update this roadmap and `docs/STATE.md` in the same unit of work. Historical phase
files may preserve earlier intent, but they must not remain discoverable as if they were current truth.
