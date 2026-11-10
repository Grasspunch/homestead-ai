# Homestead

Homestead is a control room for a crew of coding agents, drawn as a farm. You give it one feature to build. A Planner splits the work between farmers (a Builder, a Designer, a Tester and a Deployer), each with its own model, files, rules and spend limit. Each task grows on its own plot while you watch, and the crew stops for you only at the moments that need a person.

## Who it is for

It is for an engineer or tech lead who hands a feature to several coding agents at once and stays responsible for what ships. Their job is to get the feature merged and live without reading every diff, while still catching the few moments that need judgment: spend running away, two agents disagreeing, a check failing, a change that reaches other people's code, and the ship itself.

## The problem

Running one agent on a whole feature is slow and unchecked. It works through every task in a row, rereads one growing context, and grades its own work. Running several agents is faster, but today it means watching several terminals and guessing when to step in. Either way, the cost of a missed moment is real. In the sample run, one task heads to about $31 against an $11 share, and splitting it saves about $14. Later, a timeout bug gets past every test. Shipped straight to everyone, it would hit every user. Here the Deployer ships to 10% first, sees errors pass 2%, rolls back by itself within about three minutes, and a fix goes out after that.

## Three interaction choices

**The crew stops for you, at a level you pick.** "Often", "When it matters" and "Only what's hard to undo" decide which moments become an ask. The rest are handled and listed under "Fixed without you", so you can see what you weren't asked about. Every ask shows both sides, what each option costs, and a suggested answer. Your answer changes what happens next: splitting, raising the limit and stopping an over-budget task each play out differently, and so do keeping a refactor small, stopping a failing task, and shipping to everyone at once.

**One review, at the pull request.** Each task commits as soon as a different farmer's check passes, so nobody grades its own work and nothing waits on you mid-run. You review once, when the pull request is ready: every commit with the check that let it in. Merge it, or send one task back with a note, and its farmer changes it at a retry cost, another farmer checks it, and the pull request comes back with one more commit. After a clean merge the Planner offers, once, to merge future pull requests by itself when every check passes; a failed check always asks. While a release is live you can roll it back yourself from the pull request.

**The plan is a set of choices you can see.** Before anything runs, the plan lists each farmer, why it is on the crew, its model and its limit, and prices the crew against one agent alone. Change a model and the price moves. Drop or add a farmer and the plan is drawn again. During the run, a farmer's page shows its files and rules. Changing its model applies from that moment, and turning off the Deployer's "May deploy" makes it ask you before every ship.

## What is simulated, and why

The runs are simulated, and the top bar says so. A real crew of agents on a real repository takes hours and costs real money, which is wrong for a demo someone tries in three minutes. The simulation is deterministic: the same plan and the same answers always give the same run, so a different answer gives a different run from that point on. The run is priced from list prices per token, with Claude Opus 5.5 for the Planner and Designer, Claude Sonnet 5.5 for the Builder, and Claude Haiku 5.5 for the Tester and Deployer.

Three sample projects (a support assistant, a checkout, a metrics dashboard) have their own script for the refactor, the disagreement and the rollout. A goal that matches none of them runs a generic app, marked "Demo scenario".

The Planner can be real. With Live mode on in Settings and an `ANTHROPIC_API_KEY` on the server, the plan comes from Claude Opus 5.5 and is tagged "Planned live by Claude". Message routing uses Claude Haiku 5.5. If the live call fails, the plan says it is simulated and why.

## Running it

```
npm install
npm run dev        # http://localhost:5173, with /api/agent served by the dev server
npm test
npm run build
```

For Live mode locally, put `ANTHROPIC_API_KEY` in `.env.local`. The deployed app runs on Lovable, where `/api/agent` is a server route. `scripts/sync-lovable.sh <path>` mirrors this app into that project.
