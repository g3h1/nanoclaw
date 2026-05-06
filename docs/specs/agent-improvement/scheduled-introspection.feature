Feature: Scheduled introspection of conversation history
  As the operator
  I want my agent to review its own recent conversations and propose improvements
  So that recurring corrections turn into durable behaviour without me reading transcripts by hand

  Background:
    Given a subject agent that records its sessions in a conversations folder
    And an introspector agent whose role is to read transcripts and identify recurring patterns
    And the operator has chosen a review cadence

  Scenario: Bootstrapping the introspection schedule
    Given a subject agent with at least one review period of conversations
    When the operator schedules an introspection pass at the chosen cadence
    Then an introspector agent is created with read access to the subject's conversations folder
    And a scheduled job is registered for that cadence

  Scenario: An introspection pass with actionable patterns
    Given conversations from the last review period
    When an introspection pass runs
    Then the introspector identifies recurring corrections, redirects, and unresolved threads
    And it drafts a CLAUDE.md addition for each pattern that meets the recurrence threshold
    And each draft includes the rule, the rationale, and pointers to the source conversations

  Scenario: An introspection pass with nothing to report
    Given conversations from the last review period
    When no pattern meets the recurrence threshold
    Then no proposals are produced
    And the operator receives a one-line confirmation that the pass ran

  Scenario: Operator approves a proposal
    Given a proposed CLAUDE.md addition
    When the operator approves the proposal
    Then a builder agent applies the change within the diff size limit
    And the addition takes effect from the next session onward

  Scenario: Operator rejects a proposal
    Given a proposed CLAUDE.md addition
    When the operator rejects the proposal with a reason
    Then the rejection is recorded with that reason
    And the introspector does not re-propose the same rule on later passes unless new evidence emerges

  Scenario: Privacy across agent groups
    Given a subject agent in one group and a separate agent in another group
    When an introspection pass runs for the first group
    Then it reads only from that group's conversations folder
    And no content from any other group is referenced in any proposal

  Scenario: Bounded review window and budget
    Given a subject agent with many months of conversations
    When an introspection pass runs
    Then only conversations within the configured review window are read
    And the pass stops if the configured token or time budget is exhausted
    And a partial-pass report is delivered explaining what was and was not reviewed
