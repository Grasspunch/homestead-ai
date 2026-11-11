# Homestead

Homestead is a control room for a crew of coding agents, drawn as a farm. You give it one feature. A Planner splits the work between farmers (Builder, Designer, Tester, Deployer), each with its own model, files, rules and spend limit, and the crew stops for you only at the moments that need a person.

## Who it is for

One engineer who hands a feature to several coding agents and stays responsible for what ships. Homestead is built for that one person; there is no team or lead view. Their job: get it merged and live without reading every diff, while catching the few moments that need judgment.

## Why it matters, and why a pull request and Slack aren't enough

Agent spend is easy to miss: each agent bills by the token, and nobody sees the total until the invoice. Agent work is also hard to undo once it has spread across files, merged and shipped. A pull request shows the finished diff and Slack carries the chatter, but neither gives each agent a budget, picks out the few runs that need a person (a cost spike, the same work done twice, two agents that disagree), or lets an agent earn more freedom as its runs come in clean. Homestead gives each agent a spend limit and each project a budget, stops you only at the moments that need a person, and offers to merge by itself after three clean runs.

## The problem

One agent on a whole feature works in a row and grades its own work. Several agents are faster, but today that means watching terminals and guessing when to step in. In the support sample, "Index the help docs" has used $7.97 of its $9.20 at about half done and is heading for $23. Splitting it keeps that part at $9.20 and gives the hard cases their own $6.38, about $7.27 less, and the pull request shows those two numbers. To keep that promise, the simulation sizes the split's steps at the moment it splits: the steps left on the first part are priced to end on its budget, and the hard cases' steps on their share, check included. The numbers come from the run as it plays; nothing is rescaled afterwards. Then the Designer's chat widget fails its check as off-brand, because docs/brand.md isn't in its context; add the guide from the ask or from the Designer's page and it redoes the colours. Separate checkers catch 3 problems before the merge in all, for $1.67 of checks. One agent grading its own work has nobody to catch them. As a safety net, the release goes to 10% first: in the sample, and on a new farm's first run, a timeout bug gets that far and rolls back by itself once errors pass 2% (3.1% in the sample).

## Three interaction choices

**The crew stops for you, at a level you pick.** "Often", "When it matters" or "Only what's hard to undo". Everything else is handled and listed under "Fixed without you". Each ask has a suggested answer and says how sure the farmer is and why, and your answer changes the run from there on. You can also answer in your own words: the Planner matches them to one of the options, holds on a no, says back what it read and waits for your yes before applying anything, and says so when it can't match them. A farmer that reaches its spend limit is paused, at every level: raise the limit, or stop it there and leave its unfinished tasks out. A raise you approve is the new limit exactly, and passing it asks again. The plan sets each limit at or above what that farmer spends on the plan's own path, so on the sample nothing stops on money after the split.

**One review, at the pull request.** A task commits when a different farmer's check passes. You review once: every commit with the check that let it in. Merge, or send one task back with a note; it is reworked at a retry cost, checked again, and comes back as one more commit. After three clean runs in a row (no rollback, nothing sent back or stopped) the Planner offers once to merge by itself; a rollback takes that back. While a release is live you can roll it back yourself.

**The plan is a set of choices you can see.** Each farmer, why it is on the crew, its model and limit, priced against one agent. The crew is mixed, from the models Lovable AI offers: the Planner on Claude Opus 5.5, the Designer on Claude Sonnet 5, the Builder on Codex with GPT-6.1 Sol (Sonnet 5's price per token), and the Tester and Deployer on GPT-6 Luna, a tenth of Haiku 4.5's price. The picker groups the models under Claude and OpenAI (Codex). Change a model and the price moves. Turn off the Deployer's "May deploy" and it asks before every release: the merge, the ship again after a rollback, and 10% to everyone. You can also ask the Planner to change the farm in plain words at any time, mid-run included ("I'm in an incident, skip the deployer and push straight to main"; "judge the rollout by synthetic tests"; "notify me at each rollout stage"). It shows one card with each change as a row, and what you lose beside any that removes a safety step; applied, it changes the run from now on, sits under the title as a chip that carries Undo for a few seconds and then × to turn it off, and Undo puts the run back exactly. Each row lasts for this farm or every farm, as the Planner suggests and you can flip; every-farm changes collect as "Your flow" in Settings, and new farms start with them. With the Deployer off, the release plot turns into "Push to main", worked by the Builder. Something it can't change gets "I can’t change that yet.", the closest change it can make, and chips that send it. In Live mode Claude reads the request against a strict schema of the changes the app can make; otherwise a scripted reader does, and the card says which. When two farmers disagree you can ask about it in your own words ("why does the Builder want that?", "what does each cost?") and the side you asked answers in one line while the ask stays open; suggest a way of your own and the Planner confirms it, then the Designer builds it, the Tester checks it, and it lands as its own commit.

## Crew against one agent

The comparison is one Claude Sonnet 5 agent doing the same work in a row, with no checker and no check cost. The plan's cost is the Planner's own estimate, made before anything runs ($42 on the sample); its time and the comparison come from simulating the run on its default path. Two assumptions carry the gap, and both are named in the app: one agent holds every file's context, so each step runs 1.35 times slower and costs 1.1 times more. In the support sample the crew costs $54 and takes 1 h 39 min; the same work alone costs about $53 and takes 2 h 2 min. Without those two assumptions, one agent would cost about $48 and take about 1 h 30 min. So the crew costs $1.51 more, is 23 minutes sooner assuming one agent runs a third slower (Done says "assuming" too), and $1.67 of checks caught 3 problems before merge. Done reads the real total against the Planner's estimate: "$54 in 1 h 39 min, $13 over the Planner's $42 estimate".

## Learning, export and projection

A farm learns from its own runs. After run 1, the task that ran over is planned in two from the start: run 2 says "Last time 'Index the help docs' ran over, so I split it from the start", needs no ask about it, and costs $3.51 less, $48 in all. Done offers the pull request as Markdown and a run report to download, both opening with what was simulated and matching Done's numbers. Done also shows a projection, tagged as one: the run's own rates over a month of handing off 2 features a week.

## What is simulated

Runs are simulated, and the top bar says so. A change mid-run (a model, a limit) only changes what happens from now on: what already happened, and the money already spent, stays as you watched it.

A real crew takes hours and real money. The simulation is deterministic, priced from list prices per token. Three samples (support assistant, checkout, metrics dashboard) have their own scripts; every farm is tagged "Simulated" in the top bar, and the sample "Simulated sample".

With Live mode on, every live call, Claude or OpenAI, goes through Lovable's AI gateway with the server's `LOVABLE_API_KEY`, paid with workspace credits, Out of credits, a call falls back to your own `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for that model's maker, when set; otherwise, rate limited or a wrong model id, it is simulated, and the screen says which source answered ("Lovable AI", "your Anthropic key", "your OpenAI key" or "Simulated (out of credits)"). Locally `/api/agent` is served by the dev server; the Lovable mirror has its own route at `src/routes/api/agent.ts`.

The live plan is the one real AI moment: the Planner reads your goal and proposes the crew, limits and done-whens in one call, and everything after it is simulated, which the plan and the title say. For the sample's goal and the starters on Home, a live plan is kept (in the browser, and in `src/run/recorded-plans.json` after `node scripts/record-plans.mjs <url of /api/agent>`), so if the live call fails on the day the farm shows that real plan, tagged "Planned live earlier" with its date, instead of a simulated one.

```
npm install && npm run dev
npm test
```
