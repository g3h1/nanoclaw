Feature: Eval harness for agent quality
  As the operator of a NanoClaw agent
  I want a judge agent to grade my main agent against a held-out task set
  So that I can measure quality and catch regressions without reviewing transcripts by hand

  Background:
    Given a subject agent with persistent memory and a CLAUDE.md
    And a judge agent whose role is to grade responses against expected behaviour
    And a held-out task corpus where each task has a prompt and an expected-behaviour description

  Scenario: Bootstrapping the harness
    Given the operator has a subject agent
    When the operator asks the subject to bootstrap an eval harness
    Then a judge agent is created with grading instructions
    And the held-out corpus is initialised with seed tasks
    And the subject and judge can message each other in both directions

  Scenario: Running an evaluation pass
    Given the harness is bootstrapped
    And the corpus contains a set of held-out tasks
    When an evaluation pass is started
    Then each task is presented to the subject in an isolated context
    And the subject's response is forwarded to the judge alongside the expected behaviour
    And the judge returns a score and a one-line rationale for each task
    And the operator receives a summary report with the overall pass rate and the list of failed tasks

  Scenario: Detecting a regression against a baseline
    Given a previous evaluation pass produced a baseline pass rate
    When a new evaluation pass completes
    And the new pass rate is materially lower than the baseline
    Then the harness flags a regression
    And it lists the tasks that previously passed and now fail

  Scenario: Stable scoring on non-deterministic tasks
    Given a task whose answer can legitimately vary across runs
    When the task is graded multiple times in one pass
    Then the judge's reported score is the median of those runs
    And tasks with high score variance are marked as flaky and excluded from the regression signal

  Scenario: Judge expresses uncertainty
    Given a task whose expected behaviour is ambiguous given the response
    When the judge cannot confidently score the response
    Then the judge returns an "uncertain" verdict with its reasoning
    And the task is excluded from the pass rate
    And the operator is asked to clarify the expected behaviour

  Scenario: Adding a task to the corpus
    Given a recent failure the operator wants to guard against
    When the operator adds a new task with a prompt and an expected behaviour
    Then the task is included in the next evaluation pass
    And the historical baseline is unaffected until that pass establishes the task's score

  Scenario: Scheduled evaluation
    Given the operator schedules the harness to run weekly
    When the schedule fires
    Then an evaluation pass runs without operator intervention
    And the report is delivered through the operator's preferred channel
    And no agent configuration is changed automatically


Feature: Improving an agent from evaluation outcomes
  As the operator
  I want failure patterns from the harness to drive concrete proposals
  So that improvement is grounded in measured behaviour rather than vibes

  Scenario: Proposing CLAUDE.md edits from failure patterns
    Given an evaluation pass has produced failed tasks with judge rationales
    When the judge clusters failures into recurring themes
    Then the judge drafts a proposed CLAUDE.md addition for each theme
    And each proposal is delivered to the operator as a reviewable change

  Scenario: Applying an approved proposal
    Given a proposed CLAUDE.md edit
    When the operator approves the proposal
    Then a builder agent applies the edit within the diff size limit
    And the previous CLAUDE.md is preserved so the change can be reverted
    And the change takes effect from the next evaluation pass onward

  Scenario: Verifying a change improved scores
    Given a CLAUDE.md edit was applied to address a specific failure theme
    When the next evaluation pass completes
    Then the harness reports whether tasks in that theme now pass
    And the harness reports whether any previously passing tasks regressed

  Scenario: Refusing to auto-apply changes
    Given a proposed CLAUDE.md edit
    When the schedule fires without the operator present
    Then no edit is applied
    And the proposal waits in the approval queue
