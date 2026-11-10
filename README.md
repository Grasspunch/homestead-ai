# Homestead

Homestead is a control room for a crew of coding agents, drawn as a farm. You give it one feature. A Planner splits the work between farmers (Builder, Designer, Tester, Deployer), each with its own model, files, rules and spend limit, and the crew stops for you only at the moments that need a person.

## Who it is for

An engineer or tech lead who hands a feature to several coding agents and stays responsible for what ships. Their job: get it merged and live without reading every diff, while catching the few moments that need judgment.

## The problem

One agent on a whole feature works in a row and grades its own work. Several agents are faster, but today that means watching terminals and guessing when to step in. In the sample run, "Index the help docs" has used $7.83 of its $9.00 at about half done and is heading for $27; splitting it costs about $12 less. Later a timeout bug passes every test. The Deployer ships to 10% first, sees errors reach 3.1%, and rolls back by itself. One agent with no checker would have shipped it to every user.

## Three interaction choices

**The crew stops for you, at a level you pick.** "Often", "When it matters" or "Only what's hard to undo". Everything else is handled and listed under "Fixed without you". Each ask has a suggested answer, and your answer changes the run from there on. A farmer that reaches its spend limit is paused until you raise it.

**One review, at the pull request.** A task commits when a different farmer's check passes. You review once: every commit with the check that let it in. Merge, or send one task back with a note; it is reworked at a retry cost, checked again, and comes back as one more commit. After a clean merge the Planner offers once to merge by itself when every check passes. While a release is live you can roll it back yourself.

**The plan is a set of choices you can see.** Each farmer, why it is on the crew, its model and limit, priced against one agent. Change a model and the price moves. Turn off the Deployer's "May deploy" and it asks before every release: the merge, the ship again after a rollback, and 10% to everyone.

## Crew against one agent

The comparison is one Claude Sonnet 5.5 agent doing the same work in a row, with no checker and no check cost. Before the run both columns are estimates; after it both come from the run. In the support sample the crew costs $58 and finishes in under 2 hours; the same work alone costs about $50 and takes 2 h 17 min. The crew is a little dearer, about half an hour sooner, and checked.

## What is simulated

Runs are simulated, and the top bar says so: a real crew takes hours and real money. The simulation is deterministic, priced from list prices per token. Three samples (support assistant, checkout, metrics dashboard) have their own scripts; any other goal is marked "Demo scenario".

With Live mode on and an `ANTHROPIC_API_KEY` on the server, the plan comes from Claude Opus 5.5 and is tagged "Planned live by Claude"; a failed call says so. Locally `/api/agent` is served by the dev server; the Lovable mirror has its own route at `src/routes/api/agent.ts`.

```
npm install && npm run dev
npm test
```
