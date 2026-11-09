# Design rationale

**Target user.** A product manager who hands a multi-step goal to a crew of agents and stays accountable for what goes out under their name. Engineers, designers and finance leads appear in the demo as neighbours, not as users.

**The problem.** Agents work from the context they're given, so they can't know what other teams decided. In the demo, the PM's Writer uses March 12, the date promised to Acme on a call. Engineering had moved the release to March 26 in standup notes the PM never attached. Shared docs and Slack don't catch this, because nobody reads every other team's notes before an email goes out, and agents read even less. Every team running agents has this failure mode. Each catch saves an incident with a customer.

**Why a farm.** The farm is how you read state, not how you make decisions. You can see the status of 5 tasks, 4 agents and their spend in one glance at the plots, where a chat interface would need 5 transcripts. Every decision happens on a plain card with plain words. Each farm word also shows its meaning next to it ("Plot · task").

## Three interaction choices

1. **You approve the plan, including what each agent may read.** The head farmer's plan shows every task's signposts (the documents its farmhand can see), and you can add or remove them before anything starts. Context is the main lever on agent behaviour, so it's the thing you review. That's also why the trace can teach the lesson: "plan review didn't add the eng notes".
2. **Agents only stop you for five reasons, and say which.** Cost, Risk, Irreversible, Failure or Anomaly. Each card states its confidence and what that confidence rests on. A Medium-confidence quote gets an ask; a High-confidence missing source gets fixed alone and logged under Auto-decided, where you can audit it. Irreversible steps need a second confirm that restates the consequence.
3. **Mistakes become lessons that travel.** "Why did it do that?" replays the decision with the agent's real inputs. One click saves the lesson as a seed `.md`, and the next crew starts with it planted. You can watch this happen: a saved seed from an earlier harvest is planted into the Scheduler's card at plan time.

## What's real and what's simulated

The head farmer's questions and plan, the Writer's draft, the Reviewer's claim check and the cross-farm conflict check are live Claude calls with JSON-schema output. The conflict check reads all 5 documents the neighbouring farm shares, including an older note that still says March 12. Each call's real token count goes into the ledger.

The farmhands' tool steps between those calls, the email send and the other three farms are simulated, and the UI labels them that way. Without an API key, the model calls replay a recorded run and are labelled Replay. We cut the Claude Code hook from the original design, which would have turned a Claude Code permission prompt into a card. It needed a second runtime on stage, and the three-minute story is stronger with one journey done fully.
