# Homestead

Homestead is a control room for a crew of coding agents, drawn as a farm. You give it one feature. A Planner splits the work between farmers (Builder, Designer, Tester, Deployer), each with its own model, files, rules and spend limit, and the crew stops for you only at the moments that need a person.

## Who it is for

An engineer or tech lead who hands a feature to several coding agents and stays responsible for what ships. Their job: get it merged and live without reading every diff, while catching the few moments that need judgment.

## The problem

One agent on a whole feature works in a row and grades its own work. Several agents are faster, but today that means watching terminals and guessing when to step in. In the support sample, "Index the help docs" has used $9.37 of its $10.80 at about half done and is heading for $30. Splitting it keeps that part at $10.80 and gives the hard cases their own $6.38, about $13 less, and the pull request shows those two numbers. To keep that promise, the simulation rescales the split's own steps after the fact so the first part ends exactly on its budget and the hard cases on their share; nothing else is rescaled. A separate checker then catches two problems before the merge: two tests crashing on empty input, and sources covering the reply box. One agent grading its own work has nobody to catch them. As a safety net, the release goes to 10% first: in the sample, and on a new farm's first run, a timeout bug gets that far and rolls back by itself once errors pass 2% (3.1% in the sample).

## Three interaction choices

**The crew stops for you, at a level you pick.** "Often", "When it matters" or "Only what's hard to undo". Everything else is handled and listed under "Fixed without you". Each ask has a suggested answer and says how sure the farmer is and why, and your answer changes the run from there on. You can also answer in your own words: the Planner matches them to one of the options, holds on a no, says back what it read and waits for your yes before applying anything, and says so when it can't match them. A farmer that reaches its spend limit is paused, at every level: raise the limit, or stop it there and leave its unfinished tasks out. A raise you approve is the new limit exactly, and passing it asks again. The plan sets each limit at or above what that farmer spends on the plan's own path, so on the sample nothing stops on money after the split.

**One review, at the pull request.** A task commits when a different farmer's check passes. You review once: every commit with the check that let it in. Merge, or send one task back with a note; it is reworked at a retry cost, checked again, and comes back as one more commit. After three clean runs in a row (no rollback, nothing sent back or stopped) the Planner offers once to merge by itself; a rollback takes that back. While a release is live you can roll it back yourself.

**The plan is a set of choices you can see.** Each farmer, why it is on the crew, its model and limit, priced against one agent. Change a model and the price moves. Turn off the Deployer's "May deploy" and it asks before every release: the merge, the ship again after a rollback, and 10% to everyone. You can also ask the Planner to change the farm in plain words at any time, mid-run included ("I'm in an incident, skip the deployer and push straight to main"; "judge the rollout by synthetic tests"; "notify me at each rollout stage"). It shows one card with each change as a row, and what you lose beside any that removes a safety step; applied, it changes the run from now on, sits in the top bar as a chip you can turn off, and Undo puts the run back exactly. In Live mode Claude reads the request against a strict schema of the changes the app can make; otherwise a scripted reader does, and the card says which.

## Crew against one agent

The comparison is one Claude Sonnet 5.5 agent doing the same work in a row, with no checker and no check cost. The plan's numbers come from simulating the run on its default path, so the plan and the run agree until you answer differently. Two assumptions carry the gap, and both are named in the app: one agent holds every file's context, so each step runs 1.35 times slower and costs 1.1 times more. In the support sample the crew costs about $52 and takes 1 h 52 min; the same work alone costs about $52 and takes 2 h 17 min. Without those two assumptions, one agent would cost about $47 and take about 1 h 41 min. So the crew costs about the same, is 25 minutes sooner assuming one agent runs a third slower (Done says "assuming" too), and $1.61 of checks caught two problems before merge. A farm you start from the support chip words its goal differently and takes 1 h 49 min, 28 minutes sooner; it sits beside the sample on Home as "Support assistant 2".

## What is simulated

Runs are simulated, and the top bar says so. A change mid-run (a model, a limit) only changes what happens from now on: what already happened, and the money already spent, stays as you watched it.

A real crew takes hours and real money. The simulation is deterministic, priced from list prices per token. Three samples (support assistant, checkout, metrics dashboard) have their own scripts; every farm is tagged "Simulated" in the top bar, and the sample "Simulated sample".

With Live mode on and an `ANTHROPIC_API_KEY` on the server, the plan comes from Claude Opus 5.5 and is tagged "Planned live by Claude"; a failed call says so. Locally `/api/agent` is served by the dev server; the Lovable mirror has its own route at `src/routes/api/agent.ts`.

```
npm install && npm run dev
npm test
```
