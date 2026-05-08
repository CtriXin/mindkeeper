# Why I Built Long Long Run

This is not a polished launch essay. It is closer to a dev log.

Long Long Run did not begin as a grand plan to build an agent runtime. It grew out of a pile of small frustrations I kept running into while using Codex.

Each problem looked minor on its own. Codex would sometimes misunderstand what I meant. Sometimes it would stop halfway through a task. Sometimes it would produce a pile of artifacts and leave me wondering where review should even begin. Sometimes its web search felt less like exploration and more like confirming something it already believed.

But once these problems stack up, they create a very familiar feeling: you know the agent is smart, and you know it can keep going, but you still have to keep one hand on the steering wheel.

LLR was born from that feeling. It is not meant to over-control Codex. It is meant to help Codex use the ability it already has in a steadier, more durable way.

## 1. INC: I Just Wanted Codex To Understand Me Better 🎧

The name INC comes from ANC: Active Noise Cancellation, the thing in noise-canceling headphones.

That connection is personal. I like noise-canceling headphones because they do not make the world louder. They make the noise quieter, so the important signal can finally come through.

Eventually I realized that using Codex has a similar problem.

Very often, Codex is not the weak link. My input is.

- I may not understand the domain well enough.
- I may not know how experts frame the problem.
- I may only be able to describe a vague feeling.
- I may not know what the final deliverable should look like.
- I may think I explained myself clearly while leaving out half of the hidden requirements.

Then Codex works very hard on the task I literally described, but the result can be far away from what I actually wanted.

That experience is subtle. It is not just "the model made a mistake." The goal itself was noisy from the beginning.

So I built INC: Intent Noise Cancellation.

INC does not ask Codex to start implementing immediately. It asks Codex to slow down first: explore the context, inspect the project, think from a domain-aware perspective, surface hidden requirements, expose assumptions, identify risks, propose hard acceptance criteria, and return a clearer contract for me to confirm.

My favorite thing about INC is that it helps even when I cannot describe what I want very well. In many cases, Codex can still reach the thing I meant.

That is the part that feels closest to noise cancellation. It does not invent a new world for me. It helps me hear the signal that was already there, buried under the noise.

## 2. Stop Guard: I Do Not Want To Keep Typing "Continue" 🧯

Another thing that wore me down was how often Codex would stop.

Not stop because the task was actually done. Stop even though it clearly knew what the next step should be.

It would finish a useful chunk of work, summarize the result, often write down the next step itself, and then ask:

> Should I continue?

For short tasks, this is fine. For long tasks, it is exhausting.

I would already have spent time in INC planning the work with Codex. The contract was clear. The acceptance criteria were written down. The risks were known. The next step was obvious. Then, after doing one local piece of the implementation, Codex would stop and ask me whether it should proceed.

The ridiculous part is that its own summary usually contained the answer.

So why should I have to type "continue" again?

This sounds like a tiny interaction issue, but it breaks the rhythm of long work. If you want the agent to own a mainline, repeatedly saying "keep going" feels like sitting next to someone who already knows how to drive and still having to tell them to keep driving.

That is why LLR has a Codex-hook-based stop guard.

The stop guard is not designed to make Codex run forever. It is not designed to turn every task into endless optimization. It does one simple thing:

> If Codex still understands the main objective, the current evidence, the next action, and the completion signal, it should not stop just because it produced one useful local update.

The control should belong to the agent.

If the objective is complete, it can stop.  
If the work is blocked, it can stop.  
If the user says stop, it can stop.  
If new evidence shows the contract needs to be renegotiated, it can return to INC.

But if it knows the next step, and that next step is still covered by the authorized mainline, it should continue.

In practice, Codex handles itself surprisingly well under this setup. It is better than I expected at deciding when to push forward, when to tighten scope, and when to come back to me.

That lets me spend more energy where I actually want to participate: the early INC phase and the final review.

## 3. Side Threads: The Mainline Still Needs A Compass 🧭

The side-thread idea came much earlier than Codex's `/side` feature, and it is not based on the same mechanism.

The reason I wanted it was simple: during an ACTIVE run, I often remember something late.

Maybe I forgot to mention an important condition. Maybe a premise changed. Maybe I suddenly need Codex to help me with a more urgent question before returning to the main job.

That kind of follow-up conversation is natural for humans, but it is awkward for long agent runs.

From the LLM side, extra conversational turns are not free. They can dilute attention, shift the local conversational center, and even make later compaction less faithful to the original mainline. I have thought about this problem a lot, and I suspect there is more to explore here in the future.

LLR cannot magically remove that underlying attention problem.

What it can do is help Codex tolerate it.

In ACTIVE mode, the user-message hook reminds Codex to answer the user's latest message first, then resume the authorized mainline if that message does not change the contract, block the work, or require returning to INC.

That small rule matters.

It means I can add a missing constraint, ask a side question, or briefly redirect Codex to something urgent without permanently knocking the long task off course.

Codex can walk the side path, handle what I just asked, and then return to the road.

It feels a little like an explorer getting briefly lost in the woods, except the compass in their hand still points back to the intended direction.

## 4. Evidence Chain: Long Runs Need More Than Checkpoints 🧵

The evidence-chain idea came from a complaint a friend made.

He said the most uncomfortable part of vibe coding was not the amount of code. It was not knowing where review should start.

That hit me immediately.

When Codex works on a long task, it can produce a lot:

- code
- documents
- scripts
- configuration
- tests
- intermediate experiments
- temporary probes
- reports
- explanations that all sound reasonable at the time

But those artifacts are not equally important. Some are tightly connected to the mainline. Some are temporary scaffolding from exploration. Some are later overturned by new evidence. Some should never make it into the final result.

One useful trick is to ask another Codex session to review the history. I used to do that a lot.

Then I realized what that review process really was: Codex was rebuilding an evidence chain from scratch.

It had to answer:

- Why was this done?
- What evidence supported this conclusion?
- Why does this file matter?
- What has already been verified?
- Which assumptions were later overturned?
- What facts should guide the next step now?

If review needs to rebuild the evidence chain anyway, why not maintain the evidence chain from the beginning of the session?

That is why evidence chain became part of LLR.

Checkpoints are still useful. They record what happened. But long work needs more than a timeline. It needs to know what is currently true, why it is true, and how it should affect the next action.

So LLR keeps the evidence chain focused on current effective evidence.

If old evidence is overturned, it should be removed or replaced in the current evidence chain. The history can be recorded briefly in a checkpoint, but stale evidence should not keep steering the task.

This makes Codex's continuation feel more like engineering judgment and less like rolling forward through a growing pile of summaries.

## 5. Explore, Do Not Just Validate Search Results 🔎

The last piece came from my confusion about Codex's search behavior.

I kept wondering why GPT Pro often felt better at search than Codex.

Codex has much richer context. It can read files, inspect code, run commands, understand artifacts, and connect web results back to a real workspace. In theory, it should be excellent at deep research.

But in practice, Codex search often felt like answer validation rather than problem exploration.

For example, if you ask for the latest instance segmentation models, Codex might immediately search for `SAM2`.

That is not completely wrong. SAM2 matters.

The issue is that this is not how a person explores an unfamiliar field.

A person would usually start from the task surface:

- instance segmentation
- video segmentation
- interactive segmentation
- open-vocabulary segmentation
- medical image segmentation benchmark
- 2025 survey
- leaderboard
- dataset
- failure mode
- evaluation metric

Then they would gradually discover the key methods, terms, labs, papers, tools, and benchmarks in the field.

Codex, however, often jumps straight to the high-confidence keyword it already remembers. The result looks like search, but it behaves more like validating an answer that was already in its head.

That is not exploration. That is validation.

So I built another skill for this:

https://github.com/huahuadeliaoliao/ddgs-search-harness

That skill teaches Codex to search more like a human researcher: derive search terms from the user's wording, project vocabulary, file names, data labels, metrics, failure symptoms, tool ecosystems, quality bars, and domain terms instead of only searching for the answer it already expects.

For engineering reasons, I did not embed that full search harness inside LLR.

LLR should stay lightweight. It should not become a runtime that absorbs every other tool.

But I did inject a similar idea into INC. When domain standards, current practice, expert framing, or version freshness may affect the task, Codex should run a bounded domain calibration pass before presenting expert defaults.

In other words, INC should not only "think." When needed, it should actually explore.

First discover how the domain frames the problem. Then validate whether a candidate solution is reliable.

## What LLR Is Really Trying To Solve

At this point, the goal of LLR is pretty simple.

It is not trying to make Codex into a project management system.  
It is not trying to make Codex remember everything.  
It is not trying to turn hooks into a heavy, clever state machine.

LLR is trying to give Codex a steadier working posture:

- use INC to reduce intent noise, explore, and build an evidence chain
- use ACTIVE to continue along an authorized mainline
- answer side conversations without losing the authorized mainline
- avoid premature stopping when the task is not done and the next step is clear
- update understanding when evidence changes instead of clinging to an old plan

The more I use agent systems, the more I believe a good harness should not think for the agent. It should help the agent stay clear-headed.

That is what LLR tries to do.

It gives Codex a steering wheel, a current map, an evidence chain, and a guard that reminds it to keep moving when it should not stop yet.

The rest belongs to the agent.
