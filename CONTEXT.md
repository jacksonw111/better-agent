# Better Agent Platform

Better Agent coordinates work performed by agents on computers available to a user. The platform uses one shared task model for software development and general computer work.

## Language

**Session**:
The product-facing name (since 2026-07-17) for one chat thread between the user and one Agent Runtime on one Computer. A Session maps to the internal task entity; the UI reaches it via Computers → agent → Session list → conversation, with a collapsible sibling-Session sidebar. Creating a Session is direct (no wizard): the Name is server-generated (`Session M/D HH:mm`) and the Description may be empty.
_Avoid_: Run, runtime session, browser session

**Task**:
A named unit of work created by a user and carried out through one conversation with one Agent Runtime on one Computer. A Task may stand alone or include optional GitHub context. Since 2026-07-17 the UI presents Tasks as Sessions; "task" remains the internal entity and API name.
_Avoid_: Job, work item, project task, local task

**Task Name**:
A human-facing label used in Session lists and as the Task Conversation title. It is not duplicated into the Agent's task instruction. Since 2026-07-17 it is server-generated (`Session M/D HH:mm`) rather than user-entered.
_Avoid_: Prompt, Description, generated summary

**Task Description**:
The central instructions for what the assigned Agent Runtime should do. The Description may contain Skill References such as `/research`; Better Agent resolves those references when it renders the Agent's initial instruction. Since 2026-07-17 it may be an empty string (the New session default); an empty Description injects no start context and the conversation begins with the user's first chat message.
_Avoid_: GitHub Issue, acceptance record, agent handoff document

**Task Creation Wizard**:
The three-step New Task flow. Runtime selects Computer, then Agent Runtime, shows the read-only Installed Tool Summary, and configures the Skill Palette. Request collects the required Task Name and Task Description. GitHub optionally selects a Repository and Linked GitHub Issues, then starts the Task directly even when both are empty. The wizard has no separate review or confirmation page. UI shelved 2026-07-17 (no entry point, code retained); Sessions are now created directly from an agent's Session list, and the GitHub step's server/CLI capabilities remain available for a future "session options" entry.
_Avoid_: New Task modal, one-page form, onboarding wizard

**Task Start Context**:
The runtime-ready initial context delivered when a Task begins. When the Description is empty (the New session default since 2026-07-17), no start context is injected. Otherwise Better Agent renders it from the Task Description after resolving Skill References, then adds the selected workspace, optional GitHub Repository and Linked GitHub Issues, and relevant platform-installed tools. The Task Name remains UI-only, and Skills are not emitted as a separate list.
_Avoid_: Raw description, chat transcript, health report

**Task Conversation**:
The interaction that opens after a Task starts. When the Description is non-empty its first visible message is the assembled Task Opening Message; with an empty Description (the New session default) it starts with the user's first chat message. It continues as messages between the user and the Task's single assigned Agent Runtime. Internal workspace preparation and Agent startup events do not appear as conversation messages. Agent-to-agent conversation is outside the first release.
_Avoid_: Activity timeline, team chat, Run log

**Task Opening Message**:
The first visible message in a Task Conversation when the Description is non-empty; an empty Description (the New session default) produces no Opening Message and the conversation starts with the user's first chat message. It is the human-readable Task information assembled at creation and keeps the user's original Description, including visible `/skill` references. Full Skill instructions are resolved only in the Agent-facing Task Start Context and are not expanded into the conversation. The message replaces lifecycle chatter such as “preparing workspace” or “starting Agent.”
_Avoid_: Status event, loading message, raw system prompt

**Draft Task**:
A Task whose explicit status is `draft`: saved without a successfully started Run. The first release keeps atomic Start and offers no save-as-draft entry point; the status value exists so failed-start retention and future offline queueing need no model migration. The wizard UI this assumed is shelved (2026-07-17); the status mechanism is retained.
_Avoid_: Queued Run, offline assignment, scheduled task

**Run**:
One continuous execution of a Task by one Agent Runtime on one Computer. A Task may have sequential Runs, but only one Run may hold write access at a time. Reopening or switching to a Session resumes it: the active Run is ended (bridge endSession), `tasks.resume` creates a new Run, and the launch carries `resumeAgentSessionId` (the runtime session id captured from the previous Run) to restore the conversation in the same Task Workspace. claude-code and codex resume natively; opencode and pi cold-start in the same workspace and report `resume_failed`. Up to 3 previous Runs render read-only above the current feed.
_Avoid_: Task, session, attempt, conversation

**Task Assignment**:
The configured Computer and Agent Runtime selected before a Task starts. The user selects the Computer first, and the Agent Runtime choices come from runtimes detected on that Computer. Changing the Computer invalidates an incompatible Agent Runtime selection. In the Session-centric UI (2026-07-17) the assignment is fixed by the agent page the Session is created from.
_Avoid_: Team, squad, participant list

**Project**:
Optional, durable context that groups related Tasks around an ongoing body of work. A Project is never required to create or run a Task.
_Avoid_: Workspace, repository

**Task Workspace**:
The managed starting directory prepared on the assigned Computer for one Task. For a repository-backed Task it is an isolated working copy prepared from the Repository Cache; without a repository it is a clean Task directory. It is a working location, not a platform permission boundary.
_Avoid_: Project, GitHub Repository, sandbox, capability restriction

**Repository Cache**:
Reusable, Computer-local repository data maintained by the Better Agent Client: one bare clone per repository identity, with each Task Workspace created via `git worktree` and cache sync serialized by a file lock. Dependency reuse is left to the package managers' own global caches; the platform does not build its own dependency cache layer in the first release. It is keyed by repository identity rather than Project membership.
_Avoid_: Task Workspace, Project, fresh clone

**Project Setup**:
The user-confirmed instructions and environment requirements used to prepare a Project for Tasks. The platform may suggest them from the repository, but an Agent Runtime does not rediscover them for every Task.
_Avoid_: Agent prompt, task instructions, bootstrap guess

**GitHub Repository**:
Optional repository context attached to a Task. A Task does not require a repository.
_Avoid_: Project, Task Workspace, mandatory source

**Linked GitHub Issue**:
Optional Issue context attached to a Task. A Task may link multiple Issues, but only after a GitHub Repository has been selected. At each Run start, Better Agent re-fetches and injects each linked Issue's title, body, and URL into the Task Start Context; the snapshot belongs to the Run, while the Task Opening Message stays immutable. Comments are not copied; the Agent may use `gh` to read the latest discussion when needed. Linked Issues supplement the Task Description rather than replacing it.
_Avoid_: Better Agent Task, primary prompt, hidden subtask

**GitHub Connection**:
The user's Server-side connection to GitHub. It lets Better Agent search repositories, load repository Issues, and attach that context while creating a Task. In the first release it is a user-pasted fine-grained personal access token stored encrypted on the Server; the connection record carries a credential type so a GitHub App can replace it later without touching the Task side.
_Avoid_: Local gh authentication, repository clone, Agent Runtime login

**GitHub CLI Readiness**:
The installation and initial setup of `gh` on a Computer. The Better Agent Client installer offers to install it when missing and may guide the user through native `gh auth login`. Better Agent does not run an authentication preflight for every Task; if later use fails, the Agent Runtime receives the real command error and can handle it.
_Avoid_: GitHub Connection, Better Agent Client pairing

**Parent Issue**:
A GitHub Issue that expresses a larger outcome and tracks its decomposition into Sub-issues.
_Avoid_: Project, epic copy, Better Agent task group

**Sub-issue**:
A GitHub Issue representing one independently deliverable part of a Parent Issue. Each runnable Sub-issue receives its own Task and delivery flow.
_Avoid_: Hidden task, checklist item, internal subtask

**Delivery Pull Request**:
The GitHub Pull Request through which a Project Task continuously presents its proposed code changes, checks, and review state. It begins as a draft and remains attached to the same Task throughout revision.
_Avoid_: Task result, final report, review copy

**Computer**:
A user-controlled computer registered with the platform and available to perform Tasks.
_Avoid_: Machine, device, host, agent

**Better Agent Client**:
The platform component installed on a Computer that keeps it connected and makes its capabilities available for Tasks.
_Avoid_: Agent Runtime, agent-cli, bridge

**Pairing**:
The one-time association of a Better Agent Client and its Computer with a user's Better Agent account. During pairing the Client generates a keypair whose private key stays in the local config directory; the Server stores the public key and issues the Computer ID, and later registrations authenticate by key signature. The same identity file means the same Computer; a lost identity file means pairing again as a new Computer, with no reclaim mechanism.
_Avoid_: Runtime login, GitHub authorization, task assignment

**Agent Runtime**:
An agent execution product available on a Computer, such as Claude Code, Codex, OpenCode, or Pi.
_Avoid_: Computer, Better Agent Client, provider

**Runtime Inventory**:
The Agent Runtimes a Computer has detected, including installation information that can be presented to the user and injected into a Task's Agent Environment Context.
_Avoid_: Agent list, task list, provider catalog

**Skill Inventory**:
The Skills available to the selected Agent Runtime on the selected Computer. Skill support is part of the Runtime capability handshake: a Runtime reporting no skill capability hides the Skill section entirely instead of showing an empty list. The Task Creation Wizard showed this inventory only after both Computer and Agent Runtime had been selected (wizard UI shelved 2026-07-17; the inventory itself remains part of the Computer report).
_Avoid_: Tool inventory, Agent Runtime list, global marketplace

**Skill Palette**:
The subset of the selected Agent Runtime's Skill Inventory that the user makes available in the current Task Description's `/` autocomplete. Choosing a Skill does not insert it into the Description, activate it automatically, or send a Skill list to the Agent. Shelved with the Task Creation Wizard UI (2026-07-17); mechanism retained.
_Avoid_: Selected Skill metadata, runtime capability, prompt section

**Skill Reference**:
A slash directive such as `/research` that the user explicitly inserts into the Task Description through autocomplete. At Task startup, Better Agent resolves the directive through a single Runtime Adapter interface: the default resolution inlines the Skill's instructions at the reference position, and a runtime-native activation form is an optional optimization, not a prerequisite.
_Avoid_: Skill badge, selected Skill list, chat command

**Agent Environment Context**:
A concise environment section inside the Task Start Context. It tells the Agent Runtime which platform-managed tools are available on the selected Computer, such as `gh`, without claiming that every tool is currently authenticated or healthy.
_Avoid_: Health check, permission policy, user instruction, capability restriction

**Installed Tool Summary**:
A read-only list showing the default CLI tools that Better Agent manages on the selected Computer, such as `git` and `gh` (originally shown in the wizard's Runtime step, shelved 2026-07-17; now a Computers-page fact). It is not a health report, software inventory, or set of user-selectable options; the same facts feed the Agent Environment Context.
_Avoid_: Health check, Skill Palette, all installed software

**Working Location**:
An optional local folder selected as the starting context for a stand-alone Run. Deferred beyond the first release: there is no remote directory browser or location picker, and stand-alone Tasks name their target resources (such as `~/Pictures`) directly in the Task Description. It does not replace or redefine the Agent Runtime's native capabilities and permission model.
_Avoid_: Project, Task Workspace, sandbox, Work Scope
