# Algorithm

Written as the scheduler is built. This entry covers the memory model. The load
manager, which decides how much of the due work you actually see on a given day,
comes next.

## FSRS-6

Neuron schedules with FSRS-6, the sixth version of the Free Spaced Repetition
Scheduler. It is a statistical model of forgetting, fitted on a public dataset of
several hundred million reviews. Nothing about it is invented here. The
implementation lives in `packages/core/src/fsrs` and is written from two sources,
both read on 2026-08-07:

- [The Algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm),
  the wiki of `open-spaced-repetition/awesome-fsrs`, which gives the equations.
- [ts-fsrs 5.4.1](https://github.com/open-spaced-repetition/ts-fsrs), which
  reports itself as `v5.4.1 using FSRS-6.0` and pins down what the equations
  leave open: where results are rounded, where they are clamped, and in which
  order the four buttons are separated.

FSRS-7 exists but is a research branch, so it is not used.

## Three numbers

Every card carries three values. Two are stored, one is computed on demand.

**Stability**, in days, is how long it takes for the chance of recalling the card
to fall to 90%. A stability of 30 means that in a month from the last answer you
have about a nine in ten chance of getting it right. Stability only grows on a
correct answer and only shrinks on a wrong one.

**Difficulty**, from 1 to 10, is how hard this card is for this person. It is not
a property of the word. The same word is difficulty 2 for one learner and 8 for
another. Difficulty controls how much a correct answer is worth: a difficult card
gains less stability from the same answer than an easy one.

**Retrievability** is the chance of recalling the card right now. It is not
stored. It falls from 1 on the day of the answer, following

```
R(t, S) = (1 + FACTOR * t / S) ^ DECAY
```

where `t` is the days since the last answer, `DECAY` is one of the 21 trained
weights, and `FACTOR` is whatever makes the curve pass through 0.9 at `t = S`.
That is the definition of stability, so the factor follows from the decay rather
than being fitted separately.

The curve is a power curve, not an exponential one, and this matters more than it
sounds. It has a long tail. With the fitted decay, recall reaches a coin flip only
after roughly ninety times the card's stability has passed. A card worth six
months does not evaporate over a summer. This is the reason a break in study does
not destroy progress in Neuron, and the reason no card is ever reset to the start.

## What an answer does

Four things happen when a card is answered.

**Retrievability is computed first**, from the stability the card had and the days
that passed. Everything else reads it.

**Difficulty moves.** The answer pushes it up or down by a fixed weight per step
away from Good. That push is damped by how much room is left below 10, so a card
already near the top barely moves. Then the result is pulled slightly toward a
fixed target. The pull is small, and it is the part that keeps a long run of Good
answers from driving every card in the collection to the floor. Older algorithms
had no such term, and collections drifted into a state where everything looked
easy and nothing was scheduled sensibly.

**Stability moves**, by one of three rules.

- Correct answer, a day or more since the last one: stability grows. The size of
  the jump depends most on how low retrievability had fallen. Recalling something
  you were about to forget proves much more than recalling something you saw
  yesterday, so it is worth much more. It also depends on difficulty (harder cards
  gain less), on current stability (already stable cards gain proportionally less)
  and on which button was pressed.
- Wrong answer: stability drops to a value computed from difficulty, from the
  stability the card had and from retrievability. It is small, but it is not zero
  and it is not the starting value. A card you have known for a year and then
  forget comes back stronger than a card you learned yesterday and forgot.
- Two answers on the same day: a separate rule applies, because no measurable time
  passed and the forgetting curve has nothing to say. This rule is what FSRS-6
  added over FSRS-5. Correct answers here are held to never lower stability.

**The card is placed.** A card on its first day walks through the learning steps,
which are measured in minutes and ignore stability entirely. A card in the review
state is placed by its stability. A wrong answer on a review card drops it into
the relearning steps and counts a lapse.

## Desired retention is the lever

Solving the forgetting curve for `t` at a chosen recall probability gives

```
interval = S * (target ^ (1 / DECAY) - 1) / FACTOR
```

The multiplier depends only on the target, so the interval is always a fixed
multiple of stability. At the default target of 0.90 that multiple is exactly 1,
which is why stability reads as "the interval this card has earned".

This one setting is the only real control a person has over their workload, and it
is not a linear one:

| target | interval multiplier | reviews per day, against the default |
| ------ | ------------------- | ------------------------------------ |
| 0.80   | 3.32                | 0.30                                 |
| 0.85   | 1.91                | 0.52                                 |
| 0.90   | 1.00                | 1.00                                 |
| 0.95   | 0.40                | 2.48                                 |
| 0.97   | 0.22                | 4.49                                 |

Moving from 0.90 to 0.97 costs four and a half times the daily work and buys seven
percentage points of recall. Moving from 0.90 to 0.85 roughly halves the work.
This is the trade the load manager will make visible, and it is why the setting is
capped at 0.97 rather than left open.

## Scenario A from the demo

`pnpm --filter @neuron/core demo` prints three histories. This is the first: a
card answered Good every time, with each answer given on the day the card came
due, run for a year. Fuzz is switched off so the numbers are reproducible.

| #   | date       | answer | next     | stability | difficulty | recall |
| --- | ---------- | ------ | -------- | --------- | ---------- | ------ |
| 1   | 2026-01-05 | Good   | 10 min   | 2.31      | 2.12       | first  |
| 2   | 2026-01-05 | Good   | 2 days   | 2.31      | 2.11       | 1.00   |
| 3   | 2026-01-07 | Good   | 11 days  | 10.97     | 2.10       | 0.91   |
| 4   | 2026-01-18 | Good   | 46 days  | 46.32     | 2.10       | 0.90   |
| 5   | 2026-03-05 | Good   | 163 days | 163.00    | 2.09       | 0.90   |
| 6   | 2026-08-15 | Good   | 498 days | 497.88    | 2.08       | 0.90   |

Six answers in a year. The recall column is the chance of remembering the card at
the moment the question was asked, and it holds at 0.90 the whole way down. That
is the model working: the intervals grow at exactly the rate needed to keep
hitting the target.

## How this was checked

Three layers of tests, in `packages/core/src/fsrs`.

**Differential.** `ts-fsrs` is added as a devDependency, imported only from test
files, and never reaches the application. A generator builds 20000 review
histories of up to 60 answers each, varying ratings, gaps from the same day to
400 days, target retention across its range, learning and relearning steps,
interval caps, and weights jittered off their defaults. Every history is run
through both this implementation and the reference, and the two must agree on
state, stability, difficulty, due date, review count, lapse count and step index
after every single answer. The run compares over 600000 answers.

Writing the equations from a specification is not the same as getting them right.
Twenty equations and 21 weights leave a lot of room for a formula that looks
plausible, produces reasonable looking numbers, and is wrong in a way nobody
notices for years. The differential test is the only thing standing between that
and the user.

**Properties.** Rules that must hold for every input, checked over thousands of
generated histories: stability stays above zero, difficulty stays within 1 to 10,
retrievability starts at 1 and only falls, a wrong answer never raises stability,
a wrong answer on a review card always counts a lapse, the four buttons stay in
order, the same seed gives the same schedule, preview neither mutates the card nor
consumes randomness, and replaying a log produces the same card as applying the
answers one by one.

**Regression snapshot.** One fixed history of twenty answers with a fixed seed,
with its exact intervals, stabilities and difficulties committed. It exists to
catch a change that is not wrong so much as different. If those numbers move,
someone has to decide on purpose that the move was wanted.

## Two decisions worth knowing about

**Days are counted as UTC calendar days.** FSRS is fitted on data where a day is
the unit of scheduling, so two answers on the same date are zero days apart no
matter how many hours separate them, and answers on consecutive dates are one day
apart even if only minutes separate them. The scheduler relies on this: zero
elapsed days is what selects the same day rule. Which calendar day a review
belongs to for a person in Vladivostok is a question for the session layer, not
for the memory model.

**The interval cap has one documented exception.** Intervals are held to the
configured maximum, but the rule that keeps Good longer than Hard and Easy longer
than Good is applied after that cap. A card whose every interval has already
reached the cap therefore comes out one day past it on Good and two on Easy. This
is what the reference implementation does, and the alternative is worse: three
buttons that all promise the same date.

## Replay and offline

The `reviews` table is append only, and card state is a projection of it.
`replay(logs, config)` is that projection: it rebuilds a card from nothing but its
review log. This is what makes offline sync work. When two devices answer the same
card while offline, the logs are merged by timestamp and replayed, and both
devices arrive at the same card without either one having to win.

Fuzz is left off during a replay. It scatters the due date and never touches
stability or difficulty, so a rebuild returns the card to the day the model
actually asked for. Two devices replaying the same log always agree.
