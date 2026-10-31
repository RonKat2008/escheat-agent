# Escheat Agent: 3-minute demo script

Spoken script with exact clicks. Total about 3:00 at a steady pace. The scene order follows the "Running the demo"
flow in the README (there is no separate pitch-video storyboard file in this repo).

**Prototype. Not legal advice. Confirm filings with a qualified professional.** All data is synthetic.

## Before you go on

Do this once, 10 minutes before:

1. Stop any running dev server, then `pnpm seed:demo` (resets to 47 stale items / $61,915.00; CA 21, TX 15, DE 11).
2. `pnpm dev`, open `http://localhost:3000`. Optional: `npx inngest-cli@latest dev`.
3. Keys in `.env.local` for the best run: `ANTHROPIC_API_KEY` (chat, Stagehand), `LOB_TEST_API_KEY` (test key only),
   `APP_PASSCODE` if you want the login screen. Run `pnpm smoke:live` and confirm the rows you need say PASS.
4. Open tabs: `/` , `/chat`, and have the passcode ready. Set the header **Demo date** to the anchor (the seed does this).
5. Ask the chat one throwaway question so the first real answer is not a cold start.

## Script

| Time | Scene | Do | Say |
|---|---|---|---|
| 0:00 | 1. Marketing site | Open `/`. Scroll to "From a ledger export to a filed report, in six steps". Click **Security** in the nav, show it for two seconds, click **Open the demo** | "Every uncashed check is a legal clock. Escheatment turns forgotten money into state property, and finance teams track it in spreadsheets. Escheat Agent watches every check, applies each state's sourced rules, reaches the owner and files the report. It stops for a person before anything irreversible. Blue runs on its own, pink waits for you." |
| 0:25 | 2. Dashboard | You land on `/dashboard` (enter the passcode if asked). Point at the total, then the CA / TX / DE split | "Forty-seven stale items, sixty-one thousand nine hundred fifteen dollars, across California, Texas and Delaware. Stale is our 180-day business threshold, not the law. The law comes next." |
| 0:45 | 3. One item | Click **Items**, open check **#10482** (Bayline Electric, $2,340.00). Show the timeline and hover or click a date to show its rule path and source link. Point at an UNVERIFIED badge | "Each date traces to a rule file with an official source and version. The model does not compute these, plain code does. Anything a human has not approved shows UNVERIFIED." |
| 1:05 | 4. Chat | Click **Chat**. Ask: `What do we owe and where?` Wait for the exposure card. Ask: `Explain check #10482` (timeline card). Ask: `Draft the due-diligence letter for #10482` (approval card) | "I can just ask. Each answer is a tool call, rendered as a live card, not a paragraph I have to trust. Now I ask for the letter. It is a draft. The assistant has no tool that approves or sends anything, so it says nothing was sent." |
| 1:50 | 5. Approve | Click the card's review link, or **Approvals**. Show the exact letter content. Click **Approve**, then **Send** | "This is the single human gate, enforced on the server. I see exactly what will be mailed. Approve. It goes out as a Lob test-mode PDF, never real mail." |
| 2:10 | 6. Time travel and filing | Header **Demo date** then **+1y**. Open **Reports**, click **Generate** for CA. Click **Run filing agent** and wait for the pause at **Approve submission**; click it | "I jump a year ahead. Items move to report. The NAUPA file is generated and validated. A browser agent fills the replica California portal and stops at Approve submission. Only my click lets it submit, and it records the confirmation number." |
| 2:35 | 7. Recovery | Open **Recoveries**, click **Run recovery search**. Show the $1,180.00 TX match for NORTHWIND FIXTURES INC | "Same agent, other direction: it searches replica state databases for money owed to us, finds eleven hundred eighty dollars in Texas, and drafts a claim for my approval." |
| 2:50 | 8. Close | Open **Eval** (or return to `/`) | "Two hundred labeled cases score the classifier, and every run is stored with the method that actually ran. The model reads, the code decides the law, and a person approves every irreversible step." |

Optional if time allows (cut first): ask Claude over MCP "What do we owe in unclaimed property, and where?" (see
`docs/MCP.md`).

## What you should see

- Dashboard: **$61,915.00**, **47** items, CA 21 ($28,410), TX 15 ($19,862), DE 11 ($13,643).
- Check #10482: Bayline Electric, $2,340.00.
- Recovery: **$1,180.00** in TX for "NORTHWIND FIXTURES INC".
- Filing agent paused at "Approve submission", then a confirmation number matching `REPL-CA-YYYY-XXXXXX`.
- Eval card: the number shown is whatever the stored run recorded. Say the method out loud (heuristic baseline or model);
  do not quote a figure that is not on screen.

## Fallbacks

**Wi-Fi fails or the venue network is bad.** Start the app with `ESCHEAT_OFFLINE=1` (put it in `.env.local` or
`ESCHEAT_OFFLINE=1 pnpm dev`, then `pnpm seed:demo` is not needed again). The classifier, filing and recovery agents use
recorded cassettes or the labeled heuristic or SCRIPTED driver, and Lob, AgentMail and Vapi become local fakes whose
results say "Offline mode: nothing was sent". Say that line out loud; do not claim anything went out. Everything in
scenes 1 to 3 and 5 to 8 still works. The local Chromium agents and the replica portals run on localhost and need no
internet. `pnpm e2e:offline` rehearses exactly this path.

**Chat in offline mode.** Cassettes for the demo prompts ship in `fixtures/cassettes/chat/` and replay with `ESCHEAT_OFFLINE=1` (the seed must be the standard demo seed). Any other question reports that there is no
recorded answer rather than inventing one. Re-record with `pnpm chat:record` (key + heuristic-seeded DB) after changing the prompt, tools or data. If it ever fails,
skip scene 4 and create the letter from the item in **Approvals** (**Draft letter**),
then continue at scene 5.

**A live key is missing.** Every feature shows an honest "not configured" state; narrate it as the safety design.

| Missing | What happens | What to do |
|---|---|---|
| `ANTHROPIC_API_KEY` | Chat returns "Chat needs ANTHROPIC_API_KEY". Classifier uses the labeled heuristic. Agents run SCRIPTED | Skip chat (use **Draft letter** in Approvals). Say "heuristic baseline" about eval |
| `LOB_TEST_API_KEY` | Letter send shows "not configured"; the approval still works | Approve, then say the Lob test PDF is what you would see; or use `ESCHEAT_OFFLINE=1` for a labeled local fake |
| `AGENTMAIL_API_KEY` / `AGENTMAIL_INBOX_ID` | Email refused as "agentmail not configured" (run `pnpm agentmail:setup`) | Skip email, stay on the letter |
| `VAPI_*` or empty `ALLOWED_TEST_PHONES` | Call refused as not configured | Skip the call; never dial a number that is not on the allowlist |
| `INNGEST_*` | Nothing needed locally | Run `npx inngest-cli@latest dev` or skip |
| `APP_PASSCODE` unset | Dev mode: no login screen. Production: the app refuses to serve (503) until it is set | Set it for any deployed demo |

**Agent stalls or errors.** Open **Agent runs** (`/runs`), show the logged run, then `pnpm agent:file CA` or
`pnpm agent:recover` in a terminal drives the same agent. If state is muddy, stop the server and `pnpm seed:demo`.

**Chat answer is wrong or slow.** Use the card, not the prose: the numbers come from tools. Click **Dashboard** and
carry on. The rate limit is per session, so do not re-ask rapidly.

**Browser window needed.** `AGENT_HEADED=1` shows the agent browser; leave it off for a clean screen.

## Reset between takes

Stop the dev server, `pnpm seed:demo`, start `pnpm dev`. It resets the clock, approvals, reports, recoveries, agent
runs and replica tables.
